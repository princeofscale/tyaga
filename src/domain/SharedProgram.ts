import { LaidDupPlan } from "./LaidDupPlan";
import { DELOAD_CYCLE, TrainingProgram } from "./TrainingProgram";
import { makeExerciseEntry, makeSets } from "../lib/model";
import type { LaidMaxes, Routine } from "../lib/types";

export type SharedProgramKind = "laid_dup" | "template" | "routine" | "custom";

export interface SharedProgramMember {
  accountId: string;
  displayName: string;
  role: "owner" | "member";
  adopted: boolean;
  weekWorkouts: number;
}

export interface SharedProgramRoutineSpec {
  name: string;
  days: number[];
  exercises: Array<{
    exerciseId: string;
    sets: number;
    repMin: number;
    repMax: number;
  }>;
}

export interface SharedProgramPayload {
  templateId?: "laid_dup" | "upper_lower" | "ppl" | "fullbody";
  routines?: SharedProgramRoutineSpec[];
  laidRhythm?: "6x1" | "3x1x3";
  laidExtras?: boolean;
}

export interface SharedProgram {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  kind: SharedProgramKind;
  payload: SharedProgramPayload;
  createdAt: string;
  members: SharedProgramMember[];
  isOwner: boolean;
  adoptedByMe: boolean;
}

export interface SharedProgramTemplate {
  id: "laid_dup" | "upper_lower" | "ppl" | "fullbody";
  title: string;
  meta: string;
  kind: SharedProgramKind;
  routines?: SharedProgramRoutineSpec[];
}

export const SHARED_TEMPLATES: SharedProgramTemplate[] = [
  {
    id: "laid_dup",
    title: "Дэвид Лейд · DUP",
    meta: "9 недель · 6 дней · Присед / Жим / Тяга",
    kind: "laid_dup",
  },
  {
    id: "upper_lower",
    title: "Верх / Низ",
    meta: "4 дня · Пн, Вт, Чт, Пт",
    kind: "template",
    routines: [
      {
        name: "Верх A",
        days: [0],
        exercises: [
          { exerciseId: "bench", sets: 4, repMin: 6, repMax: 8 },
          { exerciseId: "row-bent-bar", sets: 4, repMin: 8, repMax: 10 },
          { exerciseId: "ohp", sets: 3, repMin: 8, repMax: 10 },
          { exerciseId: "lat-pulldown", sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: "curl-bar", sets: 3, repMin: 10, repMax: 12 },
        ],
      },
      {
        name: "Низ A",
        days: [1],
        exercises: [
          { exerciseId: "squat", sets: 4, repMin: 6, repMax: 8 },
          { exerciseId: "rdl", sets: 3, repMin: 8, repMax: 10 },
          { exerciseId: "legpress", sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: "legcurl-seated", sets: 3, repMin: 10, repMax: 12 },
        ],
      },
      {
        name: "Верх B",
        days: [3],
        exercises: [
          { exerciseId: "incline-db", sets: 4, repMin: 8, repMax: 10 },
          { exerciseId: "pullup", sets: 4, repMin: 6, repMax: 10 },
          { exerciseId: "lateral", sets: 4, repMin: 12, repMax: 15 },
          { exerciseId: "row", sets: 3, repMin: 10, repMax: 12 },
        ],
      },
      {
        name: "Низ B",
        days: [4],
        exercises: [
          { exerciseId: "deadlift-bar", sets: 3, repMin: 5, repMax: 6 },
          { exerciseId: "bulgarian-split-squat", sets: 3, repMin: 8, repMax: 10 },
          { exerciseId: "leg-extension", sets: 3, repMin: 12, repMax: 15 },
          { exerciseId: "calf-standing-machine", sets: 4, repMin: 12, repMax: 18 },
        ],
      },
    ],
  },
  {
    id: "ppl",
    title: "Жим / Тяга / Ноги",
    meta: "3 дня · Пн, Ср, Пт",
    kind: "template",
    routines: [
      {
        name: "Жим (грудь, плечи, трицепс)",
        days: [0],
        exercises: [
          { exerciseId: "bench", sets: 4, repMin: 6, repMax: 8 },
          { exerciseId: "incline-db", sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: "ohp", sets: 3, repMin: 8, repMax: 10 },
          { exerciseId: "lateral", sets: 4, repMin: 12, repMax: 15 },
        ],
      },
      {
        name: "Тяга (спина, бицепс)",
        days: [2],
        exercises: [
          { exerciseId: "deadlift-bar", sets: 3, repMin: 5, repMax: 6 },
          { exerciseId: "pullup", sets: 4, repMin: 6, repMax: 10 },
          { exerciseId: "row-bent-bar", sets: 3, repMin: 8, repMax: 10 },
          { exerciseId: "curl-bar", sets: 3, repMin: 10, repMax: 12 },
        ],
      },
      {
        name: "Ноги",
        days: [4],
        exercises: [
          { exerciseId: "squat", sets: 4, repMin: 6, repMax: 8 },
          { exerciseId: "rdl", sets: 3, repMin: 8, repMax: 10 },
          { exerciseId: "legpress", sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: "legcurl-seated", sets: 3, repMin: 10, repMax: 12 },
        ],
      },
    ],
  },
  {
    id: "fullbody",
    title: "Фулбоди",
    meta: "3 дня · Пн, Ср, Пт",
    kind: "template",
    routines: [
      {
        name: "Фулбоди A",
        days: [0, 4],
        exercises: [
          { exerciseId: "squat", sets: 3, repMin: 6, repMax: 8 },
          { exerciseId: "bench", sets: 3, repMin: 6, repMax: 8 },
          { exerciseId: "row-bent-bar", sets: 3, repMin: 8, repMax: 10 },
          { exerciseId: "lateral", sets: 3, repMin: 12, repMax: 15 },
        ],
      },
      {
        name: "Фулбоди B",
        days: [2],
        exercises: [
          { exerciseId: "deadlift-bar", sets: 3, repMin: 5, repMax: 6 },
          { exerciseId: "ohp", sets: 3, repMin: 8, repMax: 10 },
          { exerciseId: "pullup", sets: 3, repMin: 6, repMax: 10 },
          { exerciseId: "rdl", sets: 3, repMin: 8, repMax: 10 },
        ],
      },
    ],
  },
];

export class SharedProgramBuilder {
  /** Сериализует пользовательскую программу в компактный шаблон для отправки другу. */
  static fromRoutine(routine: Routine): SharedProgramRoutineSpec {
    return {
      name: routine.name.slice(0, 80),
      days: [...routine.days],
      exercises: routine.exercises.slice(0, 20).map((ex) => ({
        exerciseId: ex.exerciseId,
        sets: Math.max(1, ex.sets.filter((s) => !s.warmup).length || ex.sets.length),
        repMin: ex.repMin ?? routine.repMin,
        repMax: ex.repMax ?? routine.repMax,
      })),
    };
  }

  /** Превращает общую программу в готовые `Routine[]` для сохранения в журнал пользователя. */
  static materialize(
    program: Pick<SharedProgram, "title" | "kind" | "payload">,
    today: string,
    maxes?: LaidMaxes,
  ): Routine[] {
    if (program.kind === "laid_dup" || program.payload.templateId === "laid_dup") {
      const startMonday = LaidDupPlan.startMonday(today, LaidDupPlan.defaultStart(today));
      return LaidDupPlan.routines({
        startMonday,
        maxes: maxes ?? { squat: 100, bench: 80, deadlift: 120, ohp: 55 },
        extras: program.payload.laidExtras ?? true,
        light: false,
        rhythm: program.payload.laidRhythm ?? "6x1",
      });
    }

    const specs =
      program.payload.routines && program.payload.routines.length > 0
        ? program.payload.routines
        : SHARED_TEMPLATES.find((t) => t.id === program.payload.templateId)?.routines ?? [];

    return specs.map((spec) => ({
      ...TrainingProgram.empty(),
      name: spec.name,
      notes: `Общая программа: ${program.title}`,
      days: spec.days.length ? spec.days : [0],
      progression: "double",
      repMin: 8,
      repMax: 12,
      incrementKg: 2.5,
      cycle: { ...DELOAD_CYCLE },
      exercises: spec.exercises.map((item) => ({
        ...makeExerciseEntry(item.exerciseId),
        sets: makeSets(item.sets, 0, item.repMin).map((s) => ({ ...s, rir: null })),
        repMin: item.repMin,
        repMax: item.repMax,
      })),
    }));
  }

  static summary(program: Pick<SharedProgram, "kind" | "payload">): string {
    if (program.kind === "laid_dup" || program.payload.templateId === "laid_dup") {
      return "9 недель · 6 дней · DUP";
    }
    const specs =
      program.payload.routines ??
      SHARED_TEMPLATES.find((t) => t.id === program.payload.templateId)?.routines ??
      [];
    if (!specs.length) return "Свободная программа";
    const exCount = specs.reduce((sum, r) => sum + r.exercises.length, 0);
    return `${specs.length} тр. · ${exCount} упр.`;
  }
}
