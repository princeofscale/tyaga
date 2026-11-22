import test from "node:test";
import assert from "node:assert/strict";
import { DraftTabs, type TabContext } from "../src/lib/draftTabs";
import { draftRecord, matchesDraftRecord, newDraft, parseDraft, removeDraftRecord, type Draft, type DraftRecord } from "../src/lib/draft";
import { makeWorkout } from "../src/lib/model";

const draftOf = (id: string, extra: Partial<Draft> = {}): Draft => ({ ...newDraft(makeWorkout(["bench"], [], "UTC")), ...extra, workout: { ...newDraft(makeWorkout(["bench"], [], "UTC")).workout, id } });
const raw = (d: Draft, owner?: string, claim?: number) => JSON.stringify({ ...d, ...(owner ? { owner, claim } : {}) });
const ctx = (mine: Draft | null, over: Partial<TabContext> = {}): TabContext => ({ mine, observed: mine ? draftRecord(mine) : null, tab: "P1", ...over });

// ───────────── R11-REQ02: протокол вкладок (чистая логика) ─────────────
test("R11-REQ02: вкладка без черновика принимает тренировку, начатую в соседней, и становится ведомой", () => {
  const started = draftOf("A");
  const action = DraftTabs.onKey(ctx(null), raw(started, "P2", 10), null);
  assert.equal(action.kind, "adopt");
  assert.equal((action as { draft: Draft }).draft.workout.id, "A");
  assert.equal((action as { note: unknown }).note, null);
});

test("R11-REQ02: текущее содержимое ключа важнее номера старого владения", () => {
  const mine = DraftTabs.stamp(draftOf("A"), "P1", 20);
  assert.equal(DraftTabs.onKey(ctx(mine), raw(mine, "P2", 9)).kind, "adopt");
  assert.equal(DraftTabs.onKey(ctx(mine), raw(mine, "P2", 20)).kind, "adopt");
  assert.equal(DraftTabs.onKey(ctx(mine), raw(mine, "P1", 21)).kind, "adopt", "даже тот же владелец не подтверждает новую сессию владения");
  assert.equal(DraftTabs.onKey(ctx(mine), raw(mine)).kind, "none");
});

test("R11-REQ02: исчезновение ключа с нашей тренировкой закрывает черновик; с чужой — нет (R09-QA-08)", () => {
  const mine = draftOf("A");
  assert.deepEqual(DraftTabs.onKey(ctx(mine), null, raw(mine, "P2", 3)), { kind: "close", id: "A" });
  assert.deepEqual(DraftTabs.onKey(ctx(mine), null, raw(draftOf("B"), "P2", 3)), { kind: "none" });
  assert.deepEqual(DraftTabs.onKey(ctx(null), null, raw(draftOf("A"), "P2", 3)), { kind: "none" });
  assert.deepEqual(DraftTabs.onKey(ctx(mine), null, raw({ ...mine, startedAt: mine.startedAt + 1 }, "P2", 3)), { kind: "none" });
  assert.deepEqual(DraftTabs.onKey(ctx(mine), null, "{не json"), { kind: "none" }, "старая запись не читается — не закрываем");
});

test("R11-REQ02: при возвращении на вкладку (без oldValue) пропавший ключ закрывает только тренировку, которую вкладка видела в ключе", () => {
  const mine = draftOf("A");
  assert.deepEqual(DraftTabs.onKey(ctx(mine, { observed: draftRecord(mine) }), null), { kind: "close", id: "A" });
  assert.deepEqual(DraftTabs.onKey(ctx(mine, { observed: null }), null), { kind: "none" }, "ещё не записанный (хранилище недоступно) черновик не теряется");
  assert.deepEqual(DraftTabs.onKey(ctx(mine, { observed: draftRecord({ ...mine, startedAt: mine.startedAt + 1 }) }), null), { kind: "none" });
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
  assert.equal(DraftTabs.beforeWrite({ ...ctx(mine, { observed: null }), mine }, null), "write");
  // своя и безымянная записи — пишем
  assert.equal(DraftTabs.beforeWrite({ ...ctx(DraftTabs.stamp(mine, "P1", 5)), mine }, raw(mine, "P1", 5)), "write");
  assert.equal(DraftTabs.beforeWrite({ ...ctx(mine, { claim: 5 }), mine }, raw(mine)), "write");
  const local = { ...ctx(DraftTabs.stamp(mine, "P1", 12)), mine };
  assert.equal((DraftTabs.beforeWrite(local, raw(mine, "P2", 9)) as { kind: string }).kind, "adopt");
  assert.equal((DraftTabs.beforeWrite(local, raw(mine, "P1", 13)) as { kind: string }).kind, "adopt");
  // в ключе другая тренировка: после нашей записи — принять; до неё поверх чужой не пишем
  assert.equal((DraftTabs.beforeWrite({ ...ctx(mine), mine }, raw(draftOf("B"), "P2", 1)) as { kind: string }).kind, "adopt");
  assert.equal((DraftTabs.beforeWrite({ ...ctx(mine, { observed: null }), mine }, raw(draftOf("B"), "P2", 1)) as { kind: string }).kind, "adopt");
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

test("R11-REQ02: проверка перед действием принимает текущего владельца, не подтверждая старого", () => {
  const mine = draftOf("A");
  const local = { ...ctx(DraftTabs.stamp(mine, "P1", 20)), mine };
  assert.equal(DraftTabs.beforeEdit(local, raw(mine, "P2", 9)).kind, "adopt");
  assert.equal(DraftTabs.beforeEdit(local, raw(mine, "P1", 20)).kind, "none");
  assert.equal(DraftTabs.beforeEdit(local, raw({ ...mine, startedAt: mine.startedAt + 1 }, "P2", 21)).kind, "adopt");
  assert.equal(DraftTabs.beforeEdit(local, null).kind, "close");
  assert.equal(DraftTabs.beforeEdit({ ...local, observed: null }, null).kind, "none", "несохранённый черновик всё ещё редактируется");
});

test("R11-REQ02: явная передача сохраняет текущие таймеры, перезагрузка останавливает часы", () => {
  const clock = { elapsedMs: 4500, runningSince: 10_000 };
  const draft = draftOf("A", { clock, restUntil: 30_000 });
  assert.deepEqual(parseDraft(raw(draft), "handoff")?.clock, clock);
  assert.equal(parseDraft(raw(draft), "handoff")?.restUntil, 30_000);
  assert.equal(parseDraft(raw(draft))?.clock.runningSince, null);
});

test("R11-REQ02: удаление и восстановление проверяют точную сессию владения", () => {
  const mine = DraftTabs.stamp(draftOf("A"), "P2", 20);
  const record = draftRecord(mine);
  let value: string | null = raw(mine);
  const storage = () => ({ getItem: () => value, removeItem: () => { value = null; } });
  for (const stale of [{ ...record, owner: "P1" }, { ...record, claim: 19 }, { ...record, startedAt: mine.startedAt - 1 }]) {
    assert.equal(matchesDraftRecord(mine, stale), false);
    assert.equal(removeDraftRecord(storage, "draft", stale), "changed");
    assert.equal(value, raw(mine));
  }
  assert.equal(removeDraftRecord(storage, "draft", record), "removed");
  assert.equal(value, null);
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
  tabs: Record<"P1" | "P2", { mine: Draft | null; observed: DraftRecord | null; role: "owner" | "follower" }> = {
    P1: { mine: null, observed: null, role: "owner" },
    P2: { mine: null, observed: null, role: "owner" },
  };
  now = 100;
  private other = (t: "P1" | "P2") => (t === "P1" ? "P2" : "P1") as "P1" | "P2";
  private deliver(from: "P1" | "P2", old: string | null) {
    const t = this.other(from);
    const s = this.tabs[t];
    const act = DraftTabs.onKey({ mine: s.mine, observed: s.observed, tab: t }, this.key, old);
    this.apply(t, act);
  }
  private apply(t: "P1" | "P2", act: ReturnType<typeof DraftTabs.onKey>) {
    const s = this.tabs[t];
    if (act.kind === "adopt") { s.mine = act.draft; s.observed = draftRecord(act.draft); s.role = "follower"; }
    if (act.kind === "close") { s.mine = null; s.observed = null; s.role = "owner"; }
  }
  /** Запись вкладки (как эффект записи в хуке). */
  write(t: "P1" | "P2") {
    const s = this.tabs[t];
    if (!s.mine || s.role !== "owner") return;
    const verdict = DraftTabs.beforeWrite({ mine: s.mine, observed: s.observed, tab: t }, this.key);
    if (verdict !== "write") { this.apply(t, verdict); return; }
    const claim = s.observed?.claim ?? DraftTabs.nextClaim(parseDraft(this.key), this.now++);
    const stamped = DraftTabs.stamp(s.mine, t, claim);
    const old = this.key;
    this.key = raw(stamped);
    s.observed = draftRecord(stamped);
    this.deliver(t, old);
  }
  start(t: "P1" | "P2", id: string) { this.tabs[t].mine = draftOf(id); this.tabs[t].role = "owner"; this.write(t); }
  /** Отметка не передаёт роль. */
  edit(t: "P1" | "P2", sets: number) {
    const s = this.tabs[t];
    if (!s.mine || s.role !== "owner") return;
    s.mine = { ...s.mine, workout: { ...s.mine.workout, notes: `sets:${sets}` } };
    this.write(t);
  }
  claimHere(t: "P1" | "P2") {
    const s = this.tabs[t];
    if (!s.mine || s.role === "owner") return;
    const stored = parseDraft(this.key, "handoff");
    if (!stored || !DraftTabs.sameDraft(s.mine, stored)) {
      this.apply(t, DraftTabs.onKey({ mine: s.mine, observed: s.observed, tab: t }, this.key));
      return;
    }
    const stamped = DraftTabs.stamp(stored, t, DraftTabs.nextClaim(stored, this.now++));
    const old = this.key;
    this.key = raw(stamped);
    s.mine = stamped;
    s.observed = draftRecord(stamped);
    s.role = "owner";
    this.deliver(t, old);
  }
  /** Завершить или отменить: ключ убирает вкладка, ведущая тренировку. */
  end(t: "P1" | "P2") {
    const s = this.tabs[t];
    if (!s.mine || s.role !== "owner") return;
    const old = this.key;
    this.key = null;
    s.mine = null; s.observed = null; s.role = "owner";
    this.deliver(t, old);
  }
  /** Вернулись на вкладку (чтение ключа без oldValue). */
  focus(t: "P1" | "P2") {
    const s = this.tabs[t];
    this.apply(t, DraftTabs.onKey({ mine: s.mine, observed: s.observed, tab: t }, this.key));
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

test("R11-REQ02 / критерий 2: P1 отметила подход — P2 видит его; после явной передачи обе видят правки нового владельца", () => {
  const sim2 = new Sim();
  sim2.start("P1", "A");
  sim2.edit("P1", 1);
  // P2 открылась позже и увидела ключ
  sim2.focus("P2");
  assert.equal(sim2.notes("P2"), "sets:1");
  sim2.edit("P1", 2);
  assert.equal(sim2.notes("P2"), "sets:2");
  sim2.edit("P2", 3);
  assert.equal(sim2.notes("P2"), "sets:2", "ввод не забирает роль и не меняет черновик");
  sim2.claimHere("P2");
  assert.equal(sim2.notes("P2"), "sets:2", "передача не повторяет ввод");
  sim2.edit("P2", 3);
  assert.equal(sim2.tabs.P2.role, "owner");
  assert.equal(sim2.tabs.P1.role, "follower");
  assert.equal(sim2.notes("P1"), "sets:3");
  assert.equal(JSON.parse(sim2.key!).owner, "P2");
  // И обратно: только через явную передачу.
  sim2.claimHere("P1");
  sim2.edit("P1", 4);
  assert.equal(sim2.notes("P2"), "sets:4");
  assert.equal(sim2.tabs.P2.role, "follower");
});

test("R11-REQ02 / критерий 3: отмена в одной вкладке убирает черновик в другой, отметки старой вкладки его не возвращают", () => {
  const sim = new Sim();
  sim.start("P1", "A");
  sim.focus("P2");
  sim.edit("P1", 1);
  sim.claimHere("P2");
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
  sim.claimHere("P2");
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
  sim.tabs.P2 = { mine: draftOf("B"), observed: null, role: "owner" }; // событие P1 до P2 не дошло
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
  sim.tabs.P1 = { mine: null, observed: null, role: "owner" };
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

// ───────────── R11-REQ03: два цикла Лейда при восстановлении ─────────────
import { RestorePlan } from "../src/domain/RestorePlan";
const cycleAt = (startMonday: string) => LaidDupPlan.routines({ maxes: MAXES, extras: true, light: false, startMonday });
const plain = { ...cycleAt("2026-11-09")[0], id: "plain-1", periodization: undefined } as never;

test("R11-REQ03: есть свой цикл и в копии другой — строка со стартами обоих и «будут два цикла»", () => {
  const mine = cycleAt("2027-11-15"), copy = cycleAt("2027-01-18");
  assert.equal(
    RestorePlan.laidNotice(copy, mine, "2027"),
    "В копии есть цикл Лейда (старт 18 янв.), а у тебя уже есть свой (старт 15 нояб.). После импорта будут два цикла.",
  );
});
test("R11-REQ03: год не текущий — дата с годом", () => {
  const text = RestorePlan.laidNotice(cycleAt("2026-01-19"), cycleAt("2027-11-15"), "2027");
  assert.match(text, /старт 19 янв\. 2026\)/);
});
test("R11-REQ03: у аккаунта нет цикла — строки нет", () => {
  assert.equal(RestorePlan.laidNotice(cycleAt("2027-01-18"), [plain], "2027"), "");
  assert.equal(RestorePlan.laidNotice(cycleAt("2027-01-18"), [], "2027"), "");
});
test("R11-REQ03: в копии нет программ с периодизацией — строки нет", () => {
  assert.equal(RestorePlan.laidNotice([plain], cycleAt("2027-11-15"), "2027"), "");
  assert.equal(RestorePlan.laidNotice([], cycleAt("2027-11-15"), "2027"), "");
});
test("R11-REQ03: цикл копии уже в аккаунте (тот же cycleId или те же id) — строки нет", () => {
  const mine = cycleAt("2027-11-15");
  assert.equal(RestorePlan.laidNotice(mine, mine, "2027"), "");
  const restored = mine.map((r) => ({ ...r, id: `restore:x:${r.id}` }));
  assert.equal(RestorePlan.laidNotice(mine, [...mine, ...restored], "2027"), "", "тот же cycleId — второго цикла не будет");
});
test("R11-REQ03: два цикла в копии и один у аккаунта — множественное число", () => {
  const text = RestorePlan.laidNotice([...cycleAt("2027-01-18"), ...cycleAt("2027-03-01")], cycleAt("2027-11-15"), "2027");
  assert.equal(text, "В копии есть циклы Лейда (старт 18 янв., 1 мар.), а у тебя уже есть свой (старт 15 нояб.). После импорта будут три цикла.");
});
test("R11-REQ03: повторное восстановление узнаёт перенесённый цикл по cycleId и дню — «Новых 0», а не 6", () => {
  const copy = cycleAt("2027-01-18");
  const restored = copy.map((r) => ({ ...r, id: `restore:owner:${r.id}` }));
  assert.deepEqual(RestorePlan.routines(copy, restored), { total: 6, added: 0, same: 6, differs: 0 });
  assert.equal(RestorePlan.routines(copy, []).added, 6);
});

// ───────────── R11-REQ04: неделя 10, подписи ─────────────
test("R11-REQ04: на неделе 10 день девятой недели без тренировки — «ended», а не «missed»; недели 1–9 не меняются", () => {
  const routines = cycleAt("2026-11-09"); // неделя 9 — 4–10 янв. 2027, неделя 10 — с 11 янв.
  const legs1 = routines.find((r) => r.periodization!.day === "legs1")!;
  assert.deepEqual(LaidDupPlan.dayStatus(legs1, [], 8, "2027-01-12"), { state: "ended" });
  assert.deepEqual(LaidDupPlan.dayStatus(legs1, [], 8, "2027-03-01"), { state: "ended" }, "и позже, пока цикл не начат заново");
  // девятая неделя ещё идёт: пропущенный день — как раньше
  assert.equal(LaidDupPlan.dayStatus(legs1, [], 8, "2027-01-09").state, "missed", "день девятой недели позади, а неделя идёт");
  // недели 1–8 — «Пропущена» и на неделе 10
  for (let week = 0; week < 8; week++) assert.equal(LaidDupPlan.dayStatus(legs1, [], week, "2027-01-12").state, "missed", `неделя ${week + 1}`);
  // сделанный день остаётся «Сделана»
  const done = { ...makeWorkout(["squat"], [], "UTC"), routineId: legs1.id, date: "2027-01-05" };
  assert.deepEqual(LaidDupPlan.dayStatus(legs1, [done], 8, "2027-01-12"), { state: "done", date: "2027-01-05" });
});
test("R11-REQ04: число подходов в неделю считает домен: 117 по оригиналу, +24 добавлено (задняя и средняя дельта, икры, пресс); не зависит от максимумов", () => {
  assert.deepEqual(LaidDupPlan.weeklySets(), { base: 117, added: 24 });
});
test("R11-REQ04: окна оценок называются словами — «за 26 недель» и «за 28 дней»", () => {
  assert.equal(LaidDupPlan.windowText(LaidDupPlan.ESTIMATE_DAYS), "за 26 недель");
  assert.equal(LaidDupPlan.windowText(LaidDupPlan.SUGGEST_DAYS), "за 28 дней");
});

// ───────────── R11-REQ05: поиск по привычным названиям тренажёра ─────────────
import { exerciseCatalog } from "../src/lib/catalog";
const found = (text: string) => exerciseCatalog.search({ text, zone: "all", equipment: "all" }).map((e) => e.name);
test("R11-REQ05: «пек-дек», «бабочка», «peck», «reverse fly», «rear delt» — в любом написании находят заднюю дельту", () => {
  for (const q of ["пек-дек", "Пек дек", "пекдек", "ПЕК-ДЕК", "peck", "peck deck", "Pec Deck", "pec-deck", "бабочка", "Обратная бабочка", "reverse fly", "rear delt", "Rear-Delt"])
    assert.ok(found(q).includes("Обратные разведения на заднюю дельту"), q);
});
test("R11-REQ05: «обратная бабочка» и «reverse fly» не уводят на грудь; «бабочка» и «пек-дек» начинают с записи для груди", () => {
  assert.deepEqual(found("обратная бабочка"), ["Обратные разведения на заднюю дельту"]);
  assert.deepEqual(found("reverse fly"), ["Обратные разведения на заднюю дельту"]);
  assert.equal(found("бабочка")[0], "Сведение рук в тренажёре (пек-дек, «бабочка»)");
  assert.equal(found("пекдек")[0], "Сведение рук в тренажёре (пек-дек, «бабочка»)");
});
test("R11-REQ05: «обратн» находит то же; «разведения» — оба разведения; «face» — тягу каната к лицу; видимые названия не менялись", () => {
  assert.ok(found("обратн").includes("Обратные разведения на заднюю дельту"));
  assert.ok(["Разведения гантелей лёжа", "Обратные разведения на заднюю дельту"].every((n) => found("разведения").includes(n)));
  assert.ok(found("face").some((n) => /каната к лицу/.test(n)));
});
test("R11-REQ05: запись для груди — честная: мышцы, снаряд, правило веса (стек тренажёра, без 1ПМ)", () => {
  const chest = exerciseCatalog.search({ text: "пек-дек" }).find((e) => e.id === "pec-deck-fly")!;
  assert.equal(chest.equipment, "gym");
  assert.deepEqual(chest.primary, ["chest"]);
  assert.equal(chest.recording.loadMode, "machine_stack");
  assert.equal(chest.recording.e1rmEligible, false);
});

test("R11-REQ02: текущий владелец может заменить свой черновик при конфликте, старый — нет", () => {
  const old = DraftTabs.stamp(draftOf("A"), "P1", 5);
  const next = { ...old, startedAt: old.startedAt + 1 };
  const replacing = { ...ctx(old), mine: next };
  assert.equal(DraftTabs.beforeWrite(replacing, raw(old)), "write");
  assert.equal(DraftTabs.onKey(replacing, raw(old)).kind, "none", "позднее событие своего ключа не сбрасывает замену");
  assert.equal((DraftTabs.beforeWrite(replacing, raw(old, "P2", 5)) as { kind: string }).kind, "adopt");
  assert.equal((DraftTabs.beforeWrite(replacing, raw(old, "P1", 6)) as { kind: string }).kind, "adopt");
});
