import test from "node:test";
import assert from "node:assert/strict";
import { VolumeLabel } from "../src/domain/VolumeLabel";

test("no countable work is a dash, never zero tons", () => {
  for (const kg of [0, -1, Number.NaN]) assert.equal(VolumeLabel.short(kg), "—");
  assert.doesNotMatch(VolumeLabel.short(0), /0/);
});
test("a small or real tonnage keeps a unit and does not round to 0 т", () => {
  assert.equal(VolumeLabel.short(480).replace(/\s/g, " "), "0,5 т");
  assert.equal(VolumeLabel.short(30).replace(/\s/g, " "), "30 кг");
  assert.equal(VolumeLabel.short(12400).replace(/\s/g, " "), "12,4 т");
});
test("the reason distinguishes omitted sets from an empty week", () => {
  assert.match(VolumeLabel.reason(3), /без правила/);
  assert.match(VolumeLabel.reason(0), /Нет подходов/);
  assert.equal(VolumeLabel.caption(0, 3), "тоннаж не считается");
  assert.equal(VolumeLabel.caption(500, 3), "");
  assert.equal(VolumeLabel.caption(0, 0), "");
});
