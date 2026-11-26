import { exerciseById } from "../lib/model";
import { PeriodizationRules } from "./PeriodizationRules";
import type { PrescriptionMode, SubstitutionClass } from "./SubstitutionPolicy";
import type { LaidDay, LaidMaxes, Muscle, RoutinePeriodization } from "../lib/types";

export type { LaidDay };
export type LaidLift = keyof LaidMaxes;
export type LaidVersion = "v1" | "v2";
export type LaidStimulus = "H" | "M" | "S";
export type LaidRhythm = "6x1" | "3x1x3";
export type LaidSubstitutions = Record<string, string>;
/** Слот недели (0 — Пн … 6 — Вс): один из шести дней цикла или выходной (`null`). */
export type LaidWeekSlot = LaidDay | null;

export const LAID_WEEKS = 9;
/** Недель в одной волне: три волны по три недели. */
export const WAVE_WEEKS = 3;
export const MAX_KG = PeriodizationRules.MAX_KG;

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

export type HeavyScheme = 1 | 3 | 5;
export type WorkReps = 2 | 4 | 6 | 8 | 10 | 12;
/** Схема дня по неделе волны: повторения тяжёлого подхода и откатных рабочих. */
export type DayScheme = { heavy: [HeavyScheme, HeavyScheme, HeavyScheme]; work: [WorkReps, WorkReps, WorkReps] };

export type LaidPlanSet = { reps: number; percent: number; weightKg: number };
export type LaidDayPlan = {
  version?: LaidVersion;
  stimulus?: LaidStimulus;
  day: LaidDay;
  position: LaidPosition;
  lift: LaidLift;
  liftExerciseId: string;
  originalLiftExerciseId: string;
  prescriptionMode: PrescriptionMode;
  subClass: SubstitutionClass;
  painFlag: boolean;
  /** Текущая неделя — встроенная или вставленная разгрузочная неделя цикла. */
  isDeload?: boolean;
  maxKg: number;
  heavy: LaidPlanSet & { light: boolean };
  work: LaidPlanSet & { sets: number; light?: boolean };
};

export type LaidCalibrationGraduation = {
  lift: LaidLift;
  exerciseId: string;
  exerciseName: string;
  sessions: number;
  estimated1Rm: number;
  suggestedTm: number;
};

export type LaidAuxProgressionHint = {
  kind: "raise_weight" | "add_reps" | "consolidate";
  title: string;
  detail: string;
  suggestedWeightKg?: number;
};

export type LaidCycleState = {
  first: RoutinePeriodization;
  rawWeek: number;
  totalWeeks: number;
  isCurrentDeload: boolean;
  deloadsBefore: number;
  position: LaidPosition;
  activeMaxes: LaidMaxes;
  statusWeek: number;
  weekGuide: LaidWeekGuide;
};

export type LaidCycleSummary = {
  completedSessions: number;
  plannedSessions: number;
  adherencePct: number;
  totalTonnageKg: number;
  lifts: {
    lift: LaidLift;
    name: string;
    startMax: number;
    bestE1rm: number | null;
    suggestedNextTm: number | null;
    deltaKg: number | null;
  }[];
};

/** Автоматическое обновление максимумов: какие лифты и на сколько выросли, с какой недели действует. */
export type LaidAutoUpdate = {
  maxes: LaidMaxes;
  applied: { lift: LaidLift; from: number; estimate: number; to: number }[];
  fromWeek: number;
};

export type LaidExerciseSpec = {
  exerciseId: string;
  role: "lift" | "wave-aux" | "aux" | "added";
  setsLabel: string;
  intensityLabel: string;
  rirLabel: string;
  restLabel: string;
  restSeconds: number;
  note?: string;
  added: boolean;
  replacedFrom?: string;
};

export type LaidWeekGuide = {
  weekNumber: number;
  totalWeeks: number;
  wave: 1 | 2 | 3;
  waveTitle: string;
  badge: string;
  focusTitle: string;
  summary: string;
  baseRir: string;
  auxRir: string;
  restSummary: string;
  isDeloadWindow: boolean;
};

export type LaidExerciseGuidance = {
  role: "lift" | "wave-aux" | "compound-aux" | "isolation-aux" | "added";
  roleLabel: string;
  rirLabel: string;
  rirPlaceholder: string;
  restSeconds: number;
  restLabel: string;
  detail: string;
};

export type LaidSlotInfo = {
  originalId: string;
  resolvedId: string;
  role: "lift" | "wave-aux" | "aux" | "added";
  lift?: LaidLift;
  days: LaidDay[];
  weeklySets: number;
  replaced: boolean;
};

export type LaidLastSetSummary = {
  weightKg: number;
  reps: number;
  rir: number | null;
  durationSeconds?: number;
  assistanceKg?: number;
  date: string;
  label: string;
};

export type LaidDayExercisePreview = {
  originalId: string;
  exerciseId: string;
  name: string;
  replacedFromName: string | null;
  role: "lift" | "wave-aux" | "aux" | "added";
  setsRepsLabel: string;
  weightLabel: string;
  weightSource: "plan" | "history" | "deload" | "bodyweight" | "none";
  rirLabel: string;
  restLabel: string;
  isAdded: boolean;
  isReplaced: boolean;
};

export type LaidWaveWeekPoint = {
  week: number;
  weekNumber: number;
  wave: 1 | 2 | 3;
  isDeload: boolean;
  plannedTopKg: number | null;
  actualE1rm: number | null;
  actualTopKg: number | null;
};

export type LaidWaveLiftProgress = {
  lift: LaidLift;
  name: string;
  exerciseId: string;
  startMaxKg: number;
  currentMaxKg: number;
  plannedPeakKg: number | null;
  bestE1rm: number | null;
  deltaKg: number | null;
  weeks: LaidWaveWeekPoint[];
  waves: {
    wave: 1 | 2 | 3;
    title: string;
    plannedPeakKg: number | null;
    bestE1rm: number | null;
    sessionsDone: number;
  }[];
};

export type LaidVolumeSummary = {
  totalSets: number;
  axialSets: number;
  muscles: { id: Muscle; name: string; sets: number }[];
};

export type Aux = {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** Повторения зависят от недели волны (push press, жим на наклонной). */
  byWave?: [number, number, number];
  note?: string;
};

export type Layout = { aux: Aux[]; extras: Aux[] };

const AXIAL_FAMILIES = new Set([
  "squat",
  "hip-hinge",
  "overhead-press",
  "horizontal-row-free",
  "horizontal-row",
  "loaded-carry",
]);

export function isAxialExercise(exerciseId: string): boolean {
  const def = exerciseById(exerciseId);
  if (!def) return false;
  if (
    def.recording.loadMode === "machine_stack" ||
    def.recording.loadMode === "bodyweight" ||
    def.recording.loadMode === "assisted_bodyweight"
  )
    return false;
  if (
    def.id.includes("chest-supported") ||
    def.id.includes("seal") ||
    def.id.includes("legpress") ||
    def.id.includes("hack-squat") ||
    def.id.includes("hip-thrust") ||
    def.id.includes("belt-squat")
  )
    return false;
  if (def.familyId === "lunge") return def.recording.loadMode === "total_external";
  if (AXIAL_FAMILIES.has(def.familyId)) {
    return def.equipment === "gym" || def.recording.loadMode === "total_external";
  }
  return false;
}

const COMPOUND_AUX_FAMILIES = new Set([
  "squat",
  "hip-hinge",
  "horizontal-press",
  "overhead-press",
  "vertical-pull",
  "horizontal-row",
  "horizontal-row-free",
  "dip",
]);

export function isHeavyCompoundAux(exerciseId: string): boolean {
  const def = exerciseById(exerciseId);
  if (!def) return false;
  if (COMPOUND_AUX_FAMILIES.has(def.familyId)) return true;
  if (def.recording.loadMode === "machine_stack") return false;
  return def.jointActions.length >= 2 || def.primary.length >= 2;
}

const a = (exerciseId: string, repMin = 10, repMax = repMin, sets = 3, note?: string): Aux => ({
  exerciseId,
  sets,
  repMin,
  repMax,
  ...(note ? { note } : {}),
});

const LEGS_1_AUX = [
  a("rdl", 10, 10, 3, "Тазобедренный шарнир с акцентом на растяжение бицепса бедра"),
  a("lunge-bar", 10, 10, 3, "10 повторений на каждую ногу"),
  a("legcurl-seated", 10, 12, 3, "Замена GHR из таблицы для обычного зала: сгибание колена без осевой нагрузки на поясницу"),
];

const LEGS_2_AUX = [
  a("rdl", 10, 10, 3, "Контролируемое опускание, без рывка с нижней точки"),
  a("lunge-bar", 10, 10, 3, "10 повторений на каждую ногу"),
  a("legcurl-prone", 10, 12, 3, "Замена GHR: сгибание колена лёжа, без осевой нагрузки на поясницу; второй вариант того же движения"),
];

const PULL_AUX = [
  a("deadlift-stiff", 10, 10, 3, "По таблице Лейда — с возвышения 5–7 см (2–3″); при усталости поясницы работай с пола"),
  a("pullup-weighted", 8, 10, 3, "Добавляй вес на пояс по мере сил"),
  a("row-yates", 10, 10, 3, "Наклон ~45°, обратный хват к низу живота"),
  a("shrug-bar", 10, 10, 3),
  a("curl-bar", 10, 10, 3),
  a("hammer-seated", 10, 10, 3),
];

export const LAID_NAMES: Record<LaidDay, string> = {
  legs1: "Лейд · Ноги 1",
  push1: "Лейд · Жим 1",
  pull1: "Лейд · Тяга 1",
  legs2: "Лейд · Ноги 2",
  push2: "Лейд · Жим 2",
  pull2: "Лейд · Тяга 2",
};

export const LAID_SHORT: Record<LaidDay, string> = {
  legs1: "Ноги 1",
  push1: "Жим 1",
  pull1: "Тяга 1",
  legs2: "Ноги 2",
  push2: "Жим 2",
  pull2: "Тяга 2",
};

export const LAID_ORIGINAL: Record<LaidDay, string> = {
  legs1: "Legs 1",
  push1: "Push 1",
  pull1: "Pull 1",
  legs2: "Legs 2",
  push2: "Push 2",
  pull2: "Pull 2",
};

export const LAID_WEEKDAY: Record<LaidDay, number> = {
  legs1: 0,
  push1: 1,
  pull1: 2,
  legs2: 3,
  push2: 4,
  pull2: 5,
};

export const LAID_RHYTHM_WEEKDAYS: Record<LaidRhythm, Record<LaidDay, number>> = {
  "6x1": LAID_WEEKDAY,
  "3x1x3": { legs1: 0, push1: 1, pull1: 2, legs2: 4, push2: 5, pull2: 6 },
};

export const LAID_WAVE_META: Record<1 | 2 | 3, { title: string; subtitle: string; range: string }> = {
  1: { title: "Втягивание", subtitle: "Стартовые проценты волны: 85 / 90 / 95 % на топ-сетах", range: "Недели 1–3" },
  2: { title: "Интенсификация", subtitle: "Рост процентов во всех схемах: 86 / 91 / 96,5 % на топ-сетах", range: "Недели 4–6" },
  3: { title: "Пик силы", subtitle: "Пиковые веса цикла: 88 / 92,5 / 97,5 % на топ-сетах", range: "Недели 7–9" },
};

export const LAID_LIFT_OF: Record<LaidDay, LaidLift> = {
  legs1: "squat",
  push1: "bench",
  pull1: "deadlift",
  legs2: "squat",
  push2: "ohp",
  pull2: "deadlift",
};

export const LAID_LIFT_EXERCISE: Record<LaidLift, string> = {
  squat: "squat",
  bench: "bench",
  deadlift: "deadlift-bar",
  ohp: "ohp-bar",
};

export const LAID_LIFT_LABEL: Record<LaidLift, string> = {
  squat: "присед",
  bench: "жим лёжа",
  deadlift: "становая",
  ohp: "армейский жим",
};

export const LAID_SCHEME: Record<LaidDay, DayScheme> = {
  legs1: { heavy: [5, 1, 3], work: [12, 4, 8] },
  push1: { heavy: [1, 3, 5], work: [4, 8, 12] },
  pull1: { heavy: [3, 1, 5], work: [6, 2, 10] },
  legs2: { heavy: [3, 5, 1], work: [8, 12, 4] },
  push2: { heavy: [5, 1, 3], work: [12, 4, 8] },
  pull2: { heavy: [1, 5, 3], work: [2, 10, 6] },
};

export const LAID_HEAVY_PCT: Record<HeavyScheme, [number, number, number]> = {
  5: [85, 86, 88],
  3: [90, 91, 92.5],
  1: [95, 96.5, 97.5],
};

export const LAID_WORK_PCT: Record<WorkReps, [number, number, number]> = {
  12: [65, 66, 67],
  10: [70, 71, 72],
  8: [75, 76, 77],
  6: [80, 81, 82],
  4: [85, 86, 87],
  2: [92.5, 93, 93.5],
};

export const LAID_LAYOUT: Record<LaidDay, Layout> = {
  legs1: {
    aux: LEGS_1_AUX,
    extras: [
      a("calf-standing-machine", 12, 15, 3, "Икроножная на прямых коленях (в оригинале икр нет)"),
      a("hanging-leg-raise", 10, 15, 3, "Прямая мышца живота с подкручиванием таза"),
    ],
  },
  legs2: {
    aux: LEGS_2_AUX,
    extras: [a("calf-seated", 12, 15, 3, "Камбаловидная мышца при согнутых коленях (в оригинале икр нет)")],
  },
  push1: {
    aux: [
      { ...a("push-press", 4, 12, 3, "Повторения меняются с волной жима: 4 → 8 → 12"), byWave: [4, 8, 12] },
      a("dip-weighted", 10, 10, 3, "Дополнительный вес на поясе"),
      a("fly-db-flat", 10, 10, 3, "В таблице: разведения гантелей или пек-дек"),
      a("lateral", 10, 10, 3),
      a("skullcrusher-ez", 10, 10, 3),
      a("triceps-db", 10, 10, 3, "Акцент на длинную головку трицепса в растяжении"),
    ],
    extras: [a("lateral-cable-single", 12, 15, 3, "Постоянное натяжение средней дельты с нижнего блока")],
  },
  push2: {
    aux: [
      { ...a("incline-bar", 4, 12, 3, "Повторения меняются с волной жима стоя: 12 → 4 → 8"), byWave: [12, 4, 8] },
      a("lateral", 10, 10, 3, "Стоит перед брусьями по оригиналу — даёт передышку трицепсу"),
      a("dip-weighted", 10, 10, 3, "Дополнительный вес на поясе"),
      a("triceps-db", 10, 10, 3, "В Push 2 идёт перед французским жимом по таблице"),
      a("skullcrusher-ez", 10, 10, 3),
    ],
    extras: [a("lateral-cable-single", 12, 15, 3, "Дополнительный объём средней дельты")],
  },
  pull1: {
    aux: PULL_AUX,
    extras: [a("rear-delt-fly", 12, 15, 3, "Баланс плечевого сустава под большой объём жимов")],
  },
  pull2: {
    aux: PULL_AUX,
    extras: [
      a("rear-delt-fly", 12, 15, 3, "Обратный пек-дек на заднюю дельту"),
      a("ab-roller", 8, 12, 3, "Жёсткое антиразгибание кора"),
    ],
  },
};

export const LAID_SPINE_FRIENDLY_SUBS: LaidSubstitutions = {
  "deadlift-stiff": "legcurl-prone",
  "row-yates": "row",
  "lunge-bar": "legpress",
};

/** Пресет замен для длинных рычагов (эктоморф): меньше осевой нагрузки + акцент на растяжение и безопасные углы плеч/таза. */
export const LAID_LONG_LEVERS_SUBS: LaidSubstitutions = {
  "deadlift-stiff": "legcurl-prone",
  "row-yates": "row",
  "lunge-bar": "legpress",
  "incline-bar": "incline-db",
  "fly-db-flat": "pec-deck-fly",
  "curl-bar": "curl-incline-db",
};

// ─────────────────────────────────────────────────────────────────────────────
// David Laid DUP v2 («Умный DUP v2: Баланс и защита») — спецификация для длинных рычагов
// 10-цикловый мезоцикл (3 волны × 3 цикла + встроенная активная разгрузка на 7-м цикле),
// плавающий ритм 3/1, TM = 90 % от 1ПМ, 124 рабочих подхода/цикл (14 пояснично-осевых, −68 %).
// ─────────────────────────────────────────────────────────────────────────────

export const LAID_V2_TM_FACTOR = 0.9;
export const LAID_V2_DELOAD_WEEK = 6; // 0-based индекс → Цикл 7 (между Волной 2 и Волной 3)

export const LAID_V2_LIFT_EXERCISE_BY_DAY: Record<LaidDay, string> = {
  legs1: "squat",
  push1: "bench",
  pull1: "trap-bar-deadlift",
  legs2: "squat",
  push2: "ohp-bar",
  pull2: "row-chest-supported",
};

/** Шахматная ротация стимулов (H / M / S) внутри каждой 3-цикловой волны: S-присед не совпадает с S-тягой, S-жим с S-OHP. */
export const LAID_V2_STIMULUS: Record<LaidDay, [LaidStimulus, LaidStimulus, LaidStimulus]> = {
  legs1: ["H", "S", "M"],
  push1: ["S", "M", "H"],
  pull1: ["S", "H", "M"],
  legs2: ["M", "H", "S"],
  push2: ["H", "S", "M"],
  pull2: ["M", "S", "H"],
};

export type LaidV2SetRecipe = {
  heavyReps: number;
  heavyPct: number;
  workSets: number;
  workReps: number;
  workPct: number;
};

/** Матрица процентов (% от TM = 90 % 1ПМ) для приседа, жима лёжа и армейского жима по Волнам 1 / 2 / 3. */
export const LAID_V2_MAIN_MATRIX: Record<LaidStimulus, [LaidV2SetRecipe, LaidV2SetRecipe, LaidV2SetRecipe]> = {
  H: [
    { heavyReps: 6, heavyPct: 85, workSets: 3, workReps: 10, workPct: 72.5 },
    { heavyReps: 6, heavyPct: 87.5, workSets: 3, workReps: 10, workPct: 75 },
    { heavyReps: 6, heavyPct: 90, workSets: 3, workReps: 8, workPct: 82.5 },
  ],
  M: [
    { heavyReps: 5, heavyPct: 90, workSets: 3, workReps: 8, workPct: 77.5 },
    { heavyReps: 4, heavyPct: 92.5, workSets: 3, workReps: 8, workPct: 80 },
    { heavyReps: 4, heavyPct: 95, workSets: 3, workReps: 6, workPct: 87.5 },
  ],
  S: [
    { heavyReps: 3, heavyPct: 95, workSets: 3, workReps: 5, workPct: 85 },
    { heavyReps: 3, heavyPct: 97.5, workSets: 3, workReps: 5, workPct: 87.5 },
    { heavyReps: 3, heavyPct: 100, workSets: 3, workReps: 4, workPct: 90 },
  ],
};

/** Матрица процентов для становой с трэп-грифом (Pull 1: 1 топ + 2 откатных = 3 подхода). */
export const LAID_V2_TRAP_MATRIX: Record<LaidStimulus, [LaidV2SetRecipe, LaidV2SetRecipe, LaidV2SetRecipe]> = {
  H: [
    { heavyReps: 5, heavyPct: 87.5, workSets: 2, workReps: 6, workPct: 82.5 },
    { heavyReps: 5, heavyPct: 90, workSets: 2, workReps: 6, workPct: 85 },
    { heavyReps: 5, heavyPct: 92.5, workSets: 2, workReps: 6, workPct: 85 },
  ],
  M: [
    { heavyReps: 4, heavyPct: 90, workSets: 2, workReps: 5, workPct: 85 },
    { heavyReps: 4, heavyPct: 92.5, workSets: 2, workReps: 5, workPct: 87.5 },
    { heavyReps: 4, heavyPct: 95, workSets: 2, workReps: 5, workPct: 87.5 },
  ],
  S: [
    { heavyReps: 3, heavyPct: 92.5, workSets: 2, workReps: 4, workPct: 87.5 },
    { heavyReps: 3, heavyPct: 95, workSets: 2, workReps: 4, workPct: 90 },
    { heavyReps: 3, heavyPct: 97.5, workSets: 2, workReps: 4, workPct: 90 },
  ],
};

/** DUP-схема для базовой тяги с упором грудью (Pull 2, двойная прогрессия / по RIR, без второй становой с пола). */
export const LAID_V2_PULL2_ROW: Record<LaidStimulus, { heavyReps: number; workSets: number; workReps: number }> = {
  H: { heavyReps: 10, workSets: 3, workReps: 12 },
  M: { heavyReps: 8, workSets: 3, workReps: 10 },
  S: { heavyReps: 6, workSets: 3, workReps: 8 },
};

/** Полный 6-дневный состав David Laid DUP v2 (124 подхода/цикл: 21 + 19 + 19 + 21 + 23 + 21). */
export const LAID_V2_LAYOUT: Record<LaidDay, Layout> = {
  legs1: {
    aux: [
      a("hack-squat", 8, 12, 3, "Максимальное сгибание колена без отрыва таза; альтернатива: жим ногами 45°"),
      a("legcurl-seated", 10, 15, 3, "Растянутая позиция бицепса бедра сидя (Maeo, 2021), пауза 0,5 с"),
      a("leg-extension", 12, 15, 3, "Изолированный рост прямой мышцы бедра (Kubo, 2019), спинка ~105°"),
    ],
    extras: [
      a("calf-standing-machine", 10, 15, 4, "Икроножная на прямых коленях, пауза 1 с в глубоком растяжении"),
      a("cable-crunch", 10, 15, 4, "Сгибание позвоночника «рёбра к тазу», таз неподвижен"),
    ],
  },
  push1: {
    aux: [
      a("incline-db", 8, 12, 3, "Угол скамьи 30°, локти 45–60°, плавное растяжение верха груди"),
      a("pec-deck-fly", 10, 15, 3, "Ровный профиль натяжения без переразгибания передней капсулы плеча"),
      a("lateral-cable-single", 12, 15, 5, "Средняя дельта с пиком нагрузки в растяжении, плоскость лопатки 30°"),
      a("extension-overhead-cable", 10, 14, 4, "Длинная головка трицепса в растяжении (Maeo, 2023), 2–3 с вниз"),
    ],
    extras: [],
  },
  pull1: {
    aux: [
      a("pullup-weighted", 6, 10, 4, "Ширина спины без осевой компрессии, полное растяжение широчайших"),
      a("row-chest-supported", 8, 12, 4, "Упор грудью снимает сдвигающий момент L5/S1; локти 45–60°"),
      a("rear-delt-fly", 12, 15, 4, "Изоляция задней дельты в обратном Пек-Дек без избыточного сведения лопаток"),
      a("curl-preacher-ez", 8, 12, 4, "Приоритет брахиалиса и дистальной плотности длинных рук, 3 с вниз"),
    ],
    extras: [],
  },
  legs2: {
    aux: [
      a("rdl", 8, 10, 4, "Таз назад, эксцентрика 3 с и пауза 0,5 с в растяжении без округления поясницы"),
      a("bulgarian-split-squat", 8, 10, 3, "Свободная рука на стойке для баланса; наклон торса ~15°, на каждую ногу"),
      a("legcurl-seated", 10, 15, 3, "Вторая точка нагрузки на бицепс бедра сидя (10 прямых подходов/цикл)"),
    ],
    extras: [
      a("calf-legpress", 12, 15, 4, "Прямые колени без компрессии позвоночника после RDL, пауза 1 с в растяжении"),
      a("calf-seated", 12, 20, 4, "Изоляция камбаловидной мышцы при согнутом колене 90°"),
    ],
  },
  push2: {
    aux: [
      { ...a("incline-db", 6, 12, 3, "Волновая подсобка верха груди 30°: H 3×12 / S 3×6 / M 3×8"), byWave: [12, 6, 8] },
      a("dip-weighted", 8, 12, 3, "Наклон торса 20–30°, глубина до параллели плеча полу"),
      a("lateral", 12, 15, 5, "Восходящий профиль гантелей дополняет блок Push 1 (10 прямых/цикл)"),
      a("extension-v-pushdown", 10, 15, 4, "Латеральная и медиальная головки трицепса без нагрузки на локти"),
    ],
    extras: [
      a("hanging-leg-raise", 10, 15, 4, "Обязательное заднее подкручивание таза вверх, без раскачки"),
    ],
  },
  pull2: {
    aux: [
      a("lat-pulldown", 8, 12, 4, "Нейтральный или средний хват к верху груди, отклонение ≤15°"),
      a("facepull-er", 15, 20, 4, "Наружная ротация плеча (кисти дальше локтей) — защита ротаторной манжеты"),
      a("shrug-db-incline", 12, 15, 3, "Лёгкий наклон 15°, пауза 1 с вверху без осевой нагрузки штангой"),
      a("hammer-seated", 10, 14, 3, "Плечелучевая и брахиалис для утолщения латерального контура длинных рук"),
      a("curl-incline-db", 10, 14, 3, "Наклон скамьи 45°, плечо за корпусом — акцент на двуглавую мышцу плеча"),
    ],
    extras: [],
  },
};

export const LAID_V2_SUMMARY_BULLETS: readonly { title: string; detail: string }[] = [
  {
    title: "−68 % нагрузки на поясницу",
    detail: "убраны вторая становая с пола и тяга Ятса, становая переведена на трэп-гриф, добавлены упоры грудью и ритм 3+1+3.",
  },
  {
    title: "Закрыты все отстающие зоны",
    detail: "добавлены икры (12 подх.), пресс (8 подх.), задние дельты (8 прямых), разгибания ног и 10 прямых на средние дельты.",
  },
  {
    title: "Нет опасных проходок на 1ПМ",
    detail: "прогрессивные волны от 90 % тренировочного максимума (3–6 повт., RIR 1–3) и встроенная активная разгрузка на 7-й неделе.",
  },
  {
    title: "Адаптация под длинные рычаги",
    detail: "подкладка под пятки, гакк-присед, наклон гантелями 30°, Пек-Дек, трицепс из-за головы и связка Скотт + наклонная.",
  },
  {
    title: "57–65 минут вместо 1,5 часов",
    detail: "сбалансированный объём 10–20 подходов на каждую из 13 мышечных групп и плавающая неделя без «сгорания» волн.",
  },
];

export const LAID_TRAINING_MAX_FACTOR = 0.925;
export const LAID_PLAN_MARK = "Тяжёлый подход:";
export const LAID_REST_SUMMARY = "База 3–5 мин · тяжёлая подсобка 2–3 мин · тренажёры/изоляция 1–1,5 мин";
export const LAID_V2_REST_SUMMARY = "База 2,5–3,5 мин · подсобка 2–2,5 мин · изоляция 75–90 с";
export const LAID_NOTICE = "Веса восстановлены по опубликованной таблице и округлены; официальный калькулятор может дать другие числа.";
export const LAID_AUTO_NOTICE = "Максимумы обновляются автоматически, когда оценка 1ПМ по свежим подходам выше действующей на 5 %.";
export const LAID_LOAD_NOTICE = "Шесть тренировок в неделю и тяжёлые подходы — вводи осторожный тренировочный максимум (90–95 % от реального 1ПМ).";
export const LAID_DELOAD_NOTICE =
  "После 9-й недели проведи разгрузочную неделю (50–60 % от 1ПМ, половина подходов, запас 3–4 повторения) перед новым циклом.";

export function layoutForVersion(version?: LaidVersion): Record<LaidDay, Layout> {
  return version === "v2" ? LAID_V2_LAYOUT : LAID_LAYOUT;
}

export function liftExerciseForDay(day: LaidDay, version?: LaidVersion): string {
  return version === "v2" ? LAID_V2_LIFT_EXERCISE_BY_DAY[day] : LAID_LIFT_EXERCISE[LAID_LIFT_OF[day]];
}

export function resolveLaidExerciseId(originalId: string, substitutions?: LaidSubstitutions): string {
  return substitutions?.[originalId] || originalId;
}

export function laidOriginalIds(day: LaidDay, substitutions?: LaidSubstitutions, version?: LaidVersion): string[] {
  const layout = layoutForVersion(version)[day];
  return [
    resolveLaidExerciseId(liftExerciseForDay(day, version), substitutions),
    ...layout.aux.map((x) => resolveLaidExerciseId(x.exerciseId, substitutions)),
  ];
}

export function laidAuxReps(
  day: LaidDay,
  exerciseId: string,
  inWave: 0 | 1 | 2,
  substitutions?: LaidSubstitutions,
  version?: LaidVersion,
): number | null {
  const found = layoutForVersion(version)[day].aux.find(
    (x) => resolveLaidExerciseId(x.exerciseId, substitutions) === exerciseId,
  );
  return found?.byWave ? found.byWave[inWave] : null;
}
