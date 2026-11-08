import { exerciseForEntry, exerciseById } from "../lib/catalog";
import type { AnalysisOptions } from "./TrainingAnalytics";
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
  "chest-upper": {
    name: "Верх груди",
    zone: "chest",
    muscles: ["pectoralis-clavicular"],
    wgerIds: [4],
  },
  "chest-mid": {
    name: "Середина груди",
    zone: "chest",
    muscles: ["pectoralis-sternal"],
    wgerIds: [4],
  },
  "chest-lower": {
    name: "Низ груди",
    zone: "chest",
    muscles: ["pectoralis-abdominal"],
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
  "deltoid-anterior": {
    name: "Передняя дельта",
    zone: "shoulders",
    muscles: ["deltoid-anterior"],
    wgerIds: [2],
  },
  "deltoid-middle": {
    name: "Средняя дельта",
    zone: "shoulders",
    muscles: ["deltoid-middle"],
    wgerIds: [2],
  },
  "deltoid-posterior": {
    name: "Задняя дельта",
    zone: "shoulders",
    muscles: ["deltoid-posterior"],
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
  tibialis: {
    name: "Передняя большеберцовая",
    zone: "calves",
    muscles: ["tibialis-anterior"],
    wgerIds: [],
  },
  neck: {
    name: "Мышцы шеи",
    zone: "back",
    muscles: ["neck-muscles", "trapezius-upper"],
    wgerIds: [],
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

export function inferExactMuscleHeadRole(
  partSlug: string,
  exercise: Exercise,
): "primary" | "assistant" | "stabilizer" | undefined {
  const pec = exercise.muscles.find((m) => m.muscleId === "pectoralis-major");
  const id = (exercise.id || "").toLowerCase();
  const name = (exercise.name || "").toLowerCase();
  const nameEn = (exercise.nameEn || "").toLowerCase();
  const fullText = `${id} ${name} ${nameEn}`;

  const hasPec =
    !!pec ||
    exercise.muscles.some((m) => m.muscleId.startsWith("pectoralis")) ||
    (exercise.source?.record.muscles.some((m) => m.id === 4) ?? false) ||
    (exercise.primary || []).includes("chest") ||
    /груд|bench|chest|fly|отжим|пек-дек|кроссовер|dips/i.test(fullText);

  const hasDelt =
    exercise.muscles.some((m) => m.muscleId.startsWith("deltoid")) ||
    (exercise.source?.record.muscles.some((m) => m.id === 2) ?? false) ||
    (exercise.primary || []).includes("shoulders") ||
    /дельт|shoulder|overhead|армейск|махи|разведение|фейспул/i.test(fullText);

  // 1. CHEST SUBHEADS
  if (partSlug.startsWith("chest-") || partSlug.startsWith("pectoralis-")) {
    if (!hasPec) return undefined;

    const isUpper =
      /incline|наклон|pullover|пуловер|снизу вверх|low[- ]cable/i.test(fullText);
    const isLower =
      /decline|обратн|брусь|dip|сверху вниз|high[- ]cable/i.test(fullText);
    const isMid = !isUpper && !isLower;

    if (partSlug === "chest-upper" || partSlug === "pectoralis-clavicular") {
      if (isUpper) return pec?.role ?? "primary";
      if (isMid) return (pec?.role === "primary" ? "assistant" : undefined) ?? "assistant";
      return undefined;
    }
    if (partSlug === "chest-lower" || partSlug === "pectoralis-abdominal") {
      if (isLower) return pec?.role ?? "primary";
      if (isMid) return (pec?.role === "primary" ? "assistant" : undefined) ?? "assistant";
      return undefined;
    }
    if (partSlug === "chest-mid" || partSlug === "pectoralis-sternal") {
      if (isMid) return pec?.role ?? "primary";
      if (isUpper || isLower) return "assistant";
      return undefined;
    }
  }

  // 2. DELTOID SUBHEADS
  if (partSlug.startsWith("deltoid-")) {
    if (!hasDelt && !hasPec) return undefined;

    const isRear =
      /rear|задн|face[- ]?pull|фейспул|reverse[- ]?(pec|fly)|в наклоне/i.test(fullText);
    const isSide =
      /lateral|сторон|боков|отведен|upright[- ]?row|протяжк|подбородк/i.test(fullText) && !isRear;
    const isFront =
      /ohp|overhead|military|армейск|стоя|сидя|над головой|арнольд|front[- ]?raise|перед собой|передн/i.test(fullText) ||
      (hasPec && !isRear && !isSide);

    if (partSlug === "deltoid-posterior") {
      if (isRear) return "primary";
      return undefined;
    }
    if (partSlug === "deltoid-middle") {
      if (isSide) return "primary";
      if (isFront && !hasPec) return "primary";
      if (isRear) return "assistant";
      return undefined;
    }
    if (partSlug === "deltoid-anterior") {
      if (isFront) return hasPec ? "assistant" : "primary";
      return undefined;
    }
  }

  return undefined;
}

export class AnatomyPresenter {
  constructor(
    private loads: MuscleLoad[],
    private workouts: Workout[] = [],
    private options: AnalysisOptions = {},
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
            (this.options.setKind === "all" || (this.options.setKind === "warmup" ? s.warmup : !s.warmup)) &&
            (this.options.maxRir === undefined ||
              (s.rir !== null && s.rir <= this.options.maxRir)),
        ).length;
        const roles = exercise.muscles.filter((m) =>
          part.muscles.includes(m.muscleId),
        );
        let role = roles.find((m) => m.role === "primary")?.role ||
                   roles.find((m) => m.role === "assistant")?.role ||
                   roles.find((m) => m.role === "stabilizer")?.role;
        if (!role) {
          role = inferExactMuscleHeadRole(part.slug, exercise);
        }
        if (role === "primary") result.direct += count;
        else if (role === "assistant") result.assisting += count;
        else if (role === "stabilizer") result.stabilizing += count;
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
    const inferred = inferExactMuscleHeadRole(part.slug, exercise);
    if (inferred) return inferred;
    if (exercise.source && exercise.provenance.reviewStatus === "source-unreviewed") {
      if (
        !part.slug.includes("-") &&
        exercise.source.record.muscles.some((m) => part.wgerIds.includes(m.id))
      )
        return "primary";
      if (
        !part.slug.includes("-") &&
        exercise.source.record.secondaryMuscles.some((m) =>
          part.wgerIds.includes(m.id),
        )
      )
        return "assistant";
    }
    return undefined;
  }
}
