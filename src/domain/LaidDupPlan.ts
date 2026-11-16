import { addCalendarDays, isCalendarDate } from "../lib/calendar";
import { estimatedOneRepMax, makeExerciseEntry, makeSets } from "../lib/model";
import type {
  LaidDay,
  LaidMaxes,
  Routine,
  RoutinePeriodization,
  SetEntry,
  Workout,
  WorkoutExercise,
} from "../lib/types";

export type LaidLift = keyof LaidMaxes;
export const LAID_WEEKS = 9;
/** Недель в одной волне: три волны по три недели. */
const WAVE_WEEKS = 3;
const MAX_KG = 500;

/** Позиция недели в цикле: `raw` — номер недели от старта (0 — первая; < 0 до старта, ≥ 9 после цикла). */
export type LaidPosition = {
  raw: number;
  /** Неделя схемы: 0…8; до старта — первая, после цикла — девятая. */
  week: number;
  wave: 1 | 2 | 3;
  /** Неделя внутри волны: 0, 1, 2. */
  inWave: 0 | 1 | 2;
  finished: boolean;
  beforeStart: boolean;
};

type HeavyScheme = 1 | 3 | 5;
type WorkReps = 2 | 4 | 6 | 8 | 10 | 12;
/** Схема дня по неделе волны: повторения тяжёлого подхода и четырёх рабочих. */
type DayScheme = { heavy: [HeavyScheme, HeavyScheme, HeavyScheme]; work: [WorkReps, WorkReps, WorkReps] };

export type LaidPlanSet = { reps: number; percent: number; weightKg: number };
export type LaidDayPlan = {
  day: LaidDay;
  position: LaidPosition;
  lift: LaidLift;
  liftExerciseId: string;
  maxKg: number;
  heavy: LaidPlanSet & { light: boolean };
  work: LaidPlanSet & { sets: number };
};

type Aux = {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** Повторения зависят от недели волны (push press, жим на наклонной). */
  byWave?: [number, number, number];
};
type Layout = { aux: Aux[]; extras: Aux[] };

const a = (exerciseId: string, repMin = 10, repMax = repMin, sets = 3): Aux => ({ exerciseId, sets, repMin, repMax });
const LEGS_AUX = [a("rdl"), a("lunge-bar"), a("back-extension")];
const PULL_AUX = [a("deadlift-stiff"), a("pullup-weighted", 8, 10), a("row-yates"), a("shrug-bar"), a("curl-bar"), a("hammer-seated")];
const PUSH_TAIL = [a("lateral"), a("skullcrusher-ez"), a("triceps-db")];

/**
 * Программа Дэвида Лейда (DUP, 9 недель, 6 дней) по распространяемой таблице `David Laid DUP Program.xlsx`.
 * Схема недель и состав дней — по таблице; проценты округлены и усреднены между максимумами (реконструкция),
 * поэтому официальный калькулятор может дать другие числа. Чистая логика: ни хранилища, ни React.
 */
export class LaidDupPlan {
  static readonly DAYS: LaidDay[] = ["legs1", "push1", "pull1", "legs2", "push2", "pull2"];
  static readonly NAMES: Record<LaidDay, string> = {
    legs1: "Лейд · Ноги 1",
    push1: "Лейд · Жим 1",
    pull1: "Лейд · Тяга 1",
    legs2: "Лейд · Ноги 2",
    push2: "Лейд · Жим 2",
    pull2: "Лейд · Тяга 2",
  };
  /** Короткие названия дней для расписания. */
  static readonly SHORT: Record<LaidDay, string> = {
    legs1: "Ноги 1",
    push1: "Жим 1",
    pull1: "Тяга 1",
    legs2: "Ноги 2",
    push2: "Жим 2",
    pull2: "Тяга 2",
  };
  static readonly ORIGINAL: Record<LaidDay, string> = {
    legs1: "Legs 1",
    push1: "Push 1",
    pull1: "Pull 1",
    legs2: "Legs 2",
    push2: "Push 2",
    pull2: "Pull 2",
  };
  /** День недели по умолчанию (0 — понедельник): Пн–Сб подряд. */
  static readonly WEEKDAY: Record<LaidDay, number> = { legs1: 0, push1: 1, pull1: 2, legs2: 3, push2: 4, pull2: 5 };
  static readonly LIFT_OF: Record<LaidDay, LaidLift> = {
    legs1: "squat",
    push1: "bench",
    pull1: "deadlift",
    legs2: "squat",
    push2: "ohp",
    pull2: "deadlift",
  };
  static readonly LIFT_EXERCISE: Record<LaidLift, string> = {
    squat: "squat",
    bench: "bench",
    deadlift: "deadlift-bar",
    ohp: "ohp-bar",
  };
  static readonly LIFT_LABEL: Record<LaidLift, string> = {
    squat: "присед",
    bench: "жим лёжа",
    deadlift: "становая",
    ohp: "армейский жим",
  };
  static readonly NOTICE = "Веса восстановлены по опубликованной таблице и округлены; официальный калькулятор может дать другие числа.";
  static readonly LOAD_NOTICE = "Шесть тренировок в неделю и тяжёлые подходы — вводи осторожные максимумы.";
  static readonly MAX_KG = MAX_KG;

  private static readonly SCHEME: Record<LaidDay, DayScheme> = {
    legs1: { heavy: [5, 1, 3], work: [12, 4, 8] },
    push1: { heavy: [1, 3, 5], work: [4, 8, 12] },
    pull1: { heavy: [3, 1, 5], work: [6, 2, 10] },
    legs2: { heavy: [3, 5, 1], work: [8, 12, 4] },
    push2: { heavy: [5, 1, 3], work: [12, 4, 8] },
    pull2: { heavy: [1, 5, 3], work: [2, 10, 6] },
  };
  /** Проценты от 1ПМ по волнам (В1, В2, В3). */
  private static readonly HEAVY_PCT: Record<HeavyScheme, [number, number, number]> = {
    5: [85, 86, 88],
    3: [90, 91, 92.5],
    1: [95, 96.5, 97.5],
  };
  private static readonly WORK_PCT: Record<WorkReps, [number, number, number]> = {
    12: [65, 66, 67],
    10: [70, 71, 72],
    8: [75, 76, 77],
    6: [80, 81, 82],
    4: [85, 86, 87],
    2: [92.5, 93, 93.5],
  };
  private static readonly LAYOUT: Record<LaidDay, Layout> = {
    legs1: { aux: LEGS_AUX, extras: [a("hanging-leg-raise", 10, 15)] },
    legs2: { aux: LEGS_AUX, extras: [] },
    push1: {
      aux: [
        { ...a("push-press", 4, 12), byWave: [4, 8, 12] },
        a("dip-weighted"),
        a("fly-db-flat"),
        ...PUSH_TAIL,
      ],
      extras: [a("lateral-cable-single", 12, 15)],
    },
    push2: {
      aux: [{ ...a("incline-bar", 4, 12), byWave: [12, 4, 8] }, a("dip-weighted"), ...PUSH_TAIL],
      extras: [a("lateral-cable-single", 12, 15)],
    },
    pull1: { aux: PULL_AUX, extras: [a("rear-delt-fly", 12, 15)] },
    pull2: { aux: PULL_AUX, extras: [a("rear-delt-fly", 12, 15), a("ab-roller", 8, 12)] },
  };

  /** Ближайшие 2,5 кг; ровно посередине — большее (76,25 → 77,5; 76 → 75). */
  static roundKg(kg: number): number {
    if (!Number.isFinite(kg) || kg <= 0) return 0;
    return Math.floor(kg / 2.5 + 0.5 + 1e-9) * 2.5;
  }
  static weight(maxKg: number, percent: number): number {
    return LaidDupPlan.roundKg((maxKg * percent) / 100);
  }

  /** Номер недели от понедельника старта: с понедельника старта — 0, до него — меньше нуля. */
  static weekOf(startMonday: string, date: string): number {
    const day = (iso: string) => Math.round(new Date(iso + "T12:00:00Z").getTime() / 86_400_000);
    const monday = addCalendarDays(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
    return Math.round((day(monday) - day(startMonday)) / 7);
  }
  static position(raw: number): LaidPosition {
    const n = Number.isFinite(raw) ? Math.trunc(raw) : 0;
    const week = Math.max(0, Math.min(LAID_WEEKS - 1, n));
    return {
      raw: n,
      week,
      wave: (Math.floor(week / WAVE_WEEKS) + 1) as 1 | 2 | 3,
      inWave: (week % WAVE_WEEKS) as 0 | 1 | 2,
      finished: n >= LAID_WEEKS,
      beforeStart: n < 0,
    };
  }
  /** Понедельник «этой» или «следующей» недели от `today`. */
  static startMonday(today: string, which: "this" | "next"): string {
    const monday = addCalendarDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
    return which === "this" ? monday : addCalendarDays(monday, 7);
  }
  /** Какой старт по умолчанию предлагать сегодня: пн–ср — эта неделя, чт–вс — следующая. */
  static defaultStart(today: string): "this" | "next" {
    return (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7 <= 2 ? "this" : "next";
  }

  /** Максимумы, действующие в неделе `week` (0-based): последняя настройка, начавшаяся не позже этой недели. */
  static maxesFor(p: Pick<RoutinePeriodization, "maxes" | "maxesFromWeek" | "earlier">, week: number): LaidMaxes {
    const stages = [...(p.earlier ?? []), { fromWeek: p.maxesFromWeek, maxes: p.maxes }].sort((x, y) => x.fromWeek - y.fromWeek);
    let chosen = stages[0].maxes;
    for (const stage of stages) if (stage.fromWeek <= week) chosen = stage.maxes;
    return chosen;
  }

  /** План одного дня: тяжёлый подход и четыре рабочих с весами, округлёнными до 2,5 кг. */
  static day(
    day: LaidDay,
    raw: number,
    maxes: LaidMaxes,
    options: { light?: boolean } = {},
  ): LaidDayPlan {
    const position = LaidDupPlan.position(raw);
    const lift = LaidDupPlan.LIFT_OF[day];
    const maxKg = maxes[lift];
    const scheme = LaidDupPlan.SCHEME[day];
    const light = !!options.light && scheme.heavy[position.inWave] === 1;
    const heavyScheme: HeavyScheme = light ? 3 : scheme.heavy[position.inWave];
    const wave = position.wave - 1;
    const heavyPercent = LaidDupPlan.HEAVY_PCT[heavyScheme][wave];
    const workReps = scheme.work[position.inWave];
    const workPercent = LaidDupPlan.WORK_PCT[workReps][wave];
    return {
      day,
      position,
      lift,
      liftExerciseId: LaidDupPlan.LIFT_EXERCISE[lift],
      maxKg,
      heavy: { reps: heavyScheme, percent: heavyPercent, weightKg: LaidDupPlan.weight(maxKg, heavyPercent), light },
      work: { sets: 4, reps: workReps, percent: workPercent, weightKg: LaidDupPlan.weight(maxKg, workPercent) },
    };
  }

  /** Недельные повторения вспомогательного (push press, наклонный жим): для остальных — null. */
  static auxReps(day: LaidDay, exerciseId: string, inWave: 0 | 1 | 2): number | null {
    const found = LaidDupPlan.LAYOUT[day].aux.find((x) => x.exerciseId === exerciseId);
    return found?.byWave ? found.byWave[inWave] : null;
  }
  /** Упражнения оригинального дня (без тяжёлого базового): всё, чего здесь нет, — «добавлено». */
  static originalIds(day: LaidDay): string[] {
    return [LaidDupPlan.LIFT_EXERCISE[LaidDupPlan.LIFT_OF[day]], ...LaidDupPlan.LAYOUT[day].aux.map((x) => x.exerciseId)];
  }
  static isAdded(day: LaidDay, exerciseId: string): boolean {
    return !LaidDupPlan.originalIds(day).includes(exerciseId);
  }

  /** Строка плана дня: «1 × 5 × 85 кг · 4 × 12 × 65 кг». */
  static line(plan: LaidDayPlan): string {
    return `1 × ${plan.heavy.reps} × ${LaidDupPlan.kg(plan.heavy.weightKg)} кг · ${plan.work.sets} × ${plan.work.reps} × ${LaidDupPlan.kg(plan.work.weightKg)} кг`;
  }
  /** Число с запятой, без лишнего нуля: 67,5; 85. */
  static kg(value: number): string {
    return String(value).replace(".", ",");
  }
  /** Подпись недели: «Неделя 4 из 9 · волна 2»; после цикла — пометка про обновление максимумов. */
  static weekLabel(position: LaidPosition): string {
    if (position.finished) return `Неделя ${position.raw + 1} · схема недели 9 · цикл закончен — обнови максимумы`;
    return `Неделя ${position.week + 1} из ${LAID_WEEKS} · волна ${position.wave}`;
  }
  /** Что делает день: для заметки тяжёлого упражнения. */
  static describe(plan: LaidDayPlan): string {
    const { heavy, work } = plan;
    return [
      `${LaidDupPlan.weekLabel(plan.position)}.`,
      `Тяжёлый подход: 1 × ${heavy.reps} повторений · ${LaidDupPlan.pct(heavy.percent)} % от 1ПМ (${LaidDupPlan.kg(plan.maxKg)} кг) = ${LaidDupPlan.kg(heavy.weightKg)} кг${heavy.light ? " (облегчённо, не по оригиналу)" : ""}.`,
      `Затем ${work.sets} × ${work.reps} · ${LaidDupPlan.pct(work.percent)} % = ${LaidDupPlan.kg(work.weightKg)} кг.`,
    ].join(" ");
  }
  static pct(value: number): string {
    return String(value).replace(".", ",");
  }

  /** Подходы базового упражнения дня: тяжёлый и четыре рабочих (ничего не отмечено). */
  static liftSets(plan: LaidDayPlan): SetEntry[] {
    const set = (weight: number, reps: number): SetEntry => ({ id: crypto.randomUUID(), weight, reps, rir: null, warmup: false, done: false });
    return [set(plan.heavy.weightKg, plan.heavy.reps), ...Array.from({ length: plan.work.sets }, () => set(plan.work.weightKg, plan.work.reps))];
  }

  /** Упражнения дня для шаблона программы (веса базового — недели 1; на старте считаются заново). */
  static entries(day: LaidDay, maxes: LaidMaxes, options: { extras: boolean; light: boolean }): WorkoutExercise[] {
    const plan = LaidDupPlan.day(day, 0, maxes, options);
    const layout = LaidDupPlan.LAYOUT[day];
    const lift = { ...makeExerciseEntry(plan.liftExerciseId), sets: LaidDupPlan.liftSets(plan) };
    const rows = [...layout.aux, ...(options.extras ? layout.extras : [])].map((x) => {
      const reps = x.byWave ? x.byWave[0] : x.repMin;
      return {
        ...makeExerciseEntry(x.exerciseId),
        sets: makeSets(x.sets, 0, reps).map((s) => ({ ...s, rir: null })),
        repMin: x.byWave ? reps : x.repMin,
        repMax: x.byWave ? reps : x.repMax,
      };
    });
    return [lift, ...rows];
  }

  /** Шесть программ цикла: названия, дни Пн–Сб, общая настройка периодизации. */
  static routines(input: {
    maxes: LaidMaxes;
    extras: boolean;
    light: boolean;
    startMonday: string;
    cycleId?: string;
  }): Routine[] {
    const cycleId = input.cycleId ?? crypto.randomUUID();
    return LaidDupPlan.DAYS.map((day) => ({
      id: crypto.randomUUID(),
      name: LaidDupPlan.NAMES[day],
      notes: `${LaidDupPlan.ORIGINAL[day]} программы Дэвида Лейда (DUP, 9 недель).`,
      days: [LaidDupPlan.WEEKDAY[day]],
      exercises: LaidDupPlan.entries(day, input.maxes, input),
      restSeconds: 90,
      progression: "repeat" as const,
      repMin: 8,
      repMax: 12,
      incrementKg: 2.5,
      revision: 0,
      periodization: {
        kind: "laid-dup" as const,
        cycleId,
        day,
        startMonday: input.startMonday,
        maxes: { ...input.maxes },
        maxesFromWeek: 0,
        extras: input.extras,
        light: input.light,
      },
    }));
  }

  /** Проверка введённого максимума: текст ошибки или null. */
  static checkMax(raw: string): { value: number | null; error: string | null } {
    const text = raw.trim().replace(",", ".");
    if (!text) return { value: null, error: "Введи максимум в килограммах." };
    if (!/^\d+(\.\d+)?$/.test(text)) return { value: null, error: "Максимум — число в килограммах." };
    const value = Number(text);
    if (!(value > 0)) return { value: null, error: "Максимум должен быть больше нуля." };
    if (value > MAX_KG) return { value: null, error: `Максимум не больше ${MAX_KG} кг: проверь число.` };
    return { value, error: null };
  }

  private static maxesOk(value: unknown): value is LaidMaxes {
    if (typeof value !== "object" || value === null) return false;
    const m = value as Record<string, unknown>;
    return (["squat", "bench", "deadlift", "ohp"] as const).every((k) => typeof m[k] === "number" && Number.isFinite(m[k]) && (m[k] as number) > 0 && (m[k] as number) <= MAX_KG);
  }
  /**
   * Периодизация программы, если её структура пригодна для расчёта; иначе undefined — программа считается обычной.
   * Защита от данных, записанных не нашим клиентом (другая версия, прямой вызов API): битое поле не должно ронять экран.
   */
  static periodizationOf(routine: Routine | null | undefined): RoutinePeriodization | undefined {
    const p = routine?.periodization as unknown;
    if (typeof p !== "object" || p === null) return undefined;
    const v = p as Record<string, unknown>;
    if (v.kind !== "laid-dup" || typeof v.cycleId !== "string" || !v.cycleId) return undefined;
    if (!LaidDupPlan.DAYS.includes(v.day as LaidDay)) return undefined;
    if (typeof v.startMonday !== "string" || !isCalendarDate(v.startMonday)) return undefined;
    if (!LaidDupPlan.maxesOk(v.maxes)) return undefined;
    if (typeof v.maxesFromWeek !== "number" || !Number.isInteger(v.maxesFromWeek) || v.maxesFromWeek < 0 || v.maxesFromWeek > 9) return undefined;
    if (v.earlier !== undefined) {
      if (!Array.isArray(v.earlier)) return undefined;
      for (const e of v.earlier) {
        if (typeof e !== "object" || e === null) return undefined;
        const item = e as Record<string, unknown>;
        if (typeof item.fromWeek !== "number" || !Number.isInteger(item.fromWeek) || !LaidDupPlan.maxesOk(item.maxes)) return undefined;
      }
    }
    return p as RoutinePeriodization;
  }

  /** Те же программы цикла, что и `routine` (по общему `cycleId`). */
  static cycleOf(routines: Routine[], routine: Routine): Routine[] {
    const id = LaidDupPlan.periodizationOf(routine)?.cycleId;
    return id ? routines.filter((r) => LaidDupPlan.periodizationOf(r)?.cycleId === id) : [];
  }
  /** Цикл программы: по одному представителю каждого дня, дни — в порядке таблицы. */
  static cycles(routines: Routine[]): Routine[][] {
    const valid = routines.filter((r) => LaidDupPlan.periodizationOf(r));
    const ids = [...new Set(valid.map((r) => LaidDupPlan.periodizationOf(r)!.cycleId))];
    return ids.map((id) =>
      valid
        .filter((r) => LaidDupPlan.periodizationOf(r)!.cycleId === id)
        .sort((x, y) => LaidDupPlan.DAYS.indexOf(LaidDupPlan.periodizationOf(x)!.day) - LaidDupPlan.DAYS.indexOf(LaidDupPlan.periodizationOf(y)!.day)),
    );
  }

  /** План дня этой программы на дату: null, если у программы нет периодизации. */
  static planFor(routine: Routine, date: string): LaidDayPlan | null {
    const p = LaidDupPlan.periodizationOf(routine);
    if (!p) return null;
    const raw = LaidDupPlan.weekOf(p.startMonday, date);
    const position = LaidDupPlan.position(raw);
    return LaidDupPlan.day(p.day, raw, LaidDupPlan.maxesFor(p, position.week), { light: p.light });
  }

  /**
   * Сделан ли день на неделе `week` (0-based): тренировка по этой программе, дата которой попала в календарную неделю.
   * Пропущена — неделя прошла или назначенный день недели уже позади, а тренировки нет; иначе впереди.
   */
  static status(
    routine: Routine,
    workouts: Workout[],
    week: number,
    today: string,
  ): { state: "done" | "missed" | "ahead"; date?: string } {
    const p = LaidDupPlan.periodizationOf(routine);
    if (!p) return { state: "ahead" };
    const monday = addCalendarDays(p.startMonday, week * 7);
    const sunday = addCalendarDays(monday, 6);
    const done = workouts
      .filter((w) => w.routineId === routine.id && w.date >= monday && w.date <= sunday)
      .map((w) => w.date)
      .sort()[0];
    if (done) return { state: "done", date: done };
    if (today > sunday) return { state: "missed" };
    if (today < monday) return { state: "ahead" };
    const planned = routine.days.length ? Math.max(...routine.days) : 6;
    return { state: addCalendarDays(monday, planned) < today ? "missed" : "ahead" };
  }

  /**
   * Лучший расчётный 1ПМ базового упражнения по Эпли среди выполненных рабочих подходов с даты `since` (включительно):
   * null, если подходящих нет. Тот же расчёт, что в «Прогрессе».
   */
  static estimate(workouts: Workout[], lift: LaidLift, since = "0000-01-01", until = "9999-12-31"): number | null {
    const id = LaidDupPlan.LIFT_EXERCISE[lift];
    let best: number | null = null;
    for (const w of workouts) {
      if (w.date < since || w.date > until) continue;
      for (const entry of w.exercises) {
        if (entry.exerciseId !== id) continue;
        for (const set of entry.sets) {
          const value = estimatedOneRepMax(set, entry);
          if (value !== null && (best === null || value > best)) best = value;
        }
      }
    }
    return best === null ? null : Math.round(best * 10) / 10;
  }

  /** Оценка по истории для окна создания: свежая история за последние полгода. */
  static estimates(workouts: Workout[], today: string): Record<LaidLift, number | null> {
    const since = addCalendarDays(today, -182);
    return {
      squat: LaidDupPlan.estimate(workouts, "squat", since, today),
      bench: LaidDupPlan.estimate(workouts, "bench", since, today),
      deadlift: LaidDupPlan.estimate(workouts, "deadlift", since, today),
      ohp: LaidDupPlan.estimate(workouts, "ohp", since, today),
    };
  }

  /**
   * «Можно обновить максимум»: оценка по подходам последних 28 дней (и не раньше действующей настройки) не меньше чем на 5 %
   * выше действующего максимума. Возвращает предложенные максимумы: оценка, округлённая вниз до 2,5 кг.
   */
  static suggestion(p: RoutinePeriodization, workouts: Workout[], today: string): { lift: LaidLift; from: number; estimate: number; to: number }[] {
    const settingStart = addCalendarDays(p.startMonday, p.maxesFromWeek * 7);
    const since = settingStart > addCalendarDays(today, -28) ? settingStart : addCalendarDays(today, -28);
    const found: { lift: LaidLift; from: number; estimate: number; to: number }[] = [];
    for (const lift of ["squat", "bench", "deadlift", "ohp"] as const) {
      const estimate = LaidDupPlan.estimate(workouts, lift, since, today);
      const current = p.maxes[lift];
      if (estimate !== null && estimate >= current * 1.05) {
        const to = Math.min(MAX_KG, Math.floor(estimate / 2.5) * 2.5);
        if (to > current) found.push({ lift, from: current, estimate, to });
      }
    }
    return found;
  }

  /** Новые настройки программы после обновления максимумов: с недели `fromWeek` действуют `maxes`, прежние остаются для прошлых недель. */
  static withMaxes(p: RoutinePeriodization, maxes: LaidMaxes, fromWeek: number): RoutinePeriodization {
    const week = Math.max(0, Math.min(LAID_WEEKS, Math.trunc(fromWeek)));
    const earlier = [...(p.earlier ?? []), { fromWeek: p.maxesFromWeek, maxes: p.maxes }]
      .filter((stage) => stage.fromWeek < week)
      .slice(-7);
    return { ...p, maxes: { ...maxes }, maxesFromWeek: week, earlier: earlier.length ? earlier : undefined };
  }
}
