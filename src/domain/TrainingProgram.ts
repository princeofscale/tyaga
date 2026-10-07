import {
  makeWorkout,
  makeExerciseEntry,
  makeSets,
  exerciseForEntry,
  progressKey,
  entryName,
  localDate,
} from "../lib/model";
import type { Routine, Workout } from "../lib/types";

export const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export function calendarWeekday(date: string) {
  return (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
}
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
  start(history: Workout[], timeZone: string): Workout {
    const r = this.routine,
      workout = makeWorkout([], [], timeZone);
    return {
      ...workout,
      name: r.name,
      notes: r.notes,
      routineId: r.id,
      restSeconds: r.restSeconds,
      exercises: r.exercises.map((plan) => {
        const definition = exerciseForEntry(plan)!;
        const previous = [...history]
          .sort(
            (a, b) =>
              b.date.localeCompare(a.date) ||
              (b.createdAt ?? "").localeCompare(a.createdAt ?? "") ||
              b.id.localeCompare(a.id),
          )
          .flatMap((w) => w.exercises)
          .find((e) => progressKey(e) === progressKey(plan));
        const work = previous?.sets.filter((s) => !s.warmup) ?? [];
        const plannedCount = plan.sets.filter((s) => !s.warmup).length;
        const canIncrease =
          r.progression === "double" &&
          definition.catalogRevision === 2 &&
          definition.recording.e1rmEligible &&
          work.length === plannedCount &&
          work.length > 0 &&
          work.every((s) => s.done && s.reps >= r.repMax && s.weight > 0) &&
          work.every((s) => s.weight === work[0].weight);
        let index = 0;
        return {
          ...structuredClone(plan),
          progressionNote:
            r.progression === "double" && definition.recording.e1rmEligible
              ? canIncrease
                ? `Все ${plannedCount} рабочих подхода прошлого раза достигли ${r.repMax} повторений. Предложен шаг +${r.incrementKg} кг; диапазон ${r.repMin}–${r.repMax}. Измени вес по самочувствию.`
                : `Диапазон ${r.repMin}–${r.repMax}. Добавляй повторы; вес растёт только после всех ${plannedCount} выполненных рабочих подходов на верхней границе. Это правило программы.`
              : undefined,
          sets: plan.sets.map((s) => {
            const ref = s.warmup ? undefined : work[index++];
            return {
              ...s,
              id: crypto.randomUUID(),
              done: false,
              weight:
                canIncrease && !s.warmup
                  ? Math.min(
                      1000,
                      Math.round((work[0].weight + r.incrementKg) * 100) / 100,
                    )
                  : ref?.done
                    ? ref.weight
                    : s.weight,
              reps:
                canIncrease && !s.warmup
                  ? r.repMin
                  : ref?.done
                    ? ref.reps
                    : s.reps,
              ...(definition.recording.type === "duration"
                ? {
                    durationSeconds: ref?.done
                      ? (ref.durationSeconds ?? s.durationSeconds)
                      : s.durationSeconds,
                  }
                : {}),
              ...(definition.recording.loadMode === "assisted_bodyweight"
                ? {
                    assistanceKg: ref?.done
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
}
