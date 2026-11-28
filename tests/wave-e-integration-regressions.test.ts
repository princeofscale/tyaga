import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BiomechanicalAgentPanel from "../src/components/BiomechanicalAgentPanel";
import { LaidDupSchedule } from "../src/components/LaidDupScheduleModal";
import LaidWeekOrderEditor from "../src/components/LaidWeekOrderEditor";
import SessionInsights from "../src/components/SessionInsights";
import StrengthForecastCard from "../src/components/StrengthForecastCard";
import WorkoutView from "../src/components/WorkoutView";
import { BiomechanicsProfileStore } from "../src/domain/BiomechanicsProfile";
import { ExerciseAlternativesFinder } from "../src/domain/ExerciseAlternatives";
import { JointPainStore } from "../src/domain/JointGuardEngine";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { PeriodizationRules } from "../src/domain/PeriodizationRules";
import { SmartCoach } from "../src/domain/SmartCoach";
import { WorkoutPreview } from "../src/domain/WorkoutPreview";
import { EXERCISES } from "../src/lib/catalog";
import { newDraft } from "../src/lib/draft";
import { DEFAULT_SETTINGS, exerciseById, makeWorkout } from "../src/lib/model";
import type { AccountProfile } from "../src/lib/account";
import type { LaidMaxes, Routine, Workout } from "../src/lib/types";

function withMockStorage(run: (store: Map<string, string>) => void) {
  const orig = (globalThis as { localStorage?: unknown }).localStorage;
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  try {
    run(map);
  } finally {
    if (orig === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
    else (globalThis as { localStorage?: unknown }).localStorage = orig;
  }
}

const MAXES: LaidMaxes = { squat: 140, bench: 100, deadlift: 160, ohp: 80 };

function doneSetWorkout(
  id: string,
  date: string,
  items: Array<{ exerciseId: string; weight: number; reps: number; rir?: number | null }>,
): Workout {
  const w = makeWorkout(items.map((x) => x.exerciseId), [], "UTC", true);
  w.id = id;
  w.date = date;
  w.exercises = w.exercises.map((e, idx) => ({
    ...e,
    sets: [
      {
        id: `${id}-${idx}-0`,
        weight: items[idx].weight,
        reps: items[idx].reps,
        rir: items[idx].rir === undefined ? 2 : items[idx].rir,
        warmup: false,
        done: true,
      },
    ],
  }));
  return w;
}

test("Account-scoped BiomechanicsProfileStore propagates through LaidDupPlan, WorkoutPreview, SessionInsights, and StrengthForecastCard", () => {
  withMockStorage(() => {
    const accountId = "acc-ll-check";
    BiomechanicsProfileStore.save({ longLevers: true, biacromialCm: 42 }, undefined, accountId);

    // 1. LaidDupPlan.day honors accountId -> longLevers loadDrop (14% on W1 H instead of 12%)
    const plan = LaidDupPlan.day("push1", 0, MAXES, { version: "v3", accountId });
    assert.equal(plan.v3LoadDropPct, 14, "LaidDupPlan.day must read account-scoped BiomechanicsProfileStore");

    // 2. WorkoutPreview.analyze honors accountId -> longLevers axial multiplier (1.2x on squat)
    const plannedSquat = makeWorkout(["squat"], [], "UTC", true);
    plannedSquat.exercises[0].sets = Array.from({ length: 5 }, (_, i) => ({
      id: `sq-${i}`,
      weight: 100,
      reps: 5,
      rir: 2,
      warmup: false,
      done: false,
    }));
    const previewAcc = WorkoutPreview.analyze(plannedSquat, [], "2026-11-28", "UTC", { accountId });
    const previewPlain = WorkoutPreview.analyze(plannedSquat, [], "2026-11-28", "UTC", { isLongLimbed: false });
    assert.ok(
      previewAcc.axialAfterPct > previewPlain.axialAfterPct,
      `Expected account-scoped longLevers to raise axialAfterPct (${previewAcc.axialAfterPct} > ${previewPlain.axialAfterPct})`,
    );

    // 3. SessionInsights honors account.id for longLevers in DeloadEngine.evaluateV2
    const account: AccountProfile = {
      id: accountId,
      email: "ll@test.local",
      displayName: "Атлет",
      timeZone: "UTC",
      bodyMassKg: 80,
      revision: 1,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const sqHistory = Array.from({ length: 4 }, (_, i) => {
      const w = doneSetWorkout(`sq-${i}`, `2026-11-${20 + i}`, [{ exerciseId: "squat", weight: 130, reps: 5, rir: 1 }]);
      w.exercises[0].sets = Array.from({ length: 4 }, (_, j) => ({
        id: `s-${i}-${j}`,
        weight: 130,
        reps: 5,
        rir: 1,
        warmup: false,
        done: true,
      }));
      return w;
    });
    const insightsHtmlLL = renderToStaticMarkup(
      createElement(SessionInsights, {
        workout: sqHistory[3],
        settings: DEFAULT_SETTINGS,
        account,
        allWorkouts: sqHistory,
      }),
    );
    const insightsHtmlStd = renderToStaticMarkup(
      createElement(SessionInsights, {
        workout: sqHistory[3],
        settings: DEFAULT_SETTINGS,
        account: { ...account, id: "acc-other" },
        allWorkouts: sqHistory,
      }),
    );
    assert.notEqual(insightsHtmlLL, insightsHtmlStd, "SessionInsights must reflect account-scoped longLevers axial scaling");

    // 4. StrengthForecastCard accepts accountId and shows longLevers adjustment
    const benchHistory = [
      doneSetWorkout("b1", "2026-10-01", [{ exerciseId: "bench", weight: 90, reps: 5, rir: 2 }]),
      doneSetWorkout("b2", "2026-11-20", [{ exerciseId: "bench", weight: 95, reps: 5, rir: 2 }]),
    ];
    const forecastHtml = renderToStaticMarkup(
      createElement(StrengthForecastCard, {
        accountId,
        workouts: benchHistory,
        timeZone: "UTC",
        bodyMassKg: 80,
      }),
    );
    assert.match(forecastHtml, /при длинных рычагах|рычаги ≈/i);

    // 5. BiomechanicalAgentPanel accepts accountId without crashing and passes longLevers
    const agentHtml = renderToStaticMarkup(
      createElement(BiomechanicalAgentPanel, { accountId, initialQuery: "bench" }),
    );
    assert.ok(agentHtml.length > 0);
  });
});

test("DUP v3 liftForDay/catalogSlots/withSubstitutions/SmartCoach/LaidDupSchedule handle legs2 RDL, disabled deloads, painFlags & day names", () => {
  withMockStorage(() => {
    // 1. catalogSlots on v3 maps legs2 (rdl) to deadlift, NOT squat
    const v3Slots = LaidDupPlan.catalogSlots(true, undefined, "v3");
    const rdlSlot = v3Slots.find((s) => s.originalId === "rdl");
    assert.equal(rdlSlot?.lift, "deadlift", `Expected v3 rdl slot lift='deadlift', got ${rdlSlot?.lift}`);
    assert.equal(LaidDupPlan.liftForDay("legs2", "v3"), "deadlift");

    // 2. withSubstitutions preserves disabled week 6 deload (deloadWeeks: []) on v3
    const v3 = LaidDupPlan.routines({
      version: "v3",
      maxes: MAXES,
      extras: true,
      light: true,
      startMonday: "2026-10-05",
    });
    const noDeload = LaidDupPlan.withDeloadWeek(v3, 5, false);
    const subbedOnWeek6 = LaidDupPlan.withSubstitutions(noDeload, { lateral: "lateral-cable-single" }, { fromWeek: 5 });
    assert.deepEqual(subbedOnWeek6[0].periodization?.deloadWeeks, []);
    assert.equal(PeriodizationRules.check(subbedOnWeek6[0].periodization!).ok, true);
    const pushAOnW6 = subbedOnWeek6.find((r) => r.periodization!.day === "push1")!;
    assert.equal(pushAOnW6.exercises[0].sets.length, 3, "Disabled week 6 deload must keep 3 sets (1 top + 2 work)");

    // 3. SmartCoach uses v3 liftLabel and suppresses weight increases on v3 pain-flagged lifts
    const v3WithPain: Routine[] = v3.map((r) => ({
      ...r,
      periodization: { ...r.periodization!, painFlags: ["deadlift", "ohp"] },
    }));
    const trapHist = doneSetWorkout("dl-1", "2026-11-26", [{ exerciseId: "trap-bar-deadlift", weight: 140, reps: 8, rir: 2 }]);
    const nonLaidRoutine: Routine = {
      id: "r-ddp",
      name: "DDP",
      notes: "",
      days: [0],
      exercises: [
        {
          exerciseId: "trap-bar-deadlift",
          repMin: 6,
          repMax: 8,
          sets: [{ id: "s1", weight: 140, reps: 8, rir: 2, warmup: false, done: false }],
        },
      ],
      restSeconds: 120,
      progression: "double",
      repMin: 6,
      repMax: 8,
      incrementKg: 2.5,
      revision: 1,
    };
    const coach = SmartCoach.analyze([trapHist], [...v3WithPain, nonLaidRoutine], "2026-11-28", "UTC", new Date("2026-11-28T12:00:00Z"), "u1");
    assert.ok(
      coach.painFlagsSummary.names.some((n) => /трэп/i.test(n)),
      `Expected v3 deadlift painFlag label to mention трэп-гриф, got ${JSON.stringify(coach.painFlagsSummary.names)}`,
    );
    assert.equal(
      coach.v2.weightIncreaseRecommendations.some((r) => r.exerciseId === "trap-bar-deadlift"),
      false,
      "v3 painFlag on deadlift must block trap-bar-deadlift weight increase recommendation",
    );

    // 4. LaidDupSchedule composition uses v3 dayShort ("Низ B", "Верх B") instead of v1 SHORT ("Присед", "Жим стоя")
    const schedHtml = renderToStaticMarkup(
      createElement(LaidDupSchedule, {
        cycle: v3,
        workouts: [],
        today: "2026-10-07",
        busy: false,
        onClose: () => {},
        onEditDays: () => {},
        onEditSubstitutions: () => {},
        onUpdate: () => {},
        onRecalc: () => {},
      }),
    );
    assert.match(schedHtml, /Низ B/);
    assert.match(schedHtml, /Верх B/);
  });
});

test("LaidWeekOrderEditor keeps unique rest keys while preserving data-slot='rest' for selectors", () => {
  const html = renderToStaticMarkup(
    createElement(LaidWeekOrderEditor, {
      slots: ["legs1", "push1", "pull1", null, "push2", "legs2", null],
      version: "v3",
      onChange: () => {},
    }),
  );
  const restDataSlots = html.match(/data-slot="rest"/g) ?? [];
  assert.equal(restDataSlots.length, 2, "Rest rows must use data-slot='rest' even with multiple rest days");
});

test("ExerciseAlternativesFinder excludes unrelated primary zones when anatomical movers exist and flags zone-only fallbacks", () => {
  const rearDelt = exerciseById("rear-delt-fly")!;
  const rearAlts = ExerciseAlternativesFinder.findAlternatives(rearDelt, EXERCISES, 22);
  const rearIds = rearAlts.map((a) => a.exercise.id);
  assert.ok(rearIds.includes("facepull-er"));
  for (const wrong of ["ohp", "ohp-bar", "push-press", "shoulder-press-machine", "lateral", "lateral-cable-single"]) {
    assert.equal(rearIds.includes(wrong), false, `rear-delt-fly must not recommend ${wrong} as alternative`);
  }

  const backExt = exerciseById("back-extension")!;
  const backIds = ExerciseAlternativesFinder.findAlternatives(backExt, EXERCISES, 22).map((a) => a.exercise.id);
  assert.ok(backIds.includes("deadlift-bar"));
  for (const wrong of ["lat-pulldown", "row", "db-row", "pullup", "shrug-bar"]) {
    assert.equal(backIds.includes(wrong), false, `back-extension must not recommend ${wrong} as alternative`);
  }

  const lat = exerciseById("lateral")!;
  const latIds = ExerciseAlternativesFinder.findAlternatives(lat, EXERCISES, 22).map((a) => a.exercise.id);
  assert.equal(latIds.includes("rear-delt-fly"), false);
  assert.equal(latIds.includes("facepull-er"), false);

  const woodchopper = exerciseById("woodchopper-cable")!;
  const woodAlts = ExerciseAlternativesFinder.findAlternatives(woodchopper, EXERCISES, 22);
  assert.ok(woodAlts.length > 0 && woodAlts.every((a) => a.matchKind === "zone"));

  // Ensure WorkoutView reads account-scoped JointPainStore and BiomechanicsProfileStore
  withMockStorage(() => {
    const now = Date.now();
    const accountId = "acc-wv-1";
    JointPainStore.setZoneStatus("shoulder_anterior", 2, false, now, undefined, accountId);
    BiomechanicsProfileStore.save({ longLevers: true, biacromialCm: 42 }, undefined, accountId);
    assert.equal(JointPainStore.read(undefined, now).length, 0);
    assert.equal(JointPainStore.read(undefined, now, accountId).length, 1);

    const draft = newDraft(makeWorkout(["bench"], [], "UTC"));
    const htmlWithAccount = renderToStaticMarkup(
      createElement(WorkoutView, {
        draft,
        update: () => {},
        settings: DEFAULT_SETTINGS,
        history: [],
        saving: false,
        error: "",
        persistence: "saved",
        onPick: () => {},
        onSave: () => {},
        onDiscard: () => {},
        onExport: () => {},
        onMinimize: () => {},
        onOpenTogether: () => {},
        accountId,
      }),
    );
    assert.match(htmlWithAccount, /lever-cue/, "WorkoutView must render account-scoped long-lever cue");
    assert.match(htmlWithAccount, /wv-jg-banner/, "WorkoutView must render account-scoped JointGuard pain banner");
  });
});
