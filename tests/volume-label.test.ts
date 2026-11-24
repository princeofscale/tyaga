import test from "node:test";
import assert from "node:assert/strict";
import { VolumeLabel } from "../src/domain/VolumeLabel";
import { ProgressOverview } from "../src/domain/ProgressOverview";
import { makeWorkout } from "../src/lib/model";

test("no countable work is a dash, never zero tons", () => {
  for (const kg of [0, -1, Number.NaN]) assert.equal(VolumeLabel.short(kg), "—");
  assert.doesNotMatch(VolumeLabel.short(0), /0/);
});
test("literal unknown-load import remains unknown in progress overview and has an explanation", () => {
  const workout = makeWorkout(["bench"], [], "UTC");
  workout.id = "literal-import";
  workout.date = "2026-11-10";
  workout.exercises[0] = {
    ...workout.exercises[0],
    externalDefinition: {
      id: "custom:literal:deadlift",
      familyId: "custom:literal:deadlift",
      name: "Deadlift (Barbell)", nameEn: "Deadlift (Barbell)", aliases: [], tip: "",
      equipment: "gym", recording: { type: "reps", loadMode: "legacy_unspecified", implementCount: 1, laterality: "bilateral", repsMode: "total", e1rmEligible: false },
      primary: [], secondary: [], variant: "", jointActions: [], muscles: [], evidence: [], limitations: "",
      provenance: { curator: "source", reviewedAt: null, license: "source", reviewStatus: "source-unreviewed" },
      catalogRevision: 3,
    },
    exerciseId: "custom:literal:deadlift",
  };
  workout.exercises[0].sets[0].done = true;
  const overview = ProgressOverview.calculate([workout], 28, "UTC", new Date("2026-11-11T12:00:00Z"));
  assert.equal(overview.volumeKg, 0);
  assert.equal(overview.volumeOmitted, 1);
  assert.equal(VolumeLabel.short(overview.volumeKg), "—");
  assert.match(VolumeLabel.reason(overview.volumeOmitted), /без правила/);
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
test("Обзор называет причину прямо, без склейки «— Тоннаж не считается…»", () => {
  assert.equal(VolumeLabel.overview(0, 7), "Тоннаж: — · 7 подх. без правила веса");
  assert.equal(VolumeLabel.overview(0, 0), "Тоннаж: — · нет подходов со свободным весом");
  assert.match(VolumeLabel.overview(12400, 0).replace(/\s/g, " "), /^12,4 т свободных весов$/);
  assert.doesNotMatch(VolumeLabel.overview(0, 7), /тренажёре или с весом тела/);
});
