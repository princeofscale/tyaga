import test from "node:test";
import assert from "node:assert/strict";
import { pluralRu } from "../src/lib/plural";

const forms = ["тренировка", "тренировки", "тренировок"] as const;

test("plural: one, few and many follow the Russian rules", () => {
  assert.equal(pluralRu(1, forms), "тренировка");
  for (const n of [2, 3, 4]) assert.equal(pluralRu(n, forms), "тренировки", String(n));
  for (const n of [0, 5, 9, 10, 20, 100]) assert.equal(pluralRu(n, forms), "тренировок", String(n));
});

test("plural: the teens are always many, the endings repeat every hundred", () => {
  for (const n of [11, 12, 13, 14, 111, 112, 214]) assert.equal(pluralRu(n, forms), "тренировок", String(n));
  for (const n of [21, 101, 1001]) assert.equal(pluralRu(n, forms), "тренировка", String(n));
  for (const n of [22, 23, 24, 102]) assert.equal(pluralRu(n, forms), "тренировки", String(n));
});

test("plural: fractions and negative numbers fall back to the many form", () => {
  assert.equal(pluralRu(1.5, forms), "тренировок");
  assert.equal(pluralRu(2.5, forms), "тренировок");
  assert.equal(pluralRu(21.5, forms), "тренировок");
  assert.equal(pluralRu(-1, forms), "тренировок");
});
