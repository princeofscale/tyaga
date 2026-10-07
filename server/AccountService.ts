import { InputError, object, str, num } from "./validation";
import type { AccountProfile } from "../src/lib/account";

type AccountRow = {
  id: string; platform_id: string; email: string; display_name: string;
  password_hash: string; salt: string; recovery_hash: string;
  time_zone: string; body_mass_kg: number | null; revision: number; created_at: string;
};
const SESSION_MS = 30 * 86400000;
const cookieName = (request: Request) => new URL(request.url).protocol === "https:" ? "__Host-tyaga_session" : "tyaga_session";
const EMBEDDED_COOKIE = "__Host-tyaga_embedded";
const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const random = (length = 32) => hex(crypto.getRandomValues(new Uint8Array(length)));
const hash = async (value: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256));
}
function equal(a: string, b: string) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
function password(value: unknown) {
  // Do not trim passwords: spaces can be part of a passphrase.
  if (typeof value !== "string" || value.length < 10 || value.length > 128)
    throw new InputError("Пароль: от 10 до 128 символов. Подойдёт длинная фраза.");
  return value;
}
function email(value: unknown) {
  const result = str(value, 254, 3).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new InputError("Проверь адрес почты");
  return result;
}
function zone(value: unknown) {
  const result = str(value, 80, 1);
  try { new Intl.DateTimeFormat("ru", { timeZone: result }).format(); }
  catch { throw new InputError("Проверь часовой пояс"); }
  return result;
}
function profile(row: AccountRow): AccountProfile {
  return { id: row.id, email: row.email, displayName: row.display_name, timeZone: row.time_zone,
    bodyMassKg: row.body_mass_kg, revision: row.revision, createdAt: row.created_at };
}
export class AuthError extends Error {
  constructor(message: string, public status = 401) { super(message); }
}
export class AccountService {
  constructor(private db: D1Database, private platformId: string) {}
  private account() {
    return this.db.prepare("SELECT * FROM accounts WHERE platform_id = ?").bind(this.platformId).first<AccountRow>();
  }
  private token(request: Request) {
    // The partitioned cookie permits an embedded Site without enabling a
    // shared third-party cookie. Direct visits use the stricter first cookie.
    const names = new URL(request.url).protocol === "https:"
      ? [cookieName(request), EMBEDDED_COOKIE] : [cookieName(request)];
    const values = (request.headers.get("Cookie") ?? "").split(";").map(s => s.trim());
    const tokens = names.flatMap(name => values.filter(s => s.startsWith(name + "=")).map(s => s.slice(name.length + 1)));
    if (new Set(tokens).size !== 1) return null;
    const token = tokens[0];
    return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
  }
  async authenticated(request: Request): Promise<AccountProfile | null> {
    const token = this.token(request);
    if (!token) return null;
    const row = await this.db.prepare("SELECT accounts.* FROM sessions JOIN accounts ON accounts.id = sessions.account_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND accounts.platform_id = ?")
      .bind(await hash(token), Date.now(), this.platformId).first<AccountRow>();
    return row ? profile(row) : null;
  }
  async require(request: Request) {
    const account = await this.authenticated(request);
    if (!account) throw new AuthError("Войди в Тягу. Черновик тренировки остаётся на этом устройстве.");
    return account;
  }
  private cookie(request: Request, value: string, maxAge: number) {
    return `${cookieName(request)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
  }
  private reply(data: unknown, request: Request, token?: string, status = 200) {
    const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    if (token !== undefined) {
      const maxAge = token ? SESSION_MS / 1000 : 0;
      headers.append("Set-Cookie", this.cookie(request, token, maxAge));
      if (new URL(request.url).protocol === "https:")
        headers.append("Set-Cookie", `${EMBEDDED_COOKIE}=${token}; Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age=${maxAge}`);
    }
    return new Response(JSON.stringify(data), { status, headers });
  }
  private async newSession(accountId: string) {
    const token = random(); const now = Date.now();
    await this.db.batch([
      this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      this.db.prepare("INSERT INTO sessions (token_hash,account_id,expires_at,created_at) VALUES (?,?,?,?)").bind(await hash(token), accountId, now + SESSION_MS, now),
    ]);
    return token;
  }
  private async limit() {
    const now = Date.now();
    const result = await this.db.prepare("INSERT INTO auth_limits (platform_id,attempts,window_start) VALUES (?,1,?) ON CONFLICT(platform_id) DO UPDATE SET attempts = CASE WHEN auth_limits.window_start < ? THEN 1 ELSE auth_limits.attempts + 1 END, window_start = CASE WHEN auth_limits.window_start < ? THEN excluded.window_start ELSE auth_limits.window_start END RETURNING attempts")
      .bind(this.platformId, now, now - 900000, now - 900000).first<{ attempts: number }>();
    if ((result?.attempts ?? 99) > 15) throw new AuthError("Слишком много попыток. Попробуй через 15 минут.", 429);
  }
  async handle(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/auth/")) return null;
    if (path === "/api/auth/session" && request.method === "GET")
      return this.reply({ registered: !!(await this.account()), profile: await this.authenticated(request) }, request);
    const raw = await request.text();
    if (raw.length > 12000) throw new InputError("Слишком большой запрос");
    const v = object(JSON.parse(raw || "{}"));
    if (["/api/auth/register", "/api/auth/login", "/api/auth/recover"].includes(path) && request.method === "POST") {
      await this.limit();
      const address = email(v.email), secret = password(v.password), row = await this.account();
      if (path === "/api/auth/register") {
        if (row) throw new AuthError("Для этого аккаунта уже есть профиль Тяги. Перейди ко входу.", 409);
        const salt = random(16), recoveryCode = random(16), id = crypto.randomUUID();
        const timeZone = zone(v.timeZone), name = str(v.displayName, 80, 1);
        const inserted = await this.db.prepare("INSERT INTO accounts (id,platform_id,email,display_name,password_hash,salt,recovery_hash,time_zone,body_mass_kg,revision,created_at) VALUES (?,?,?,?,?,?,?,?,NULL,1,?) ON CONFLICT(platform_id) DO NOTHING RETURNING *")
          .bind(id, this.platformId, address, name, await passwordHash(secret, salt), salt, await hash(recoveryCode), timeZone, new Date().toISOString()).first<AccountRow>();
        if (!inserted) throw new AuthError("Профиль уже создан. Перейди ко входу.", 409);
        // Existing workouts keep their original owner. New timezone applies only
        // to new records; historical date-only entries are never shifted.
        return this.reply({ profile: profile(inserted), recoveryCode }, request, await this.newSession(id), 201);
      }
      if (path === "/api/auth/recover") {
        const code = str(v.recoveryCode, 64, 1).replace(/\s/g, "").toLowerCase();
        if (!row || row.email !== address || !equal(await hash(code), row.recovery_hash))
          throw new AuthError("Почта или код восстановления не подошли.");
        const salt = random(16), recoveryCode = random(16);
        const updated = await this.db.prepare("UPDATE accounts SET password_hash = ?, salt = ?, recovery_hash = ?, revision = revision + 1 WHERE id = ? AND recovery_hash = ? AND revision = ? RETURNING *")
          .bind(await passwordHash(secret, salt), salt, await hash(recoveryCode), row.id, row.recovery_hash, row.revision).first<AccountRow>();
        if (!updated) throw new AuthError("Код уже использован или профиль изменился. Войди с новым паролем.", 409);
        await this.db.prepare("DELETE FROM sessions WHERE account_id = ?").bind(row.id).run();
        return this.reply({ profile: profile(updated), recoveryCode }, request, await this.newSession(row.id));
      }
      const actual = await passwordHash(secret, row?.salt ?? "unregistered-account-placeholder");
      if (!row || row.email !== address || !equal(actual, row.password_hash)) throw new AuthError("Почта или пароль не подошли.");
      return this.reply({ profile: profile(row) }, request, await this.newSession(row.id));
    }
    const current = await this.require(request);
    if (path === "/api/auth/logout" && request.method === "POST") {
      const token = this.token(request)!;
      await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hash(token)).run();
      return this.reply({ loggedOut: true }, request, "");
    }
    if (path === "/api/auth/profile" && request.method === "PUT") {
      const name = str(v.displayName, 80, 1), timeZone = zone(v.timeZone);
      const mass = v.bodyMassKg === null || v.bodyMassKg === "" ? null : num(v.bodyMassKg, 20, 500);
      const updated = await this.db.prepare("UPDATE accounts SET display_name = ?, time_zone = ?, body_mass_kg = ?, revision = revision + 1 WHERE id = ? AND revision = ? RETURNING *")
        .bind(name, timeZone, mass, current.id, num(v.revision, 1, 1000000000, true)).first<AccountRow>();
      if (!updated) throw new AuthError("Профиль изменился на другом устройстве. Закрой окно и обнови страницу.", 409);
      const settings = await this.db.prepare("SELECT payload FROM settings WHERE owner_id = ?").bind(this.platformId).first<{ payload: string }>();
      if (settings) await this.db.prepare("UPDATE settings SET payload = json_set(payload, '$.timeZone', ?), revision = revision + 1 WHERE owner_id = ?").bind(timeZone, this.platformId).run();
      return this.reply({ profile: profile(updated) }, request);
    }
    if (path === "/api/auth/password" && request.method === "POST") {
      await this.limit();
      const row = (await this.account())!;
      if (!equal(await passwordHash(password(v.currentPassword), row.salt), row.password_hash)) throw new AuthError("Текущий пароль не подошёл.");
      const salt = random(16);
      const updated = await this.db.prepare("UPDATE accounts SET password_hash = ?, salt = ?, revision = revision + 1 WHERE id = ? AND revision = ? RETURNING *")
        .bind(await passwordHash(password(v.password), salt), salt, row.id, row.revision).first<AccountRow>();
      if (!updated) throw new AuthError("Профиль изменился. Обнови страницу перед сменой пароля.", 409);
      await this.db.prepare("DELETE FROM sessions WHERE account_id = ?").bind(row.id).run();
      return this.reply({ profile: profile(updated) }, request, await this.newSession(row.id));
    }
    return this.reply({ error: "Не найдено" }, request, undefined, 404);
  }
}
