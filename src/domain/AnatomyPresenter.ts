import { exerciseForEntry, exerciseById } from "../lib/catalog";
import type {
  AnatomicalMuscle,
  Exercise,
  Muscle,
  MuscleLoad,
  Workout,
} from "../lib/types";
export type AnatomyPart = {
  slug: string;
  name: string;
  zone: Muscle;
  muscles: AnatomicalMuscle[];
  wgerIds: number[];
};
const PARTS: Record<string, Omit<AnatomyPart, "slug">> = {
  chest: {
    name: "Грудные",
    zone: "chest",
    muscles: ["pectoralis-major"],
    wgerIds: [4],
  },
  abs: {
    name: "Прямая мышца живота",
    zone: "core",
    muscles: ["rectus-abdominis"],
    wgerIds: [6],
  },
  obliques: {
    name: "Косые мышцы живота",
    zone: "core",
    muscles: ["obliques"],
    wgerIds: [14],
  },
  biceps: {
    name: "Сгибатели локтя",
    zone: "biceps",
    muscles: ["biceps-brachii", "brachialis"],
    wgerIds: [1, 13],
  },
  triceps: {
    name: "Трицепс",
    zone: "triceps",
    muscles: ["triceps-brachii"],
    wgerIds: [5],
  },
  deltoids: {
    name: "Дельтовидные",
    zone: "shoulders",
    muscles: ["deltoid-anterior", "deltoid-middle", "deltoid-posterior"],
    wgerIds: [2],
  },
  trapezius: {
    name: "Трапециевидная",
    zone: "back",
    muscles: ["trapezius-upper", "trapezius-middle", "trapezius-lower"],
    wgerIds: [9],
  },
  "upper-back": {
    name: "Широчайшие и верх спины",
    zone: "back",
    muscles: [
      "latissimus-dorsi",
      "teres-major",
      "rhomboids",
      "infraspinatus",
      "teres-minor",
    ],
    wgerIds: [12],
  },
  "lower-back": {
    name: "Разгибатели позвоночника",
    zone: "back",
    muscles: ["erector-spinae"],
    wgerIds: [],
  },
  forearm: {
    name: "Плечелучевая / предплечья",
    zone: "biceps",
    muscles: ["brachioradialis"],
    wgerIds: [],
  },
  gluteal: {
    name: "Ягодичные",
    zone: "glutes",
    muscles: ["gluteus-maximus", "gluteus-medius"],
    wgerIds: [8],
  },
  adductors: {
    name: "Приводящие бедра",
    zone: "glutes",
    muscles: ["adductor-magnus"],
    wgerIds: [],
  },
  quadriceps: {
    name: "Квадрицепс",
    zone: "quads",
    muscles: ["quadriceps-vasti", "rectus-femoris"],
    wgerIds: [10],
  },
  hamstring: {
    name: "Задняя поверхность бедра",
    zone: "hamstrings",
    muscles: [
      "biceps-femoris-long",
      "biceps-femoris-short",
      "semitendinosus",
      "semimembranosus",
    ],
    wgerIds: [11],
  },
  calves: {
    name: "Икроножная и камбаловидная",
    zone: "calves",
    muscles: ["gastrocnemius", "soleus"],
    wgerIds: [7, 15],
  },
};
export const loadColor = (ratio: number) =>
  ratio === 0
    ? "#363c3d"
    : ratio < 0.5
      ? "#657b51"
      : ratio < 0.8
        ? "#9dbd68"
        : ratio <= 1.25
          ? "#cafa64"
          : "#e3b279";
export class AnatomyPresenter {
  constructor(
    private loads: MuscleLoad[],
    private workouts: Workout[] = [],
    private options: { mapping?: "recorded" | "current"; maxRir?: number } = {},
  ) {}
  part(
    slug: string,
    side: "front" | "back" = "front",
  ): AnatomyPart | undefined {
    const data = PARTS[slug];
    if (!data) return;
    return {
      slug,
      ...data,
      muscles:
        slug === "deltoids"
          ? side === "front"
            ? ["deltoid-anterior", "deltoid-middle"]
            : ["deltoid-posterior", "deltoid-middle"]
          : data.muscles,
    };
  }
  activity(part: AnatomyPart) {
    const result = { direct: 0, assisting: 0, stabilizing: 0 };
    for (const workout of this.workouts)
      for (const entry of workout.exercises) {
        const exercise =
          this.options.mapping === "current"
            ? exerciseById(entry.exerciseId)
            : exerciseForEntry(entry);
        if (!exercise) continue;
        const count = entry.sets.filter(
          (s) =>
            s.done &&
            !s.warmup &&
            (this.options.maxRir === undefined || s.rir <= this.options.maxRir),
        ).length;
        const roles = exercise.muscles.filter((m) =>
          part.muscles.includes(m.muscleId),
        );
        if (roles.some((m) => m.role === "primary")) result.direct += count;
        else if (roles.some((m) => m.role === "assistant"))
          result.assisting += count;
        else if (roles.some((m) => m.role === "stabilizer"))
          result.stabilizing += count;
      }
    const goal = this.loads.find((l) => l.id === part.zone)?.goal ?? 1;
    return { ...result, goal, ratio: result.direct / goal };
  }
  exerciseRole(part: AnatomyPart, exercise: Exercise) {
    const roles = exercise.muscles.filter((m) =>
      part.muscles.includes(m.muscleId),
    );
    if (roles.some((m) => m.role === "primary")) return "primary";
    if (roles.some((m) => m.role === "assistant")) return "assistant";
    if (roles.some((m) => m.role === "stabilizer")) return "stabilizer";
    if (exercise.source) {
      if (
        exercise.source.record.muscles.some((m) => part.wgerIds.includes(m.id))
      )
        return "primary";
      if (
        exercise.source.record.secondaryMuscles.some((m) =>
          part.wgerIds.includes(m.id),
        )
      )
        return "assistant";
    }
    return undefined;
  }
}
