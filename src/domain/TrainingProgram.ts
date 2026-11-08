import {
  makeWorkout,
  makeExerciseEntry,
  makeSets,
  exerciseForEntry,
  exerciseById,
  progressKey,
  localDate,
} from "../lib/model";
import { MUSCLES } from "../data/muscles";
import type {
  Muscle,
  Routine,
  RoutineCycle,
  Workout,
  WorkoutExercise,
} from "../lib/types";

export const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export function calendarWeekday(date: string) {
  return (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
}
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
  get workingSets() {
    return this.routine.exercises.reduce(
      (n, e) => n + e.sets.filter((s) => !s.warmup).length,
      0,
    );
  }
  scheduled(date: string) {
    return this.routine.days.includes(calendarWeekday(date));
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
      .filter((w) => w.routineId === this.routine.id && w.date <= date)
      .map((w) => w.date)
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
  ) {
    return [...history]
      .filter((w) => !skipDeload || !this.isDeload(history, w.date))
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          (b.createdAt ?? "").localeCompare(a.createdAt ?? "") ||
          b.id.localeCompare(a.id),
      )
      .flatMap((w) => w.exercises)
      .find((e) => progressKey(e) === progressKey(plan));
  }
  start(
    history: Workout[],
    timeZone: string,
    today = localDate(new Date(), timeZone),
  ): Workout {
    const r = this.routine;
    const workout = makeWorkout([], [], timeZone);
    const cycle = r.cycle;
    const deload = this.isDeload(history, today);
    return {
      ...workout,
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
      restSeconds: r.restSeconds,
      exercises: r.exercises.map((plan) => {
        const definition = exerciseForEntry(plan)!;
        const range = this.range(plan);
        const previous = this.reference(history, plan, !!cycle);
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
          repMin: range.min,
          repMax: range.max,
          progressionNote: deload
            ? undefined
            : r.progression === "double" && progressive && canIncrease
              ? `Все рабочие подходы прошлого раза достигли ${range.max} повторений. Предложен шаг +${r.incrementKg} кг; диапазон ${range.min}–${range.max}. Измени вес по самочувствию.`
              : undefined,
          sets: sets.map((s) => {
            const ref = s.warmup ? undefined : work[index++];
            const raised =
              canIncrease && !s.warmup ? work[0].weight + r.incrementKg : undefined;
            const base = raised ?? (ref ? ref.weight : s.weight);
            return {
              ...s,
              id: crypto.randomUUID(),
              done: false,
              weight:
                deload && cycle
                  ? Math.round(base * cycle.weightFactor * 2) / 2
                  : Math.min(1000, Math.round(base * 100) / 100),
              reps: raised !== undefined ? range.min : ref ? ref.reps : s.reps,
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
    const totals = Object.fromEntries(
      MUSCLES.map((m) => [m.id, 0]),
    ) as Record<Muscle, number>;
    for (const routine of TrainingProgram.programV2())
      for (const entry of routine.exercises) {
        const count = entry.sets.filter((s) => !s.warmup).length;
        for (const zone of exerciseById(entry.exerciseId)?.primary ?? [])
          totals[zone] += count;
      }
    return totals;
  }
}
