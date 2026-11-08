import test from "node:test";
import assert from "node:assert/strict";
import { AnatomyPresenter } from "../src/domain/AnatomyPresenter";
import { CHEST_HEADS, DELTOID_HEADS } from "../src/data/muscles";
import { anatomicalLoad, exerciseById, makeWorkout, type Workout, type SetEntry } from "../src/lib/model";

function createWorkout(exerciseId: string, setsCount = 3): Workout {
  const w = makeWorkout([exerciseId], [], "UTC");
  w.exercises[0].sets = Array.from({ length: setsCount }, (_, i) => ({
    id: "s" + i,
    weight: 80,
    reps: 10,
    rir: 2,
    done: true,
    warmup: false,
  }));
  return w;
}

test("CHEST_HEADS and DELTOID_HEADS metadata is defined with 3 distinct heads each", () => {
  assert.equal(CHEST_HEADS.length, 3);
  assert.deepEqual(
    CHEST_HEADS.map((h) => h.slug),
    ["chest-upper", "chest-mid", "chest-lower"],
  );

  assert.equal(DELTOID_HEADS.length, 3);
  assert.deepEqual(
    DELTOID_HEADS.map((h) => h.slug),
    ["deltoid-anterior", "deltoid-middle", "deltoid-posterior"],
  );
});

test("AnatomyPresenter retrieves individual subparts for chest and deltoids", () => {
  const p = new AnatomyPresenter([]);
  const upper = p.part("chest-upper", "front");
  assert.ok(upper);
  assert.equal(upper.name, "Верх груди");
  assert.equal(upper.zone, "chest");

  const mid = p.part("chest-mid", "front");
  assert.ok(mid);
  assert.equal(mid.name, "Середина груди");

  const lower = p.part("chest-lower", "front");
  assert.ok(lower);
  assert.equal(lower.name, "Низ груди");

  const antDelt = p.part("deltoid-anterior", "front");
  assert.ok(antDelt);

  const tibialis = p.part("tibialis", "front");
  assert.ok(tibialis);
  assert.equal(tibialis.zone, "calves");

  const neck = p.part("neck", "front");
  assert.ok(neck);
  assert.equal(neck.zone, "back");
  assert.equal(antDelt.name, "Передняя дельта");

  const midDelt = p.part("deltoid-middle", "front");
  assert.ok(midDelt);
  assert.equal(midDelt.name, "Средняя дельта");

  const postDelt = p.part("deltoid-posterior", "back");
  assert.ok(postDelt);
  assert.equal(postDelt.name, "Задняя дельта");
});

test("incline bench activates upper chest (clavicular head) as primary", () => {
  const w = createWorkout("incline-db", 4);
  const p = new AnatomyPresenter([], [w]);
  const upper = p.part("chest-upper", "front")!;
  const actUpper = p.activity(upper);
  assert.equal(actUpper.direct, 4);

  const ex = exerciseById("incline-db")!;
  assert.equal(p.exerciseRole(upper, ex), "primary");

  const antDelt = p.part("deltoid-anterior", "front")!;
  assert.equal(p.exerciseRole(antDelt, ex), "assistant");
});

test("high cable fly activates lower chest (abdominal head) as primary", () => {
  const w = createWorkout("high-cable-fly", 3);
  const p = new AnatomyPresenter([], [w]);
  const lower = p.part("chest-lower", "front")!;
  const actLower = p.activity(lower);
  assert.equal(actLower.direct, 3);

  const ex = exerciseById("high-cable-fly")!;
  assert.equal(p.exerciseRole(lower, ex), "primary");
});

test("flat bench press activates mid chest as primary and upper/lower as assisting", () => {
  const w = createWorkout("bench", 3);
  const p = new AnatomyPresenter([], [w]);
  const mid = p.part("chest-mid", "front")!;
  const actMid = p.activity(mid);
  assert.equal(actMid.direct, 3);

  const upper = p.part("chest-upper", "front")!;
  const actUpper = p.activity(upper);
  assert.equal(actUpper.assisting, 3);

  const lower = p.part("chest-lower", "front")!;
  const actLower = p.activity(lower);
  assert.equal(actLower.assisting, 3);
});

test("deltoid heads distinguish anterior, middle and posterior roles", () => {
  // Lateral raises -> middle delt primary
  const lateralW = createWorkout("lateral", 4);
  const pLateral = new AnatomyPresenter([], [lateralW]);
  const midDelt = pLateral.part("deltoid-middle", "front")!;
  assert.equal(pLateral.activity(midDelt).direct, 4);
  const antDelt = pLateral.part("deltoid-anterior", "front")!;
  assert.equal(pLateral.activity(antDelt).direct, 0);

  // Rear delt fly -> posterior delt primary
  const rearW = createWorkout("rear-delt-fly", 3);
  const pRear = new AnatomyPresenter([], [rearW]);
  const postDelt = pRear.part("deltoid-posterior", "back")!;
  assert.equal(pRear.activity(postDelt).direct, 3);

  // OHP -> anterior and middle delt primary
  const ohpW = createWorkout("ohp", 3);
  const pOhp = new AnatomyPresenter([], [ohpW]);
  assert.equal(pOhp.activity(antDelt).direct, 3);
  assert.equal(pOhp.activity(midDelt).direct, 3);
  assert.equal(pOhp.activity(postDelt).direct, 0);
});

test("anatomicalLoad calculates sets for new chest heads alongside deltoid heads", () => {
  const w = createWorkout("incline-db", 3);
  const rows = anatomicalLoad([w]);
  const upper = rows.find((r) => r.id === "pectoralis-clavicular");
  assert.ok(upper);
  assert.equal(upper.direct, 3);

  const mid = rows.find((r) => r.id === "pectoralis-sternal");
  assert.ok(mid);
  assert.equal(mid.assisting, 3);
});
