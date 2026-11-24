import { InputError, object, str, num } from "./validation";
import type { AccountProfile, SessionDevice } from "../src/lib/account";

type AccountRow = {
  id: string; platform_id: string; email: string; display_name: string;
  password_hash: string; salt: string; recovery_hash: string;
  time_zone: string; body_mass_kg: number | null; revision: number; created_at: string;
};
type SessionRow = {
  token_hash: string; id: string | null; user_agent: string | null;
  last_seen_at: number | null; expires_at: number; created_at: number;
};
const SESSION_TOUCH_MS = 5 * 60_000;
function parseDeviceLabel(ua: string): string {
  const s = ua.trim();
  if (!s) return "Неизвестное устройство";
  if (/Tyaga|Capacitor/i.test(s) && /Android/i.test(s)) return "Приложение Тяга · Android";
  const browser = /Edg\//i.test(s) ? "Edge"
    : /OPR\/|Opera/i.test(s) ? "Opera"
    : /YaBrowser/i.test(s) ? "Яндекс Браузер"
    : /Firefox\//i.test(s) ? "Firefox"
    : /Chrome\/|CriOS\//i.test(s) ? "Chrome"
    : /Safari\//i.test(s) ? "Safari"
    : "Браузер";
  const os = /iPhone/i.test(s) ? "iPhone"
    : /iPad/i.test(s) ? "iPad"
    : /Android/i.test(s) ? "Android"
    : /Mac OS X|Macintosh/i.test(s) ? "macOS"
    : /Windows/i.test(s) ? "Windows"
    : /Linux/i.test(s) ? "Linux"
    : "";
  return os ? `${browser} · ${os}` : browser;
}
const SESSION_MS = 30 * 86400000;
const PBKDF2_LEGACY_ITERATIONS = 100_000;
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_PREFIX = "pbkdf2$";
const cookieName = (request: Request) => new URL(request.url).protocol === "https:" ? "__Host-tyaga_session" : "tyaga_session";
const EMBEDDED_COOKIE = "__Host-tyaga_embedded";
const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const random = (length = 32) => hex(crypto.getRandomValues(new Uint8Array(length)));
const hash = async (value: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
async function derivePbkdf2(password: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations }, key, 256));
}
async function passwordHash(password: string, salt: string, iterations = PBKDF2_ITERATIONS) {
  return `${PBKDF2_PREFIX}${iterations}$${await derivePbkdf2(password, salt, iterations)}`;
}
function parsePasswordHash(stored: string): { iterations: number; digest: string; legacy: boolean } {
  if (stored.startsWith(PBKDF2_PREFIX)) {
    const parts = stored.split("$");
    const iterations = Number(parts[1]);
    const digest = parts[2] ?? "";
    if (parts.length === 3 && Number.isInteger(iterations) && iterations >= PBKDF2_LEGACY_ITERATIONS && /^[a-f0-9]{64}$/.test(digest))
      return { iterations, digest, legacy: iterations < PBKDF2_ITERATIONS };
  }
  return { iterations: PBKDF2_LEGACY_ITERATIONS, digest: stored, legacy: true };
}
async function verifyPassword(secret: string, salt: string, stored: string): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  const parsed = parsePasswordHash(stored);
  const actual = await derivePbkdf2(secret, salt, parsed.iterations);
  const ok = equal(actual, parsed.digest);
  return { ok, needsUpgrade: ok && parsed.legacy };
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
  // onSession lets an in-app host (the Android build) keep the token: a browser
  // cannot read Set-Cookie from a Response it constructed itself.
  constructor(private db: D1Database, private platformId: string, private onSession?: (token: string) => void) {}
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
    const tokenHash = await hash(token);
    const now = Date.now();
    const row = await this.db.prepare("SELECT accounts.*, sessions.last_seen_at AS session_last_seen_at FROM sessions JOIN accounts ON accounts.id = sessions.account_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND accounts.platform_id = ?")
      .bind(tokenHash, now, this.platformId).first<AccountRow & { session_last_seen_at: number | null }>();
    if (!row) return null;
    if (!row.session_last_seen_at || now - row.session_last_seen_at >= SESSION_TOUCH_MS) {
      await this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
    }
    return profile(row);
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
      this.onSession?.(token);
      const maxAge = token ? SESSION_MS / 1000 : 0;
      headers.append("Set-Cookie", this.cookie(request, token, maxAge));
      if (new URL(request.url).protocol === "https:")
        headers.append("Set-Cookie", `${EMBEDDED_COOKIE}=${token}; Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age=${maxAge}`);
      if (!token) headers.set("Clear-Site-Data", '"cookies"');
    }
    return new Response(JSON.stringify(data), { status, headers });
  }
  private async sessionIdFor(tokenHash: string) {
    return (await hash(`sid:${tokenHash}`)).slice(0, 16);
  }
  private async newSession(accountId: string, request?: Request) {
    const token = random(); const now = Date.now();
    const tokenHash = await hash(token);
    const id = await this.sessionIdFor(tokenHash);
    const userAgent = (request?.headers.get("User-Agent") ?? "").slice(0, 200);
    await this.db.batch([
      this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      this.db.prepare("INSERT INTO sessions (token_hash,id,account_id,user_agent,last_seen_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(tokenHash, id, accountId, userAgent, now, now + SESSION_MS, now),
    ]);
    return token;
  }
  /** Неудачные попытки за последние 15 минут; удачная попытка счётчик сбрасывает. */
  private async attempts() {
    const row = await this.db.prepare("SELECT attempts, window_start FROM auth_limits WHERE platform_id = ?")
      .bind(this.platformId).first<{ attempts: number; window_start: number }>();
    if (!row) return 0;
    return row.window_start < Date.now() - 900000 ? 0 : row.attempts;
  }
  private async noteFailure() {
    const now = Date.now();
    await this.db.prepare("INSERT INTO auth_limits (platform_id,attempts,window_start) VALUES (?,1,?) ON CONFLICT(platform_id) DO UPDATE SET attempts = CASE WHEN auth_limits.window_start < ? THEN 1 ELSE auth_limits.attempts + 1 END, window_start = CASE WHEN auth_limits.window_start < ? THEN excluded.window_start ELSE auth_limits.window_start END")
      .bind(this.platformId, now, now - 900000, now - 900000).run();
  }
  private async clearFailures() {
    await this.db.prepare("DELETE FROM auth_limits WHERE platform_id = ?").bind(this.platformId).run();
  }
  /**
   * Проверка перед сверкой пароля. Считаются только отказы: успешный вход
   * обнуляет счётчик, иначе 15 удачных входов за 15 минут запирали аккаунт.
   */
  private async guard() {
    if ((await this.attempts()) >= 15)
      throw new AuthError("Слишком много попыток. Попробуй через 15 минут.", 429);
  }
  private async emailTaken(address: string) {
    return !!(await this.db.prepare("SELECT 1 AS taken FROM accounts WHERE email = ?").bind(address).first());
  }
  async handle(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/auth/")) return null;
    if (path === "/api/auth/session" && request.method === "GET")
      return this.reply({ registered: !!(await this.account()), profile: await this.authenticated(request) }, request);
    if (path === "/api/auth/sessions" && request.method === "GET") {
      const current = await this.require(request);
      const currentHash = await hash(this.token(request)!);
      const now = Date.now();
      const rows = (await this.db.prepare(
        "SELECT token_hash, id, user_agent, last_seen_at, expires_at, created_at FROM sessions WHERE account_id = ? AND expires_at > ? ORDER BY created_at DESC",
      ).bind(current.id, now).all<SessionRow>()).results;
      const sessions: SessionDevice[] = await Promise.all(
        rows.map(async (r) => ({
          id: r.id || (await this.sessionIdFor(r.token_hash)),
          deviceLabel: parseDeviceLabel(r.user_agent ?? ""),
          createdAt: r.created_at,
          lastSeenAt: r.last_seen_at || r.created_at,
          expiresAt: r.expires_at,
          current: equal(r.token_hash, currentHash),
        })),
      );
      sessions.sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt - a.lastSeenAt);
      return this.reply({ sessions }, request);
    }
    if (path.startsWith("/api/auth/sessions/") && request.method === "DELETE") {
      const current = await this.require(request);
      const targetId = str(decodeURIComponent(path.slice("/api/auth/sessions/".length)), 64, 1);
      const currentHash = await hash(this.token(request)!);
      const rows = (await this.db.prepare(
        "SELECT token_hash, id FROM sessions WHERE account_id = ? AND expires_at > ?",
      ).bind(current.id, Date.now()).all<{ token_hash: string; id: string | null }>()).results;
      let matchedHash: string | null = null;
      for (const r of rows) {
        const sid = r.id || (await this.sessionIdFor(r.token_hash));
        if (sid === targetId) {
          matchedHash = r.token_hash;
          break;
        }
      }
      if (!matchedHash) return this.reply({ error: "Сессия не найдена" }, request, undefined, 404);
      await this.db.prepare("DELETE FROM sessions WHERE token_hash = ? AND account_id = ?").bind(matchedHash, current.id).run();
      const isCurrent = equal(matchedHash, currentHash);
      return this.reply({ revoked: true, current: isCurrent }, request, isCurrent ? "" : undefined);
    }
    const raw = await request.text();
    if (raw.length > 12000) throw new InputError("Слишком большой запрос");
    const v = object(JSON.parse(raw || "{}"));
    if (["/api/auth/register", "/api/auth/login", "/api/auth/recover"].includes(path) && request.method === "POST") {
      await this.guard();
      const address = email(v.email), secret = password(v.password), row = await this.account();
      if (path === "/api/auth/register") {
        if (row) throw new AuthError("Для этого аккаунта уже есть профиль Тяги. Перейди ко входу.", 409);
        // Одна почта — один профиль. UNIQUE(email) в схеме страхует от гонки, но
        // честнее ответить 409, чем упасть в 503 на нарушении ограничения.
        if (await this.emailTaken(address))
          throw new AuthError("Эта почта уже зарегистрирована. Войди с ней.", 409);
        const salt = random(16), recoveryCode = random(16), id = crypto.randomUUID();
        const timeZone = zone(v.timeZone), name = str(v.displayName, 80, 1);
        let inserted: AccountRow | null;
        try {
          inserted = await this.db.prepare("INSERT INTO accounts (id,platform_id,email,display_name,password_hash,salt,recovery_hash,time_zone,body_mass_kg,revision,created_at) VALUES (?,?,?,?,?,?,?,?,NULL,1,?) ON CONFLICT(platform_id) DO NOTHING RETURNING *")
            .bind(id, this.platformId, address, name, await passwordHash(secret, salt), salt, await hash(recoveryCode), timeZone, new Date().toISOString()).first<AccountRow>();
        } catch (error) {
          if (/UNIQUE/i.test(error instanceof Error ? error.message : String(error)))
            throw new AuthError("Эта почта уже зарегистрирована. Войди с ней.", 409);
          throw error;
        }
        if (!inserted) throw new AuthError("Профиль уже создан. Перейди ко входу.", 409);
        await this.clearFailures();
        // Existing workouts keep their original owner. New timezone applies only
        // to new records; historical date-only entries are never shifted.
        return this.reply({ profile: profile(inserted), recoveryCode }, request, await this.newSession(id, request), 201);
      }
      if (path === "/api/auth/recover") {
        const code = str(v.recoveryCode, 64, 1).replace(/\s/g, "").toLowerCase();
        if (!row || row.email !== address || !equal(await hash(code), row.recovery_hash)) {
          await this.noteFailure();
          throw new AuthError("Почта или код восстановления не подошли.");
        }
        const salt = random(16), recoveryCode = random(16);
        const updated = await this.db.prepare("UPDATE accounts SET password_hash = ?, salt = ?, recovery_hash = ?, revision = revision + 1 WHERE id = ? AND recovery_hash = ? AND revision = ? RETURNING *")
          .bind(await passwordHash(secret, salt), salt, await hash(recoveryCode), row.id, row.recovery_hash, row.revision).first<AccountRow>();
        if (!updated) throw new AuthError("Код уже использован или профиль изменился. Войди с новым паролем.", 409);
        await this.db.prepare("DELETE FROM sessions WHERE account_id = ?").bind(row.id).run();
        await this.clearFailures();
        return this.reply({ profile: profile(updated), recoveryCode }, request, await this.newSession(row.id, request));
      }
      const checked = row
        ? await verifyPassword(secret, row.salt, row.password_hash)
        : (await derivePbkdf2(secret, "unregistered-account-placeholder", PBKDF2_ITERATIONS), { ok: false, needsUpgrade: false });
      if (!row || row.email !== address || !checked.ok) {
        await this.noteFailure();
        throw new AuthError("Почта или пароль не подошли.");
      }
      if (checked.needsUpgrade) {
        const upgradedSalt = random(16);
        const upgradedHash = await passwordHash(secret, upgradedSalt, PBKDF2_ITERATIONS);
        await this.db.prepare("UPDATE accounts SET password_hash = ?, salt = ? WHERE id = ? AND password_hash = ?")
          .bind(upgradedHash, upgradedSalt, row.id, row.password_hash).run();
      }
      await this.clearFailures();
      return this.reply({ profile: profile(row) }, request, await this.newSession(row.id, request));
    }
    const current = await this.require(request);
    if (path === "/api/auth/logout" && request.method === "POST") {
      const token = this.token(request)!;
      await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hash(token)).run();
      return this.reply({ loggedOut: true }, request, "");
    }
    if (path === "/api/auth/sessions/revoke-others" && request.method === "POST") {
      const currentHash = await hash(this.token(request)!);
      const result = await this.db.prepare("DELETE FROM sessions WHERE account_id = ? AND token_hash != ?")
        .bind(current.id, currentHash).run();
      return this.reply({ revoked: result.meta?.changes ?? 0 }, request);
    }
    if (path === "/api/auth/sessions/revoke-all" && request.method === "POST") {
      const result = await this.db.prepare("DELETE FROM sessions WHERE account_id = ?").bind(current.id).run();
      return this.reply({ loggedOut: true, revoked: result.meta?.changes ?? 0 }, request, "");
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
      await this.guard();
      const row = (await this.account())!;
      if (!(await verifyPassword(password(v.currentPassword), row.salt, row.password_hash)).ok) {
        await this.noteFailure();
        throw new AuthError("Текущий пароль не подошёл.");
      }
      const salt = random(16);
      const updated = await this.db.prepare("UPDATE accounts SET password_hash = ?, salt = ?, revision = revision + 1 WHERE id = ? AND revision = ? RETURNING *")
        .bind(await passwordHash(password(v.password), salt), salt, row.id, row.revision).first<AccountRow>();
      if (!updated) throw new AuthError("Профиль изменился. Обнови страницу перед сменой пароля.", 409);
      await this.db.prepare("DELETE FROM sessions WHERE account_id = ?").bind(row.id).run();
      await this.clearFailures();
      return this.reply({ profile: profile(updated) }, request, await this.newSession(row.id, request));
    }
    if (path === "/api/auth/recovery-code" && request.method === "POST") {
      // Старый код нигде не хранится (только хэш), поэтому показать его нельзя: выпускается новый, старый перестаёт подходить.
      // Нужен вход и текущий пароль; попытки считаются так же, как у входа и смены пароля.
      await this.guard();
      const row = (await this.account())!;
      if (!(await verifyPassword(password(v.currentPassword), row.salt, row.password_hash)).ok) {
        await this.noteFailure();
        throw new AuthError("Текущий пароль не подошёл.");
      }
      const recoveryCode = random(16);
      const updated = await this.db.prepare("UPDATE accounts SET recovery_hash = ? WHERE id = ? AND recovery_hash = ? RETURNING id")
        .bind(await hash(recoveryCode), row.id, row.recovery_hash).first<{ id: string }>();
      if (!updated) throw new AuthError("Код только что выпустили на другом устройстве. Повтори.", 409);
      await this.clearFailures();
      return this.reply({ recoveryCode }, request);
    }
    return this.reply({ error: "Не найдено" }, request, undefined, 404);
  }
}
