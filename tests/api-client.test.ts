import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient, ApiError } from "../src/services/ApiClient";

test("a cloud 401 does not expire Android's local journal session; web 401 still expires it", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  let expired = 0;
  events.addEventListener("tyaga:auth-expired", () => expired++);
  Object.defineProperty(globalThis, "window", { value: events, configurable: true });
  const transport: typeof fetch = async () => new Response(JSON.stringify({ error: "Вход истёк" }), { status: 401 });
  try {
    await assert.rejects(new ApiClient(transport, false).request("/api/friends"), ApiError);
    assert.equal(expired, 0);
    await assert.rejects(new ApiClient(transport).request("/api/friends"), ApiError);
    assert.equal(expired, 1);
    await assert.rejects(new ApiClient(transport).request("/api/auth/login", "POST", {}), ApiError);
    assert.equal(expired, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
