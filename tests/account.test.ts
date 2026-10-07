import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { makeWorkout } from "../src/lib/model";
async function setup() {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers:[{ modules:true, scriptPath:"dist/server/index.js", compatibilityDate:"2025-09-27", d1Databases:["DB"] }], cf:false }));
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir("drizzle")).filter(p=>p.endsWith(".sql")).sort())
    for (const statement of (await readFile("drizzle/"+file,"utf8")).split("--> statement-breakpoint").filter(s=>s.trim())) await db.prepare(statement.trim()).run();
  const origin = "https://gym.example";
  const call = (path:string, method="GET", body?:unknown, cookie="", owner:string|null="owner-a", source=origin) => mf.dispatchFetch(origin+path,{ method,
    headers:{ ...(owner ? {"oai-authenticated-user-id":owner} : {}), Cookie:cookie, Origin:source, "Content-Type":"application/json" },
    body:body === undefined ? undefined : JSON.stringify(body) });
  return {mf,db,call};
}
const credentials = { email:"athlete@example.test", password:"strong test passphrase", displayName:"Атлет", timeZone:"Europe/Amsterdam" };
const cookieOf = (r:Response) => r.headers.get("Set-Cookie")!.split(";")[0];
test("real account adopts existing history; cookies, profiles, revocation, recovery and owner isolation work",async()=> {
  const {mf,db,call} = await setup();
  try {
    const old = makeWorkout(["bench"],[],"Europe/Amsterdam"); old.exercises[0].sets[0].done=true;
    await db.prepare("INSERT INTO workouts (id,owner_id,date,payload,updated_at,revision) VALUES (?,?,?,?,?,1)").bind(old.id,"owner-a",old.date,JSON.stringify(old),new Date().toISOString()).run();
    assert.equal((await call("/api/data")).status,401);
    assert.equal((await call("/api/auth/register","POST",credentials,"",null)).status,401);
    assert.equal((await call("/api/auth/register","POST",credentials,"","owner-a","https://evil.example")).status,403);
    const created=await call("/api/auth/register","POST",credentials);
    assert.equal(created.status,201);
    const content=await created.json() as any, cookie=cookieOf(created), rawCookie=created.headers.get("Set-Cookie")!;
    assert.match(rawCookie,/^__Host-tyaga_session=/); assert.match(rawCookie,/HttpOnly/); assert.match(rawCookie,/Secure/); assert.match(rawCookie,/SameSite=Strict/); assert.doesNotMatch(rawCookie,/Domain=/);
    const embedded = created.headers.getSetCookie().find(value => value.startsWith("__Host-tyaga_embedded="))!;
    assert.match(embedded, /SameSite=None/); assert.match(embedded, /Partitioned/); assert.match(embedded, /HttpOnly/); assert.match(embedded, /Secure/);
    assert.equal((await call("/api/data", "GET", undefined, embedded.split(";")[0])).status, 200);
    assert.equal(content.profile.displayName,"Атлет"); assert.equal(content.recoveryCode.length,32); assert.equal(content.profile.passwordHash,undefined);
    const row=await db.prepare("SELECT password_hash,salt,recovery_hash FROM accounts").first<any>();
    assert.notEqual(row.password_hash,credentials.password); assert.notEqual(row.recovery_hash,content.recoveryCode);
    assert.equal((await call("/api/auth/register","POST",credentials)).status,409);
    const data=await (await call("/api/data","GET",undefined,cookie)).json() as any;
    assert.equal(data.workouts[0].id,old.id); assert.equal(data.settings.timeZone,"Europe/Amsterdam");
    assert.equal((await call("/api/data","GET",undefined,cookie,"owner-b")).status,401);
    assert.equal((await call("/api/data","GET",undefined,cookie+"; __Host-tyaga_session="+"0".repeat(64))).status,401);
    const updated=await call("/api/auth/profile","PUT",{displayName:"Саша",timeZone:"Asia/Tokyo",bodyMassKg:75.5,revision:1},cookie);
    assert.equal(updated.status,200); assert.equal((await updated.json() as any).profile.bodyMassKg,75.5);
    assert.equal((await call("/api/auth/profile","PUT",{displayName:"Старая версия",timeZone:"UTC",bodyMassKg:null,revision:1},cookie)).status,409);
    assert.equal((await call("/api/auth/logout","POST",{},cookie)).status,200);
    assert.equal((await call("/api/data","GET",undefined,cookie)).status,401);
    assert.equal((await call("/api/auth/login","POST",{...credentials,password:"wrong passphrase"})).status,401);
    const login=await call("/api/auth/login","POST",credentials); assert.equal(login.status,200);
    const second=await call("/api/auth/login","POST",credentials); assert.equal(second.status,200);
    const changed=await call("/api/auth/password","POST",{currentPassword:credentials.password,password:"new very long passphrase"},cookieOf(login));
    assert.equal(changed.status,200); assert.equal((await call("/api/data","GET",undefined,cookieOf(second))).status,401);
    assert.equal((await call("/api/auth/login","POST",credentials)).status,401);
    const recovered=await call("/api/auth/recover","POST",{email:credentials.email,password:"restored long passphrase",recoveryCode:content.recoveryCode});
    assert.equal(recovered.status,200); assert.equal((await call("/api/data","GET",undefined,cookieOf(changed))).status,401);
    assert.equal((await call("/api/auth/recover","POST",{email:credentials.email,password:"another long passphrase",recoveryCode:content.recoveryCode})).status,401);
    const recoveryProfile=(await recovered.json() as any).profile;
    assert.equal(recoveryProfile.displayName,"Саша");
    const fresh=cookieOf(recovered);
    assert.equal((await (await call("/api/data","GET",undefined,fresh)).json() as any).workouts[0].id,old.id);
    await db.prepare("UPDATE sessions SET expires_at = 0").run();
    assert.equal((await call("/api/data","GET",undefined,fresh)).status,401);
  } finally { await mf.dispose(); }
});
test("authentication attempt limits are persisted and cannot be bypassed by removing cookies",async()=> {
  const {mf,db,call}=await setup();
  try {
    await db.prepare("INSERT INTO auth_limits (platform_id,attempts,window_start) VALUES (?,15,?)").bind("owner-a",Date.now()).run();
    assert.equal((await call("/api/auth/register","POST",credentials)).status,429);
    await db.prepare("UPDATE auth_limits SET window_start = ?").bind(Date.now()-901000).run();
    assert.equal((await call("/api/auth/register","POST",credentials)).status,201);
  } finally { await mf.dispose(); }
});
