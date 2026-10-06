import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, balanceScore, buildBalancePlan, estimatedOneRepMax, makeWorkout, muscleLoad, volume, workingSets, weekStart, type SetEntry } from '../src/lib/model';
import { validWorkout, validSettings, InputError } from '../server/validation';

const set = (patch: Partial<SetEntry> = {}): SetEntry => ({ id: 'set1', weight: 60, reps: 10, rir: 2, warmup: false, done: true, ...patch });
test('a hard bench set counts direct chest and half-set shoulders/triceps; warmup and undone sets count zero', () => {
  const w = makeWorkout(['bench']); w.exercises[0].sets = [set(), set({ id: 'warmup', warmup: true }), set({ id: 'undone', done: false })];
  const loads = muscleLoad([w]);
  assert.equal(loads.find(m => m.id === 'chest')!.direct, 1);
  assert.equal(loads.find(m => m.id === 'shoulders')!.indirect, 0.5);
  assert.equal(loads.find(m => m.id === 'triceps')!.total, 0.5);
  assert.equal(workingSets([w]), 1); assert.equal(volume([w]), 600);
});
test('high-RIR logged sets contribute less stimulus', () => {
  const w = makeWorkout(['bench']); w.exercises[0].sets = [set({ rir: 4 }), set({ rir: 8 })];
  assert.equal(muscleLoad([w]).find(m => m.id === 'chest')!.total, 1.25);
});
test('excess chest volume cannot fill another muscle’s missing goal', () => {
  const empty = muscleLoad([]); const chestOnly = empty.map(m => m.id === 'chest' ? { ...m, ratio: 10 } : m);
  assert.equal(balanceScore(chestOnly), 10); assert.equal(balanceScore(empty), 0);
});
test('balance plan respects duration, equipment, and excluded secondary muscles', () => {
  const loads = muscleLoad([]);
  const plan = buildBalancePlan(loads, 20, 'dumbbells', ['back', 'core']);
  assert.ok(plan.minutes <= 20); assert.ok(plan.picks.length);
  for (const p of plan.picks) { assert.ok(['dumbbells', 'bodyweight'].includes(p.exercise.equipment)); assert.ok(![...p.exercise.primary, ...p.exercise.secondary].some(m => ['back', 'core'].includes(m))); }
  assert.ok(plan.after > plan.before);
});
test('fully reached goals do not create extra-volume recommendations', () => {
  const full = muscleLoad([]).map(m => ({ ...m, total: m.goal, ratio: 1 }));
  assert.equal(buildBalancePlan(full, 60, 'gym').picks.length, 0);
});
test('estimated 1RM excludes warmup, unloaded and high-rep sets; one rep equals logged weight', () => {
  assert.equal(estimatedOneRepMax(set({ reps: 1 })), 60);
  assert.equal(estimatedOneRepMax(set({ reps: 13 })), null);
  assert.equal(estimatedOneRepMax(set({ weight: 0 })), null);
  assert.equal(estimatedOneRepMax(set({ warmup: true })), null);
  assert.equal(estimatedOneRepMax(set()), 80);
});
test('week starts on Monday even on Sunday', () => {
  assert.equal(weekStart(new Date('2026-10-11T12:00:00')), '2026-10-05');
});
test('workout validation rejects corrupted dates, invalid numbers and duplicate exercises', () => {
  const w = makeWorkout(['bench']); w.exercises[0].sets = [set()];
  assert.equal(validWorkout(w).id, w.id);
  assert.throws(() => validWorkout({ ...w, date: '2026-99-99' }), InputError);
  assert.throws(() => validWorkout({ ...w, date: '2026-02-30' }), InputError);
  assert.throws(() => validWorkout({ ...w, exercises: [w.exercises[0], w.exercises[0]] }), InputError);
  const broken = structuredClone(w); broken.exercises[0].sets[0].weight = -2;
  assert.throws(() => validWorkout(broken), InputError);
});
test('empty completed history is not accepted as a saved workout', () => {
  assert.throws(() => validWorkout(makeWorkout(['bench'])), InputError);
});
test('weekly goals require a positive bounded integer to keep ratios valid', () => {
  assert.deepEqual(validSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.throws(() => validSettings({ ...DEFAULT_SETTINGS, goals: { ...DEFAULT_SETTINGS.goals, chest: 0 } }), InputError);
  assert.throws(() => validSettings({ ...DEFAULT_SETTINGS, restSeconds: 0 }), InputError);
});
