// Cloudflare deployment entry (wrangler.cloud.jsonc). Instead of the hosting
// platform's identity header, people sign in with email and password: web pages
// carry the session cookie, the Android app sends the same token as Bearer.
import worker, { handleApi, type Env } from "./index";

const SESSION_MS = 30 * 86400000;
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
};
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (value: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

function sessionToken(request: Request) {
  const bearer = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (bearer) return { token: bearer, bearer: true };
  const cookie = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((s) => s.trim().split("="))
    .find(([name]) => name === "__Host-tyaga_session" || name === "tyaga_session");
  return cookie && TOKEN.test(cookie[1] ?? "") ? { token: cookie[1], bearer: false } : null;
}

/** Sign-in attempts per IP: AccountService only limits per account. */
async function tooManyAttempts(env: Env, request: Request) {
  const now = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO auth_limits (platform_id,attempts,window_start) VALUES (?,1,?) ON CONFLICT(platform_id) DO UPDATE SET attempts = CASE WHEN auth_limits.window_start < ? THEN 1 ELSE auth_limits.attempts + 1 END, window_start = CASE WHEN auth_limits.window_start < ? THEN excluded.window_start ELSE auth_limits.window_start END RETURNING attempts",
  )
    .bind("ip:" + (request.headers.get("CF-Connecting-IP") ?? "unknown"), now, now - 900000, now - 900000)
    .first<{ attempts: number }>();
  return (row?.attempts ?? 0) > 30;
}

async function api(request: Request, env: Env, url: URL) {
  const auth = sessionToken(request);
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
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.text();
  if (authPost) {
    if (await tooManyAttempts(env, request))
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
  return handleApi(new Request(request.url, { method: request.method, headers, body }), env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return worker.fetch(request, env);
    const origin = request.headers.get("Origin");
    if (!origin || origin === url.origin) return api(request, env, url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const response = await api(request, env, url);
    const out = new Response(response.body, response);
    for (const [name, value] of Object.entries(CORS)) out.headers.set(name, value);
    // The app keeps the token itself; "" after logout.
    const token = response.headers.get("Set-Cookie")?.match(/tyaga_session=([a-f0-9]*)/)?.[1];
    out.headers.delete("Set-Cookie");
    if (token !== undefined) out.headers.set("X-Tyaga-Session", token);
    return out;
  },
};
