import { DeloadEngine } from "./DeloadEngine";
import { WorkoutReference } from "./WorkoutReference";
import { LaidDupPlan, type LaidDayPlan } from "./LaidDupPlan";
import {
  makeWorkout,
  makeExerciseEntry,
  makeSets,
  exerciseForEntry,
  exerciseById,
  localDate,
} from "../lib/model";
import { MUSCLES } from "../data/muscles";
import { addCalendarDays } from "../lib/calendar";
import { calendarWeekday, TrainingCalendar } from "./TrainingCalendar";
import type {
  Muscle,
  Routine,
  RoutineCycle,
  Workout,
  WorkoutExercise,
} from "../lib/types";

export const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export { calendarWeekday } from "./TrainingCalendar";
/** Monday-based week number of a calendar date, in whole weeks since 1970. */
function calendarWeekNumber(date: string) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return Math.round(d.getTime() / 604800000);
}
/** Four working weeks, then one deload week at half the sets and 70% of the weight. */
export const DELOAD_CYCLE: RoutineCycle = {
  weeks: 5,
  deloadWeek: 4,
  setFactor: 0.5,
  weightFactor: 0.7,
  deloadRir: 4,
};
export class TrainingProgram {
  constructor(public readonly routine: Routine) {}
  /** Edits one bound without changing the opposite value while a number is being typed. */
  static editRange(
    routine: Routine,
    entry: WorkoutExercise,
    side: "min" | "max",
    raw: string,
  ) {
    if (raw === "")
      return side === "min"
        ? { repMin: undefined, repMax: entry.repMax }
        : { repMin: entry.repMin, repMax: undefined };
    const value = Math.max(1, Math.min(200, Math.round(Number(raw))));
    return side === "min"
      ? { repMin: value, repMax: entry.repMax ?? routine.repMax }
      : { repMin: entry.repMin ?? routine.repMin, repMax: value };
  }
  /** The editor may hold an incomplete pair; only complete, ordered ranges can be saved. */
  static validateRanges(routine: Routine) {
    if (
      !Number.isInteger(routine.repMin) ||
      !Number.isInteger(routine.repMax) ||
      routine.repMin < 1 ||
      routine.repMax > 200 ||
      routine.repMax < routine.repMin
    )
      throw new Error(
        "Общий максимум повторений должен быть не меньше минимума",
      );
    for (const e of routine.exercises) {
      if (e.repMin === undefined && e.repMax === undefined) continue;
      if (
        !Number.isInteger(e.repMin) ||
        !Number.isInteger(e.repMax) ||
        e.repMin! < 1 ||
        e.repMax! > 200 ||
        e.repMax! < e.repMin!
      )
        throw new Error(
          `У «${exerciseForEntry(e)?.name ?? e.exerciseId}» укажи обе границы повторений: максимум не меньше минимума`,
        );
    }
  }

  get workingSets() {
    return this.routine.exercises.reduce(
      (n, e) => n + e.sets.filter((s) => !s.warmup).length,
      0,
    );
  }
  scheduled(date: string) {
    return TrainingCalendar.onDate([this.routine], date).length > 0;
  }
  /** Planned rep range of one movement; the routine range fills the gaps. */
  range(plan: WorkoutExercise) {
    const min = plan.repMin ?? this.routine.repMin;
    return { min, max: plan.repMax ?? Math.max(min, this.routine.repMax) };
  }
  /**
   * 0-based index of the calendar week holding `date`, counted from the first
   * saved workout of this routine. A missed week still advances the cycle: the
   * plan says "каждая пятая неделя", not "каждая пятая тренировка".
   */
  weekIndex(history: Workout[], date: string) {
    const first = history
      .filter((w) => w.routineId === this.routine.id)
      .map((w) => w.programDate ?? w.date)
      .filter((day) => day <= date)
      .sort()[0];
    if (!first) return 0;
    return Math.max(0, calendarWeekNumber(date) - calendarWeekNumber(first));
  }
  isDeload(history: Workout[], date: string) {
    const cycle = this.routine.cycle;
    if (!cycle || cycle.weeks < 2) return false;
    return this.weekIndex(history, date) % cycle.weeks === cycle.deloadWeek;
  }
  /**
   * A deload keeps every movement and every warm-up, but takes a share of the
   * working sets away — at least one working set always stays.
   */
  private deloadSets(plan: WorkoutExercise, cycle: RoutineCycle) {
    const working = plan.sets.filter((s) => !s.warmup);
    const keep = Math.max(1, Math.floor(working.length * cycle.setFactor));
    if (keep >= working.length) return plan.sets;
    const kept = new Set(working.slice(0, keep).map((s) => s.id));
    return plan.sets.filter((s) => s.warmup || kept.has(s.id));
  }
  /**
   * The reference for the next weight is the latest workout that was not itself
   * a deload: after a deload the first working week starts from the same weight
   * as before it, instead of inheriting the reduced one.
   */
  private reference(
    history: Workout[],
    plan: WorkoutExercise,
    skipDeload: boolean,
    today: string,
    timeZone: string,
  ) {
    return WorkoutReference.latest(
      // QA-R06-13: разгрузочные тренировки («[Разгрузка]» в названии) не бывают базой веса — ни при цикле, ни после «Применить разгрузку».
      history.filter((w) => !DeloadEngine.isDeloadName(w.name) && (!skipDeload || !this.isDeload(history, w.programDate ?? w.date))),
      plan,
      undefined,
      today,
      { timeZone },
    );
  }
  /**
   * Where each planned weight comes from: "history" when a finished working
   * set of the same movement under the same recording rule exists (the same
   * reference `start` uses), "plan" when the number is the program's own.
   */
  weightSources(
    history: Workout[],
    timeZone: string,
    today = localDate(new Date(), timeZone),
  ): Array<"history" | "plan"> {
    const cycle = !!this.routine.cycle;
    return this.routine.exercises.map((plan) => {
      const previous = this.reference(history, plan, cycle, today, timeZone);
      return previous?.sets.some((s) => !s.warmup && s.done)
        ? "history"
        : "plan";
    });
  }
  /**
   * R03-REQ07: что окажется в первом рабочем подходе и откуда это число. История важнее плана
   * (так делает `start`): «из истории» — с весом последней тренировки, «по плану» — с весом,
   * который записан в программе, «не задан» — когда его нет нигде.
   */
  weightHints(
    history: Workout[],
    timeZone: string,
    today = localDate(new Date(), timeZone),
  ): Array<{ source: "history" | "plan" | "none"; weightKg: number | null }> {
    const cycle = !!this.routine.cycle;
    return this.routine.exercises.map((plan) => {
      const work = this.reference(history, plan, cycle, today, timeZone)?.sets.filter((s) => !s.warmup && s.done) ?? [];
      if (work.length) return { source: "history", weightKg: work[0].weight };
      const planned = plan.sets.find((s) => !s.warmup)?.weight ?? 0;
      return planned > 0 ? { source: "plan", weightKg: planned } : { source: "none", weightKg: null };
    });
  }
  start(
    history: Workout[],
    timeZone: string,
    today = localDate(new Date(), timeZone),
    programDate?: string,
  ): Workout {
    const r = this.routine;
    const workout = makeWorkout([], [], timeZone);
    // A move changes the training day, not the plan phase (including Laid's independent cycle).
    const phaseDate = programDate ?? today;
    const laid = LaidDupPlan.planFor(r, phaseDate);
    const cycle = laid ? undefined : r.cycle;
    const deload = !laid && this.isDeload(history, phaseDate);
    const built: Workout = {
      ...workout,
      date: today,
      name: r.name,
      notes:
        deload && cycle
          ? [
              r.notes,
              `Разгрузочная неделя ${cycle.deloadWeek + 1} из ${cycle.weeks}: ${Math.round(
                cycle.setFactor * 100,
              )}% подходов, ${Math.round(
                cycle.weightFactor * 100,
              )}% рабочего веса, остановка за ${cycle.deloadRir} повтора до отказа.`,
            ]
              .filter(Boolean)
              .join("\n\n")
          : r.notes,
      routineId: r.id,
      ...(programDate !== undefined ? { programDate } : {}),
      restSeconds: r.restSeconds,
      exercises: r.exercises.map((plan) => {
        const definition = exerciseForEntry(plan)!;
        const range = this.range(plan);
        const previous = this.reference(
          history,
          plan,
          !!cycle,
          today,
          timeZone,
        );
        const work = previous?.sets.filter((s) => !s.warmup && s.done) ?? [];
        const plannedCount = plan.sets.filter((s) => !s.warmup).length;
        const progressive = definition.catalogRevision !== 1;
        const canIncrease =
          !deload &&
          r.progression === "double" &&
          progressive &&
          definition.recording.e1rmEligible &&
          work.length === plannedCount &&
          work.length > 0 &&
          work.every((s) => s.reps >= range.max && s.weight > 0) &&
          work.every((s) => s.weight === work[0].weight);
        let index = 0;
        const sets = deload && cycle ? this.deloadSets(plan, cycle) : plan.sets;
        return {
          ...structuredClone(plan),
          ...(r.progression === "double"
            ? { repMin: range.min, repMax: range.max }
            : !work.length && plan.repMin === undefined && plan.sets.some((s) => !s.warmup && s.reps > 0)
              ? { repMin: plan.sets.find((s) => !s.warmup)!.reps, repMax: plan.sets.find((s) => !s.warmup)!.reps }
              : {}),
          progressionNote: deload
            ? undefined
            : r.progression === "double" && progressive && canIncrease
              ? `Все рабочие подходы прошлого раза достигли ${range.max} повторений. Предложен шаг +${r.incrementKg} кг; диапазон ${range.min}–${range.max}. Измени вес по самочувствию.`
              : undefined,
          sets: sets.map((s) => {
            const ref = s.warmup ? undefined : (work[index++] ?? work.at(-1));
            const raised =
              canIncrease && !s.warmup
                ? work[0].weight + r.incrementKg
                : undefined;
            const base = raised ?? (ref ? ref.weight : s.weight);
            return {
              ...s,
              id: crypto.randomUUID(),
              done: false,
              weight:
                deload && cycle
                  ? Math.round(base * cycle.weightFactor * 2) / 2
                  : Math.min(1000, Math.round(base * 100) / 100),
              // R03-REQ02: подход N — из «Прошлого» (как «Повторить прошлые»); без истории повторы и RIR не
              // выдумываются — план программы виден серой подсказкой (repMin/repMax), а не записан как введённое.
              reps: raised !== undefined ? range.min : ref ? ref.reps : s.warmup ? s.reps : 0,
              rir: s.warmup ? s.rir : (ref?.rir ?? null),
              ...(deload && cycle ? { rir: cycle.deloadRir } : {}),
              ...(definition.recording.type === "duration"
                ? {
                    durationSeconds: ref
                      ? (ref.durationSeconds ?? s.durationSeconds)
                      : s.durationSeconds,
                  }
                : {}),
              ...(definition.recording.loadMode === "assisted_bodyweight"
                ? {
                    assistanceKg: ref
                      ? (ref.assistanceKg ?? s.assistanceKg)
                      : s.assistanceKg,
                  }
                : {}),
            };
          }),
        };
      }),
    };
    return laid ? this.withLaid(built, laid) : built;
  }
  /**
   * Тренировка программы с периодизацией: у базового упражнения дня тяжёлый подход и четыре рабочих с весами плана
   * (вес из «Прошлого» его не подменяет), у вспомогательных — повторения недели и пометка «добавлено»; в заметке — неделя.
   */
  private withLaid(workout: Workout, plan: LaidDayPlan): Workout {
    const day = this.routine.periodization!.day;
    const week = LaidDupPlan.weekLabel(plan.position);
    return {
      ...workout,
      notes: [workout.notes, week].filter(Boolean).join("\n\n"),
      exercises: workout.exercises.map((entry) => {
        if (entry.exerciseId === plan.liftExerciseId)
          return { ...entry, sets: LaidDupPlan.liftSets(plan), repMin: undefined, repMax: undefined, progressionNote: LaidDupPlan.describe(plan) };
        const reps = LaidDupPlan.auxReps(day, entry.exerciseId, plan.position.inWave);
        if (reps !== null) {
          // Волновая подсобка (push press 4/8/12, наклонный жим 12/4/8): если подходы взялись из истории
          // с другим числом повторений, подстраиваем повторы под текущую неделю волны, а пустые (без истории) не выдумываем.
          const sets = entry.sets.map((s) =>
            !s.warmup && s.reps > 0 && s.reps !== reps ? { ...s, reps } : s,
          );
          const workCount = sets.filter((s) => !s.warmup).length;
          return {
            ...entry,
            sets,
            repMin: reps,
            repMax: reps,
            progressionNote: `Волна недели: ${workCount} × ${reps} ${LaidDupPlan.repsWord(reps)} (RPE 8–9) — подбери вес под это число повторений.`,
          };
        }
        return {
          ...entry,
          progressionNote: LaidDupPlan.isAdded(day, entry.exerciseId) ? "Добавлено к оригиналу Лейда: в его таблице этого нет." : undefined,
        };
      }),
    };
  }
  static empty(): Routine {
    return {
      id: crypto.randomUUID(),
      name: "Моя программа",
      notes: "",
      days: [],
      exercises: [],
      restSeconds: 90,
      progression: "repeat",
      repMin: 8,
      repMax: 12,
      incrementKg: 2.5,
      revision: 0,
    };
  }
  static fromWorkout(workout: Workout): Routine {
    return {
      ...TrainingProgram.empty(),
      name: workout.name,
      notes: workout.notes,
      restSeconds: workout.restSeconds ?? 90,
      exercises: workout.exercises.map((e) => ({
        ...structuredClone(e),
        sets: e.sets.map((s) => ({
          ...s,
          id: crypto.randomUUID(),
          done: false,
        })),
      })),
    };
  }
  static starter(kind: "full" | "split" | "ppl" | "strength"): Routine[] {
    const specs: {
      name: string;
      days: number[];
      ids: string[];
      reps: number;
      sets?: number;
    }[] =
      kind === "full"
        ? [
            {
              name: "Всё тело",
              days: [0, 2, 4],
              ids: ["goblet", "bench", "row", "db-rdl", "lateral", "crunch"],
              reps: 10,
            },
          ]
        : kind === "split"
          ? [
              {
                name: "Верх тела",
                days: [0, 3],
                ids: [
                  "bench",
                  "lat-pulldown",
                  "ohp",
                  "row",
                  "curl",
                  "triceps-push",
                ],
                reps: 10,
              },
              {
                name: "Низ тела",
                days: [1, 4],
                ids: [
                  "squat",
                  "rdl",
                  "legcurl-seated",
                  "barbell-hip-thrust",
                  "calf-standing",
                ],
                reps: 10,
              },
            ]
          : kind === "ppl"
            ? [
                {
                  name: "Жимы",
                  days: [0],
                  ids: [
                    "bench",
                    "incline-db",
                    "ohp",
                    "lateral",
                    "triceps-push",
                  ],
                  reps: 10,
                },
                {
                  name: "Тяги",
                  days: [2],
                  ids: ["lat-pulldown", "row", "facepull-er", "curl", "hammer"],
                  reps: 10,
                },
                {
                  name: "Ноги",
                  days: [4],
                  ids: [
                    "squat",
                    "rdl",
                    "legpress",
                    "legcurl-seated",
                    "calf-standing",
                  ],
                  reps: 10,
                },
              ]
            : [
                {
                  name: "База 5 × 5",
                  days: [0, 2, 4],
                  ids: ["squat", "bench", "row"],
                  reps: 5,
                  sets: 5,
                },
              ];
    return specs.map((p) => ({
      ...TrainingProgram.empty(),
      name: p.name,
      days: p.days,
      repMin: p.reps,
      repMax: p.reps === 5 ? 5 : 12,
      exercises: p.ids.map((id) => ({
        ...makeExerciseEntry(id),
        sets: makeSets(p.sets ?? 3, 0, p.reps),
      })),
    }));
  }
  /**
   * "Программа: верх тела + ноги, 5 дней. Версия 2" as five routines.
   * Set counts and rep ranges are copied from the plan; rest and RIR are not
   * prescribed there, so the routine rest stays at 90 s and RIR stays unknown.
   */
  static programV2(): Routine[] {
    const specs: {
      name: string;
      days: number[];
      notes: string;
      items: [id: string, sets: number, repMin: number, repMax: number][];
    }[] = [
      {
        name: "Верх: грудь, спина, трапеция",
        days: [0],
        notes:
          "Понедельник программы v2: 22 подхода. Разминка перед тренировкой обычная, на первое упражнение — два подвода и один подход с 70% рабочего веса.",
        items: [
          ["incline-bar", 3, 6, 8],
          ["row", 3, 6, 10],
          ["flat-db-press", 3, 8, 12],
          ["pullup-weighted", 3, 6, 12],
          ["fly", 2, 12, 15],
          ["pullover-cable", 2, 12, 15],
          ["shrug-bar", 3, 8, 12],
          ["hanging-leg-raise", 3, 8, 15],
        ],
      },
      {
        name: "Плечи и руки",
        days: [1],
        notes:
          "Вторник программы v2: 29 подходов. Здесь средняя дельта получает шесть подходов махов, а брахиалис — обратные сгибания.",
        items: [
          ["ohp", 3, 8, 10],
          ["lateral", 6, 12, 20],
          ["rear-delt-fly", 3, 12, 20],
          ["curl-preacher-ez", 3, 8, 12],
          ["skullcrusher-ez", 3, 8, 12],
          ["hammer", 3, 10, 15],
          ["extension-v-pushdown", 2, 10, 15],
          ["curl-reverse-ez", 3, 10, 15],
          ["woodchopper-cable", 3, 10, 12],
        ],
      },
      {
        name: "Верх: спина, грудь, трапеция",
        days: [3],
        notes:
          "Четверг программы v2: 24 подхода. Тяги идут первыми, жимы после них.",
        items: [
          ["pulldown-reverse", 4, 8, 12],
          ["incline-db", 3, 8, 12],
          ["row-v-grip", 3, 10, 12],
          ["bench", 3, 8, 12],
          ["high-cable-fly", 2, 12, 15],
          ["row-single-cable", 3, 10, 15],
          ["shrug-db-incline", 3, 12, 15],
          ["crunch-incline-plate", 3, 10, 15],
        ],
      },
      {
        name: "Руки, плечи, предплечья",
        days: [4],
        notes:
          "Пятница программы v2: 26 из 32 подходов. Два упражнения на запястья (сгибания и разгибания по 3 подхода) сюда не перенесены: в атласе нет отдельных записей для сгибателей и разгибателей запястья, а приписывать их к другой мышце было бы неправдой. Добавьте их личными упражнениями, если нужны.",
        items: [
          ["curl-incline-db", 3, 10, 12],
          ["extension-overhead-cable", 3, 10, 15],
          ["curl-bar", 2, 10, 12],
          ["extension-v-pushdown", 3, 10, 15],
          ["shoulder-press-machine", 3, 8, 12],
          ["lateral-cable-single", 6, 12, 20],
          ["facepull-er", 3, 15, 20],
          ["ab-roller", 3, 6, 12],
        ],
      },
      {
        name: "Ноги и икры",
        days: [5],
        notes:
          "Суббота программы v2: 25 подходов. Квадрицепсы 13, бицепс бедра и ягодицы 8, икры 4.",
        items: [
          ["squat", 4, 6, 10],
          ["rdl", 3, 8, 10],
          ["legpress", 3, 10, 15],
          ["bulgarian-split-squat", 3, 10, 12],
          ["leg-extension", 3, 12, 15],
          ["legcurl-prone", 3, 10, 15],
          ["back-extension", 2, 12, 15],
          ["calf-standing-machine", 4, 12, 20],
        ],
      },
    ];
    return specs.map((spec) => ({
      ...TrainingProgram.empty(),
      name: spec.name,
      notes: spec.notes,
      days: spec.days,
      progression: "double",
      repMin: 8,
      repMax: 12,
      incrementKg: 2.5,
      cycle: { ...DELOAD_CYCLE },
      exercises: spec.items.map(([id, count, repMin, repMax]) => ({
        ...makeExerciseEntry(id),
        sets: makeSets(count, 0, repMin).map((s) => ({ ...s, rir: null })),
        repMin,
        repMax,
      })),
    }));
  }
  /**
   * Weekly per-zone targets derived from the programme's own planned working
   * sets, so "покрытие ориентиров" means "выполнено против запланированного".
   */
  static programV2Goals(): Record<Muscle, number> {
    const totals = Object.fromEntries(MUSCLES.map((m) => [m.id, 0])) as Record<
      Muscle,
      number
    >;
    for (const routine of TrainingProgram.programV2())
      for (const entry of routine.exercises) {
        const count = entry.sets.filter((s) => !s.warmup).length;
        for (const zone of exerciseById(entry.exerciseId)?.primary ?? [])
          totals[zone] += count;
      }
    return totals;
  }
}

/** Ближайшая запланированная тренировка после `today` (в пределах недели): день и программа. */
export function nextScheduled(
  routines: Routine[],
  today: string,
): { date: string; dayName: string; routine: Routine } | null {
  for (let offset = 1; offset <= 7; offset++) {
    const date = addCalendarDays(today, offset);
    const routine = routines.find((r) =>
      new TrainingProgram(r).scheduled(date),
    );
    if (routine)
      return { date, dayName: DAY_NAMES[calendarWeekday(date)], routine };
  }
  return null;
}

/** "из истории" / "по плану" / a count of each, for a program card. */
export function weightSourceSummary(sources: Array<"history" | "plan">) {
  const fromHistory = sources.filter((s) => s === "history").length;
  if (!sources.length) return "";
  if (fromHistory === sources.length) return "веса из истории";
  if (fromHistory === 0) return "веса по плану";
  return `веса: ${fromHistory} из истории, ${sources.length - fromHistory} по плану`;
}
