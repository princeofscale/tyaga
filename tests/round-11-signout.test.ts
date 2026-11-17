import assert from "node:assert/strict";
import test from "node:test";
import { signOutAccount } from "../src/services/signOut";
import { apiClient } from "../src/services/ApiClient";

const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
function withTransport(transport: typeof fetch) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = apiClient as any;
  const before = client.transport;
  client.transport = transport;
  return () => { client.transport = before; };
}

test("R11-REQ06: 401 на выход — это успешный выход", async () => {
  const restore = withTransport(answer(401, { error: "Войди в Тягу. Черновик тренировки остаётся на этом устройстве." }) as unknown as typeof fetch);
  let called = 0;
  try { await signOutAccount(() => { called++; }); } finally { restore(); }
  assert.equal(called, 1);
});
test("R11-REQ06: обычный выход (200) вызывает очистку один раз", async () => {
  const restore = withTransport(answer(200, { ok: true }) as unknown as typeof fetch);
  let called = 0;
  try { await signOutAccount(() => { called++; }); } finally { restore(); }
  assert.equal(called, 1);
});
test("R11-REQ06: 5xx — ошибка, данные не трогаются", async () => {
  const restore = withTransport(answer(503, { error: "Сервис недоступен" }) as unknown as typeof fetch);
  let called = 0;
  await assert.rejects(signOutAccount(() => { called++; }), /Сервис недоступен/);
  restore();
  assert.equal(called, 0);
});
test("R11-REQ06: нет сети — ошибка, данные не трогаются", async () => {
  const restore = withTransport((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch);
  let called = 0;
  await assert.rejects(signOutAccount(() => { called++; }), /Запрос не завершился/);
  restore();
  assert.equal(called, 0);
});
