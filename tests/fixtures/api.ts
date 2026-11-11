import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import initSqlJs from "sql.js";
import { LocalD1 } from "../../src/device/LocalD1";
import { handleApi, type Env } from "../../server/index";
export async function setup() {
  const SQL = await initSqlJs(),
    db = new SQL.Database();
  db.exec("PRAGMA foreign_keys=ON");
  for (const file of (await readdir("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(await readFile("drizzle/" + file, "utf8"));
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const env = { DB: new LocalD1(db) } as unknown as Env;
  const call = async <T = Record<string, unknown>>(
    owner: string,
    path: string,
    method = "GET",
    body?: unknown,
    origin = "https://tyaga.test",
  ) => {
    const response = await handleApi(
      new Request("https://tyaga.test" + path, {
        method,
        headers: {
          "oai-authenticated-user-id": owner,
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: cookies.get(owner) ?? "",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
    return {
      status: response.status,
      data: (await response.json()) as T,
      response,
    };
  };
  for (const owner of ["a", "b", "outsider"]) {
    const r = await call<{ profile: { id: string } }>(
      owner,
      "/api/auth/register",
      "POST",
      {
        email: owner + "@example.test",
        password: "test daily workflow passphrase",
        displayName: owner,
        timeZone: "UTC",
      },
    );
    assert.equal(r.status, 201);
    cookies.set(owner, r.response.headers.get("Set-Cookie")!.split(";")[0]);
    ids.set(owner, r.data.profile.id);
  }
  return { call, ids, db };
}
