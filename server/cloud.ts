// Cloudflare deployment entry (wrangler.production.jsonc). Instead of the hosting
// platform's identity header, people sign in with email and password: web pages
// carry the session cookie, the Android app sends the same token as Bearer.
import worker, { handleApi, type Env } from "./index";
import { BodyTooLargeError, json, readTextLimited } from "./http";

const SESSION_MS = 30 * 86400000;
const MAX_BODY_BYTES = 500_000;
const MAX_AUTH_BODY_BYTES = 12_000;
const TOKEN = /^[a-f0-9]{64}$/;
const AUTH_POSTS = ["/api/auth/register", "/api/auth/login", "/api/auth/recover"];
// No credentials ever cross origins: the app authenticates with a Bearer token,
// so a wildcard origin cannot be used to ride on someone's cookie.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "X-Tyaga-Session",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (value: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

function withCors(response: Response, exposeToken = false): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(CORS)) out.headers.set(name, value);
  if (exposeToken) {
    // The app keeps the token itself; "" after logout.
    const token = response.headers.get("Set-Cookie")?.match(/tyaga_session=([a-f0-9]*)/)?.[1];
    out.headers.delete("Set-Cookie");
    if (token !== undefined) out.headers.set("X-Tyaga-Session", token);
  }
  return out;
}

function sessionToken(request: Request, url: URL) {
  const bearer = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (bearer) return { token: bearer, bearer: true };
  const allowed = url.protocol === "https:"
    ? new Set(["__Host-tyaga_session", "__Host-tyaga_embedded"])
    : new Set(["__Host-tyaga_session", "tyaga_session"]);
  const cookie = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((s) => s.trim().split("="))
    .find(([name]) => allowed.has(name));
  return cookie && TOKEN.test(cookie[1] ?? "") ? { token: cookie[1], bearer: false } : null;
}

/**
 * Sign-in failures per IP: AccountService only limits per account. Успешный
 * запрос счётчик не двигает — иначе 30 удачных входов с одного адреса запирали
 * всех за общим NAT.
 */
const ipKey = (request: Request) => "ip:" + (request.headers.get("CF-Connecting-IP") ?? "unknown");
async function ipFailures(env: Env, request: Request) {
  const row = await env.DB.prepare("SELECT attempts, window_start FROM auth_limits WHERE platform_id = ?")
    .bind(ipKey(request))
    .first<{ attempts: number; window_start: number }>();
  if (!row) return 0;
  return row.window_start < Date.now() - 900000 ? 0 : row.attempts;
}
async function noteIpFailure(env: Env, request: Request) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_limits WHERE window_start < ?").bind(now - 86_400_000),
    env.DB.prepare(
      "INSERT INTO auth_limits (platform_id,attempts,window_start) VALUES (?,1,?) ON CONFLICT(platform_id) DO UPDATE SET attempts = CASE WHEN auth_limits.window_start < ? THEN 1 ELSE auth_limits.attempts + 1 END, window_start = CASE WHEN auth_limits.window_start < ? THEN excluded.window_start ELSE auth_limits.window_start END",
    ).bind(ipKey(request), now, now - 900000, now - 900000),
  ]);
}

async function api(request: Request, env: Env, url: URL) {
  const auth = sessionToken(request, url);
  let platformId: string | undefined;
  if (auth) {
    const hash = await sha256(auth.token);
    const session = await env.DB.prepare(
      "SELECT accounts.platform_id AS platform, sessions.expires_at AS expires FROM sessions JOIN accounts ON accounts.id = sessions.account_id WHERE sessions.token_hash = ?",
    )
      .bind(hash)
      .first<{ platform: string; expires: number }>();
    if (session && session.expires > Date.now()) {
      platformId = session.platform;
      // The phone stays signed in while it keeps syncing.
      if (auth.bearer && session.expires - Date.now() < SESSION_MS / 2)
        await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(Date.now() + SESSION_MS, hash).run();
    }
  }
  const authPost = request.method === "POST" && AUTH_POSTS.includes(url.pathname);
  let body: string | undefined;
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    try {
      body = await readTextLimited(request, authPost ? MAX_AUTH_BODY_BYTES : MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return json({ error: error.message }, 413);
      throw error;
    }
  }
  if (authPost) {
    if ((await ipFailures(env, request)) > 30)
      return json({ error: "Слишком много попыток. Попробуй через 15 минут." }, 429);
    let email = "";
    try {
      email = String(JSON.parse(body || "{}").email ?? "").trim().toLowerCase();
    } catch {
      /* AccountService answers malformed JSON itself */
    }
    const owner = email
      ? await env.DB.prepare("SELECT platform_id FROM accounts WHERE email = ?").bind(email).first<{ platform_id: string }>()
      : null;
    if (url.pathname === "/api/auth/register" && owner)
      return json({ error: "Эта почта уже зарегистрирована. Войди с ней." }, 409);
    // Each account is its own identity; an unknown email still gets a fresh one
    // so the password check runs and fails the same way.
    platformId = owner?.platform_id ?? crypto.randomUUID();
  }
  const headers = new Headers(request.headers);
  // Never trust a client-supplied identity header.
  headers.set("oai-authenticated-user-id", platformId ?? "visitor:" + crypto.randomUUID());
  if (auth?.bearer || (authPost && request.headers.get("Origin") !== url.origin)) {
    // Bearer and cross-origin sign-in carry no ambient credentials: no CSRF risk.
    headers.set("Origin", url.origin);
    headers.delete("Authorization");
    if (auth) headers.set("Cookie", `__Host-tyaga_session=${auth.token}; tyaga_session=${auth.token}`);
    else headers.delete("Cookie");
  }
  const response = await handleApi(new Request(request.url, { method: request.method, headers }), env, body);
  // 401 — неверные учётные данные; 409 «почта занята» попыткой не считается.
  if (authPost && response.status === 401) await noteIpFailure(env, request);
  return response;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return worker.fetch(request, env);
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
    const origin = request.headers.get("Origin");
    const response = await api(request, env, url);
    if (!origin || origin === url.origin) return response;
    return withCors(response, true);
  },
};
