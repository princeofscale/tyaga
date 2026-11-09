import test from "node:test";
import assert from "node:assert/strict";
import { TAG_PATTERN, normalizeTag } from "../src/lib/social";

test("tags are normalized and validated the same way on client and server", () => {
  assert.equal(normalizeTag("  @Ivan_Power "), "ivan_power");
  assert.equal(normalizeTag("@@x"), "x");
  assert.ok(TAG_PATTERN.test("ivan_power"));
  assert.ok(TAG_PATTERN.test("a1_"));
  for (const bad of ["ab", "x".repeat(21), "иван", "has space", "dash-ed", ""])
    assert.ok(!TAG_PATTERN.test(bad), bad);
});
