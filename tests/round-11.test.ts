import test from "node:test";
import assert from "node:assert/strict";
import { DraftTabs, type TabContext } from "../src/lib/draftTabs";
import { newDraft, type Draft } from "../src/lib/draft";
import { makeWorkout } from "../src/lib/model";

const draftOf = (id: string, extra: Partial<Draft> = {}): Draft => ({ ...newDraft(makeWorkout(["bench"], [], "UTC")), ...extra, workout: { ...newDraft(makeWorkout(["bench"], [], "UTC")).workout, id } });
const raw = (d: Draft, owner?: string, claim?: number) => JSON.stringify({ ...d, ...(owner ? { owner, claim } : {}) });
const ctx = (mine: Draft | null, over: Partial<TabContext> = {}): TabContext => ({ mine, ownId: mine?.workout.id ?? null, tab: "P1", claim: 0, ...over });

// ───────────── R11-REQ02: протокол вкладок (чистая логика) ─────────────
test("R11-REQ02: вкладка без черновика принимает тренировку, начатую в соседней, и становится ведомой", () => {
  const started = draftOf("A");
  const action = DraftTabs.onKey(ctx(null), raw(started, "P2", 10), null);
  assert.equal(action.kind, "adopt");
  assert.equal((action as { draft: Draft }).draft.workout.id, "A");
  assert.equal((action as { note: unknown }).note, null);
});

test("R11-REQ02: чужую запись того же черновика принимают, если её вкладка стала основной не раньше нашей; своя более новая — подтверждается", () => {
  const mine = draftOf("A");
  assert.equal(DraftTabs.onKey(ctx(mine, { claim: 5 }), raw(mine, "P2", 9), "x").kind, "adopt");
  assert.equal(DraftTabs.onKey(ctx(mine, { claim: 9 }), raw(mine, "P2", 9), "x").kind, "adopt", "при равенстве идём за записанным в ключе");
  assert.equal(DraftTabs.onKey(ctx(mine, { claim: 20 }), raw(mine, "P2", 9), "x").kind, "reassert");
  // собственная запись и запись без владельца (прежняя версия приложения) — ничего
  assert.equal(DraftTabs.onKey(ctx(mine, { claim: 5 }), raw(mine, "P1", 5), "x").kind, "none");
  assert.equal(DraftTabs.onKey(ctx(mine, { claim: 5 }), raw(mine), "x").kind, "none");
});

test("R11-REQ02: исчезновение ключа с нашей тренировкой закрывает черновик; с чужой — нет (R09-QA-08)", () => {
  const mine = draftOf("A");
  assert.deepEqual(DraftTabs.onKey(ctx(mine), null, raw(draftOf("A"), "P2", 3)), { kind: "close", id: "A" });
  assert.deepEqual(DraftTabs.onKey(ctx(mine), null, raw(draftOf("B"), "P2", 3)), { kind: "none" });
  assert.deepEqual(DraftTabs.onKey(ctx(null), null, raw(draftOf("A"), "P2", 3)), { kind: "none" });
  assert.deepEqual(DraftTabs.onKey(ctx(mine), null, "{не json"), { kind: "none" }, "старая запись не читается — не закрываем");
});

test("R11-REQ02: при возвращении на вкладку (без oldValue) пропавший ключ закрывает только тренировку, которую вкладка видела в ключе", () => {
  const mine = draftOf("A");
  assert.deepEqual(DraftTabs.onKey(ctx(mine, { ownId: "A" }), null), { kind: "close", id: "A" });
  assert.deepEqual(DraftTabs.onKey(ctx(mine, { ownId: null }), null), { kind: "none" }, "ещё не записанный (хранилище недоступно) черновик не теряется");
  assert.deepEqual(DraftTabs.onKey(ctx(mine, { ownId: "Z" }), null), { kind: "none" });
});

test("R11-REQ02: в ключе другая тренировка — вкладка открывает её с пояснением, а не перетирает", () => {
  const mine = draftOf("A");
  const action = DraftTabs.onKey(ctx(mine), raw(draftOf("B"), "P2", 4), raw(mine, "P1", 2));
  assert.equal(action.kind, "adopt");
  assert.equal((action as { note: unknown }).note, "other");
});

test("R11-REQ02: перед записью — не воскрешаем закрытое, не перебиваем более новую чужую запись, пишем свою", () => {
  const mine = draftOf("A");
  // ключа нет: тренировку записывали мы — её закрыли в другом окне; новая (мы ещё не писали) — пишем
  assert.deepEqual(DraftTabs.beforeWrite({ ...ctx(mine), mine }, null), { kind: "close", id: "A" });
  assert.equal(DraftTabs.beforeWrite({ ...ctx(mine, { ownId: null }), mine }, null), "write");
  // своя и безымянная записи — пишем
  assert.equal(DraftTabs.beforeWrite({ ...ctx(mine, { claim: 5 }), mine }, raw(mine, "P1", 5)), "write");
  assert.equal(DraftTabs.beforeWrite({ ...ctx(mine, { claim: 5 }), mine }, raw(mine)), "write");
  // чужая запись новее нашей основной — не пишем, принимаем; наша новее — пишем
  assert.equal((DraftTabs.beforeWrite({ ...ctx(mine, { claim: 5 }), mine }, raw(mine, "P2", 9)) as { kind: string }).kind, "adopt");
  assert.equal(DraftTabs.beforeWrite({ ...ctx(mine, { claim: 12 }), mine }, raw(mine, "P2", 9)), "write");
  // в ключе другая тренировка: после нашей записи — принять; до неё поверх чужой не пишем
  assert.equal((DraftTabs.beforeWrite({ ...ctx(mine), mine }, raw(draftOf("B"), "P2", 1)) as { kind: string }).kind, "adopt");
  assert.equal((DraftTabs.beforeWrite({ ...ctx(mine, { ownId: null }), mine }, raw(draftOf("B"), "P2", 1)) as { kind: string }).kind, "adopt");
  // ключ нечитаем — пишем (хранилище починят этой записью)
  assert.equal(DraftTabs.beforeWrite({ ...ctx(mine), mine }, "{мусор"), "write");
});

test("R11-REQ02: момент «стала основной» всегда позже записанного; запись несёт владельца", () => {
  const stored = draftOf("A", { claim: 5_000_000_000_000 } as Partial<Draft>);
  assert.equal(DraftTabs.nextClaim(stored, 1), 5_000_000_000_001);
  assert.equal(DraftTabs.nextClaim(null, 77), 77);
  const stamped = DraftTabs.stamp(draftOf("A"), "P1", 9);
  assert.equal(stamped.owner, "P1");
  assert.equal(stamped.claim, 9);
});

test("R11-REQ02: загрузка с чужим черновиком — ведомая, если есть живое окно; без него — основная; свой или безымянный — основная", () => {
  const a = draftOf("A");
  assert.equal(DraftTabs.initialRole(null, "P1", false), "owner");
  assert.equal(DraftTabs.initialRole({ ...a, owner: "P1", claim: 1 }, "P1", true), "owner");
  assert.equal(DraftTabs.initialRole(a, "P1", true), "owner");
  assert.equal(DraftTabs.initialRole({ ...a, owner: "P2", claim: 1 }, "P1", true), "follower");
  assert.equal(DraftTabs.initialRole({ ...a, owner: "P2", claim: 1 }, "P1", false), "owner");
});

// ───────────── Перебор порядков событий двух вкладок ─────────────
/** Две вкладки поверх общего «ключа»: прогон по тем же правилам, что в приложении (без React). */
class Sim {
  key: string | null = null;
  tabs: Record<"P1" | "P2", { mine: Draft | null; ownId: string | null; claim: number; role: "owner" | "follower" }> = {
    P1: { mine: null, ownId: null, claim: 0, role: "owner" },
    P2: { mine: null, ownId: null, claim: 0, role: "owner" },
  };
  now = 100;
  private other = (t: "P1" | "P2") => (t === "P1" ? "P2" : "P1") as "P1" | "P2";
  private deliver(from: "P1" | "P2", old: string | null) {
    const t = this.other(from);
    const s = this.tabs[t];
    const act = DraftTabs.onKey({ mine: s.mine, ownId: s.ownId, tab: t, claim: s.claim }, this.key, old);
    this.apply(t, act);
  }
  private apply(t: "P1" | "P2", act: ReturnType<typeof DraftTabs.onKey>) {
    const s = this.tabs[t];
    if (act.kind === "adopt") { s.mine = act.draft; s.ownId = act.draft.workout.id; s.role = "follower"; }
    if (act.kind === "close") { s.mine = null; s.ownId = null; s.claim = 0; s.role = "owner"; }
    if (act.kind === "reassert") this.write(t);
  }
  /** Запись вкладки (как эффект записи в хуке). */
  write(t: "P1" | "P2") {
    const s = this.tabs[t];
    if (!s.mine || s.role !== "owner") return;
    const verdict = DraftTabs.beforeWrite({ mine: s.mine, ownId: s.ownId, tab: t, claim: s.claim }, this.key);
    if (verdict !== "write") { this.apply(t, verdict); return; }
    if (!s.claim) s.claim = DraftTabs.nextClaim(this.key ? JSON.parse(this.key) : null, this.now++);
    const old = this.key;
    this.key = JSON.stringify(DraftTabs.stamp(s.mine, t, s.claim));
    s.ownId = s.mine.workout.id;
    this.deliver(t, old);
  }
  start(t: "P1" | "P2", id: string) { this.tabs[t].mine = draftOf(id); this.tabs[t].role = "owner"; this.write(t); }
  /** Человек отметил подход в вкладке: сначала нажатие делает её основной (как в приложении), потом правка. */
  edit(t: "P1" | "P2", sets: number) {
    const s = this.tabs[t];
    if (!s.mine) return;
    if (s.role === "follower") this.claimHere(t);
    s.mine = { ...s.mine, workout: { ...s.mine.workout, notes: `sets:${sets}` } };
    this.write(t);
  }
  claimHere(t: "P1" | "P2") {
    const s = this.tabs[t];
    if (!s.mine || s.role === "owner") return;
    if (this.key === null && s.ownId === s.mine.workout.id) { this.apply(t, { kind: "close", id: s.mine.workout.id }); return; }
    const stored = this.key ? (JSON.parse(this.key) as Draft) : null;
    s.claim = DraftTabs.nextClaim(stored, this.now++);
    s.role = "owner";
    if (stored && stored.workout.id === s.mine.workout.id) s.mine = stored;
    this.write(t);
  }
  /** Завершить или отменить: ключ убирает вкладка, ведущая тренировку. */
  end(t: "P1" | "P2") {
    const s = this.tabs[t];
    if (!s.mine) return;
    if (s.role === "follower") this.claimHere(t);
    const old = this.key;
    this.key = null;
    s.mine = null; s.ownId = null; s.claim = 0; s.role = "owner";
    this.deliver(t, old);
  }
  /** Вернулись на вкладку (чтение ключа без oldValue). */
  focus(t: "P1" | "P2") {
    const s = this.tabs[t];
    this.apply(t, DraftTabs.onKey({ mine: s.mine, ownId: s.ownId, tab: t, claim: s.claim }, this.key));
  }
  /** Тихие события, которые вкладка не получила: стираем её события (имитация замороженной вкладки). */
  notes(t: "P1" | "P2") { return this.tabs[t].mine?.workout.notes; }
}

test("R11-REQ02 / критерий 1: P1 на «Сегодня», P2 начала тренировку — P1 видит её; «Начать» в P1 вторую не создаёт", () => {
  const sim = new Sim();
  sim.start("P2", "A");
  assert.equal(sim.tabs.P1.mine?.workout.id, "A");
  assert.equal(sim.tabs.P1.role, "follower");
  // P1 «Начать»: у неё уже есть черновик; ключ остаётся одним и тем же
  assert.equal(JSON.parse(sim.key!).workout.id, "A");
});

test("R11-REQ02 / критерий 2: P1 отметила подход — P2 видит его; ввод во второй вкладке подхватывает последняя пишущая", () => {
  const sim2 = new Sim();
  sim2.start("P1", "A");
  sim2.edit("P1", 1);
  // P2 открылась позже и увидела ключ
  sim2.focus("P2");
  assert.equal(sim2.notes("P2"), "sets:1");
  sim2.edit("P1", 2);
  assert.equal(sim2.notes("P2"), "sets:2");
  // человек печатает в P2: она становится основной, P1 — ведомой и видит то же
  sim2.edit("P2", 3);
  assert.equal(sim2.tabs.P2.role, "owner");
  assert.equal(sim2.tabs.P1.role, "follower");
  assert.equal(sim2.notes("P1"), "sets:3");
  assert.equal(JSON.parse(sim2.key!).owner, "P2");
  // и обратно
  sim2.edit("P1", 4);
  assert.equal(sim2.notes("P2"), "sets:4");
  assert.equal(sim2.tabs.P2.role, "follower");
});

test("R11-REQ02 / критерий 3: отмена в одной вкладке убирает черновик в другой, отметки старой вкладки его не возвращают", () => {
  const sim = new Sim();
  sim.start("P1", "A");
  sim.focus("P2");
  sim.edit("P1", 1);
  sim.end("P2");
  assert.equal(sim.key, null);
  assert.equal(sim.tabs.P1.mine, null, "P1 убрала черновик");
  // отметка подхода в P1 после этого: черновика нет — писать нечего
  sim.edit("P1", 2);
  assert.equal(sim.key, null);
});

test("R11-REQ02: вкладка, не получившая событие об отмене, при возвращении закрывает черновик и не воскрешает его", () => {
  const sim = new Sim();
  sim.start("P1", "A");
  sim.focus("P2");
  // P2 заморожена: событие отмены не дошло
  const frozen = structuredClone(sim.tabs.P1);
  sim.end("P2");
  sim.tabs.P1 = frozen;
  assert.ok(sim.tabs.P1.mine);
  // человек вернулся на P1 и сразу отметил подход: сначала сверка, потом правка
  sim.focus("P1");
  assert.equal(sim.tabs.P1.mine, null);
  assert.equal(sim.key, null);
  // даже без сверки запись не воскресит: перед записью ключа нет, а тренировку писали мы
  sim.tabs.P1 = frozen;
  sim.edit("P1", 5);
  assert.equal(sim.key, null);
  assert.equal(sim.tabs.P1.mine, null);
});

test("R11-REQ02: P1 заканчивает X и начинает Y, P2 со старым X: на экране P2 — Y, «Отмена» старого X чужой Y не стирает", () => {
  const sim = new Sim();
  sim.start("P1", "X");
  sim.focus("P2");
  sim.end("P1");
  assert.equal(sim.tabs.P2.mine, null, "P2 закрыла X");
  sim.start("P1", "Y");
  assert.equal(sim.tabs.P2.mine?.workout.id, "Y", "Y видна и во второй вкладке");
  assert.equal(JSON.parse(sim.key!).workout.id, "Y");
});

test("R11-REQ02: «Начать» в обеих вкладках почти одновременно — остаётся одна тренировка, ввод не пропадает молча", () => {
  const sim = new Sim();
  // событие первой записи ещё не дошло до P2: она тоже «начала»
  sim.tabs.P1.mine = draftOf("A");
  sim.write("P1");
  const keyAfterP1 = sim.key;
  sim.tabs.P2 = { mine: draftOf("B"), ownId: null, claim: 0, role: "owner" }; // событие P1 до P2 не дошло
  sim.key = keyAfterP1; // P2 видит ключ перед своей записью
  sim.write("P2");
  assert.equal(JSON.parse(sim.key!).workout.id, "A", "поверх чужого начатого не пишем");
  assert.equal(sim.tabs.P2.mine?.workout.id, "A", "P2 открыла идущую тренировку");
});

test("R11-REQ02: перезагрузка основной вкладки и закрытие вкладки — черновик на месте, продолжает любая", () => {
  const sim = new Sim();
  sim.start("P1", "A");
  sim.edit("P1", 1);
  // P1 закрыта: ключ остаётся (закрытие вкладки его не убирает); P2 открылась с ним
  const stored = JSON.parse(sim.key!) as Draft;
  assert.equal(DraftTabs.initialRole(stored, "P2", false), "owner");
  assert.equal(DraftTabs.initialRole(stored, "P2", true), "follower");
  sim.tabs.P1 = { mine: null, ownId: null, claim: 0, role: "owner" };
  sim.focus("P2");
  assert.equal(sim.notes("P2"), "sets:1");
});

// ───────────── R11-REQ01: Лейд — «Повторить прошлые» и «+2,5 кг» не трогают вес по плану ─────────────
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import type { LaidMaxes } from "../src/lib/types";

const MAXES: LaidMaxes = { squat: 100, bench: 80, deadlift: 140, ohp: 60 };
const cycle = LaidDupPlan.routines({ maxes: MAXES, extras: true, light: false, startMonday: "2026-11-09" });

test("R11-REQ01: у базового упражнения дня вес задан планом, у вспомогательных нет — решает домен", () => {
  for (const day of LaidDupPlan.DAYS) {
    const routine = cycle.find((r) => r.periodization!.day === day)!;
    const workout = new TrainingProgram(routine).start([], "UTC", "2026-11-10");
    const lift = LaidDupPlan.LIFT_EXERCISE[LaidDupPlan.LIFT_OF[day]];
    const planned = workout.exercises.filter((e) => LaidDupPlan.hasPlanWeight(e));
    assert.deepEqual(planned.map((e) => e.exerciseId), [lift], day);
    assert.ok(workout.exercises.length > 1, "вспомогательные есть и кнопки у них остаются");
  }
});

test("R11-REQ01: обычная программа и пустая тренировка — вес не по плану", () => {
  assert.equal(LaidDupPlan.hasPlanWeight({}), false);
  assert.equal(LaidDupPlan.hasPlanWeight({ progressionNote: undefined }), false);
  assert.equal(LaidDupPlan.hasPlanWeight({ progressionNote: "Двойная прогрессия: все рабочие подходы достигли 12" }), false);
  assert.equal(LaidDupPlan.hasPlanWeight({ progressionNote: "Добавлено к оригиналу Лейда: в его таблице этого нет." }), false);
  const plain = { ...cycle[1], periodization: undefined };
  const workout = new TrainingProgram(plain).start([], "UTC", "2026-11-10");
  assert.equal(workout.exercises.some((e) => LaidDupPlan.hasPlanWeight(e)), false);
});

test("R11-REQ01: заметка плана остаётся прежним текстом (домен не менялся)", () => {
  const note = LaidDupPlan.describe(LaidDupPlan.day("push1", 0, MAXES));
  assert.match(note, /Тяжёлый подход: 1 × 1 повторение · 95 % от 1ПМ \(80 кг\) = 75 кг/);
  assert.match(note, /Затем 4 × 4 повторения · 85 % = 67,5 кг/);
  assert.equal(LaidDupPlan.hasPlanWeight({ progressionNote: note }), true);
});
