import { MUSCLES, type Muscle } from "../data/muscles";
import { exerciseForEntry } from "../lib/catalog";
import type { Workout } from "../lib/types";
import { BiomechanicsProfileStore } from "./BiomechanicsProfile";
import { DeloadEngine } from "./DeloadEngine";
import { MuscleReadiness, type MuscleReadinessGroupV2Id } from "./MuscleReadiness";
import { VolumeLandmarksCalculator, type VolumePhase } from "./VolumeLandmarks";

export interface PreviewMuscleImpact {
  muscle: Muscle;
  name: string;
  role: "primary" | "secondary";
  directAdded: number;
  indirectAdded: number;
  /** Эквивалентные подходы, которые добавит эта тренировка (прямые + 0,5 × косвенные). */
  addedSets: number;
  /** Текущий 7-дневный объём до этой тренировки. */
  beforeSets: number;
  /** Итоговый 7-дневный объём после этой тренировки. */
  afterSets: number;
  mev: number;
  mavLow: number;
  mavHigh: number;
  mrv: number;
  phaseAfter: VolumePhase;
  phaseLabelAfter: string;
  /** Готовность мышцы прямо сейчас (0–100 %, модель v2). */
  readinessPct: number;
  /** Была ли зафиксирована нагрузка на целевые подгруппы за последние 10 дн. */
  hasReadinessData: boolean;
}

export interface WorkoutPreviewAnalysis {
  workingSets: number;
  exerciseCount: number;
  estMinutes: number;
  estKcal: number;
  compoundSharePct: number;
  estimatedTonnageKg: number;
  tonnageComparison: string | null;
  axialBeforePct: number;
  axialAfterPct: number;
  localBeforePct: number;
  localAfterPct: number;
  axialTier: "low" | "moderate" | "high";
  axialTierLabel: string;
  muscles: PreviewMuscleImpact[];
  /** Интенсивность акцента 0..1 по каждой из 10 зон для SVG-силуэта тела. */
  bodyMap: Partial<Record<Muscle, { level: "primary" | "secondary"; intensity: number }>>;
  lowestTargetReadiness: { name: string; pct: number } | null;
  avgTargetReadinessPct: number;
  hasTargetReadinessData: boolean;
}

const MUSCLE_TO_V2_GROUPS: Record<Muscle, MuscleReadinessGroupV2Id[]> = {
  chest: ["chest"],
  back: ["lats_upper_back", "erectors"],
  shoulders: ["front_delts", "side_rear_delts"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  quads: ["quads"],
  hamstrings: ["hamstrings"],
  glutes: ["glutes"],
  calves: ["calves"],
  core: ["abs"],
};

const V2_GROUP_TO_MUSCLE: Record<MuscleReadinessGroupV2Id, Muscle> = {
  chest: "chest",
  lats_upper_back: "back",
  erectors: "back",
  front_delts: "shoulders",
  side_rear_delts: "shoulders",
  biceps: "biceps",
  triceps: "triceps",
  quads: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
  calves: "calves",
  abs: "core",
};

const round1 = (n: number) => Math.round(n * 10) / 10;

function formatTonnageAnalogy(tonnageKg: number): string | null {
  if (tonnageKg < 400) return null;
  if (tonnageKg < 1200) {
    const horses = Math.max(1, Math.round((tonnageKg / 500) * 10) / 10);
    return `как ${String(horses).replace(".", ",")} коня`;
  }
  if (tonnageKg < 3500) {
    const cars = Math.max(1, Math.round((tonnageKg / 1400) * 10) / 10);
    return `как ${String(cars).replace(".", ",")} авто`;
  }
  if (tonnageKg < 10000) {
    const suvs = Math.max(1, Math.round((tonnageKg / 2200) * 10) / 10);
    return `как ${String(suvs).replace(".", ",")} внедорожн.`;
  }
  const elephants = Math.max(1, Math.round((tonnageKg / 5500) * 10) / 10);
  return `как ${String(elephants).replace(".", ",")} слона`;
}

/**
 * Детерминированный предполётный анализ предстоящей тренировки:
 * - какие мышцы работают (прямо и косвенно) + прогноз недельного объёма (было → станет, MEV/MAV/MRV);
 * - прогноз EWMA-усталости (осевой и локальной) после тренировки;
 * - готовность целевых мышц (v2), соотношение база/изоляция, оценка калорий и тоннажа.
 */
export class WorkoutPreview {
  static analyze(
    planned: Workout,
    history: Workout[],
    today: string,
    timeZone?: string,
    options?: { isLongLimbed?: boolean; bodyMassKg?: number | null; now?: Date; accountId?: string },
  ): WorkoutPreviewAnalysis {
    const isLongLimbed = options?.isLongLimbed ?? BiomechanicsProfileStore.read(undefined, options?.accountId).longLevers;
    const bodyMassKg = options?.bodyMassKg ?? 75;
    const refNow = options?.now ?? new Date(`${today}T12:00:00Z`);

    // 1. Текущий недельный объём (исключаем саму тренировку, если она уже сохранена/в истории)
    const pastOnly = history.filter((w) => w.id !== planned.id);
    const weekReport = VolumeLandmarksCalculator.assessWeek(pastOnly, today, { timeZone, now: refNow });
    const beforeMap = new Map<Muscle, number>(
      weekReport.assessments.map((a) => [a.muscle, a.actualSets]),
    );

    // 2. Готовность мышц v2 прямо сейчас (если now не задан — детерминированный календарный расчёт без сдвига 12:00Z)
    const readinessV2 = MuscleReadiness.fromWorkoutsV2(pastOnly, today, timeZone, options?.now);
    const readinessByV2 = new Map(readinessV2.map((r) => [r.id, r]));

    // 3. Разбираем плановую тренировку по подходам, мышцам, осевой цене и тоннажу
    const directMap = new Map<Muscle, number>();
    const indirectMap = new Map<Muscle, number>();
    const targetedPrimaryV2 = new Map<Muscle, Set<MuscleReadinessGroupV2Id>>();
    const targetedAnyV2 = new Map<Muscle, Set<MuscleReadinessGroupV2Id>>();
    let workingSets = 0;
    let compoundSets = 0;
    let axialWeightedSum = 0;
    let estimatedTonnageKg = 0;

    // Строим синтетическую завершённую копию для прогноза EWMA
    const simulatedExercises = planned.exercises.map((entry) => {
      const def = exerciseForEntry(entry);
      const workSets = entry.sets.filter((s) => !s.warmup);
      const count = workSets.length;
      workingSets += count;

      const axialMult = DeloadEngine.axialLoadMultiplier(def);
      if (axialMult >= 0.5) compoundSets += count;
      axialWeightedSum += count * axialMult * (isLongLimbed && axialMult >= 1.5 ? 1.2 : 1.0);

      if (def) {
        if (count > 0) {
          for (const [v2Id, roleWeight] of MuscleReadiness.muscleRolesV2(def)) {
            const coarse = V2_GROUP_TO_MUSCLE[v2Id];
            if (!targetedAnyV2.has(coarse)) targetedAnyV2.set(coarse, new Set());
            targetedAnyV2.get(coarse)!.add(v2Id);
            if (roleWeight >= 1.0) {
              if (!targetedPrimaryV2.has(coarse)) targetedPrimaryV2.set(coarse, new Set());
              targetedPrimaryV2.get(coarse)!.add(v2Id);
            }
          }
        }
        const primaryZones =
          !def.primary.length && def.custom?.declaredZones?.length
            ? def.custom.declaredZones
            : def.primary;
        const primarySet = new Set<Muscle>(primaryZones);
        for (const m of primarySet) {
          directMap.set(m, (directMap.get(m) ?? 0) + count);
        }
        for (const m of def.secondary) {
          if (!primarySet.has(m)) {
            indirectMap.set(m, (indirectMap.get(m) ?? 0) + count);
          }
        }
      }

      const defaultReps = entry.repMax ?? entry.repMin ?? 10;
      return {
        ...entry,
        sets: entry.sets.map((s) => {
          if (s.warmup) return s;
          const reps = s.reps > 0 ? s.reps : defaultReps;
          const weight = s.weight > 0 ? s.weight : 0;
          if (
            weight > 0 &&
            def &&
            (def.recording.loadMode === "total_external" ||
              def.recording.loadMode === "per_implement" ||
              def.recording.loadMode === "machine_stack" ||
              def.recording.loadMode === "added_bodyweight")
          ) {
            const mult = def.recording.loadMode === "per_implement" ? 2 : 1;
            estimatedTonnageKg += weight * mult * reps;
          }
          return {
            ...s,
            reps,
            rir: s.rir ?? 2,
            done: true,
          };
        }),
      };
    });

    const simulatedWorkout: Workout = {
      ...planned,
      id: `preview-sim-${planned.id}`,
      date: today,
      exercises: simulatedExercises,
    };

    // 4. Прогноз EWMA до и после тренировки
    const evalOpts = {
      now: refNow,
      today,
      timeZone,
      isLongLimbed,
      currentBodyweightKg: bodyMassKg,
    };
    const ewmaBefore = DeloadEngine.evaluateV2(pastOnly, evalOpts);
    const ewmaAfter = DeloadEngine.evaluateV2([...pastOnly, simulatedWorkout], evalOpts);

    const axialBeforePct = Math.min(130, Math.round(ewmaBefore.axialUtilization * 100));
    const axialAfterPct = Math.min(130, Math.round(ewmaAfter.axialUtilization * 100));
    const localBeforePct = Math.min(130, Math.round(ewmaBefore.localUtilization * 100));
    const localAfterPct = Math.min(130, Math.round(ewmaAfter.localUtilization * 100));

    const axialTier: WorkoutPreviewAnalysis["axialTier"] =
      axialWeightedSum >= 18 ? "high" : axialWeightedSum >= 10 ? "moderate" : "low";
    const axialTierLabel =
      axialTier === "high"
        ? "Тяжёлая осевая"
        : axialTier === "moderate"
          ? "Средняя осевая"
          : "Щадящая поясницу";

    // 5. Собираем список целевых мышц с прогнозом недельного объёма
    const muscles: PreviewMuscleImpact[] = [];
    const bodyMap: WorkoutPreviewAnalysis["bodyMap"] = {};

    for (const meta of MUSCLES) {
      const m = meta.id;
      const directAdded = directMap.get(m) ?? 0;
      const indirectAdded = indirectMap.get(m) ?? 0;
      const addedSets = round1(directAdded + indirectAdded * 0.5);
      if (addedSets <= 0) continue;

      const beforeSets = round1(beforeMap.get(m) ?? 0);
      const afterSets = round1(beforeSets + addedSets);
      const assessedAfter = VolumeLandmarksCalculator.assessMuscleVolume(m, afterSets);
      const role: "primary" | "secondary" = directAdded > 0 ? "primary" : "secondary";
      const primarySubgroups = targetedPrimaryV2.get(m);
      const anySubgroups = targetedAnyV2.get(m);
      const v2Ids =
        role === "primary" && primarySubgroups?.size
          ? [...primarySubgroups]
          : anySubgroups?.size
            ? [...anySubgroups]
            : MUSCLE_TO_V2_GROUPS[m];
      const v2Items = v2Ids
        .map((id) => readinessByV2.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      const loadedV2 = v2Items.filter((item) => item.hasRecentLoad);
      const hasReadinessData = loadedV2.length > 0;
      const readinessPct = hasReadinessData
        ? Math.min(...loadedV2.map((item) => item.readinessPct))
        : 100;

      muscles.push({
        muscle: m,
        name: meta.short,
        role,
        directAdded,
        indirectAdded,
        addedSets,
        beforeSets,
        afterSets,
        mev: meta.mev,
        mavLow: meta.mavLow,
        mavHigh: meta.mavHigh,
        mrv: meta.mrv,
        phaseAfter: assessedAfter.phase,
        phaseLabelAfter: assessedAfter.phaseShort,
        readinessPct,
        hasReadinessData,
      });

      bodyMap[m] = {
        level: role,
        intensity: Math.min(1, role === "primary" ? 0.55 + addedSets / 14 : 0.35),
      };
    }

    muscles.sort((a, b) => {
      if (a.role !== b.role) return a.role === "primary" ? -1 : 1;
      return b.addedSets - a.addedSets;
    });

    const primaryMuscles = muscles.filter((m) => m.role === "primary");
    const targetPool = primaryMuscles.length > 0 ? primaryMuscles : muscles;
    const trackedTargets = targetPool.filter((m) => m.hasReadinessData);
    const hasTargetReadinessData = trackedTargets.length > 0;
    const avgTargetReadinessPct =
      trackedTargets.length > 0
        ? Math.round(trackedTargets.reduce((s, m) => s + m.readinessPct, 0) / trackedTargets.length)
        : 100;
    const worstTarget = trackedTargets
      .filter((m) => m.readinessPct < 75)
      .sort((a, b) => a.readinessPct - b.readinessPct)[0];

    const estMinutes = workingSets > 0 ? Math.max(20, Math.round(workingSets * 2.8)) : 0;
    // Примерная оценка энергозатрат: ~5–6.5 ккал/мин с поправкой на долю базовых и вес тела
    const compoundRatio = workingSets > 0 ? compoundSets / workingSets : 0.5;
    const estKcal =
      estMinutes > 0
        ? Math.round((estMinutes * (4.6 + compoundRatio * 1.9) * (bodyMassKg / 75)) / 10) * 10
        : 0;

    return {
      workingSets,
      exerciseCount: planned.exercises.length,
      estMinutes,
      estKcal,
      compoundSharePct: Math.round(compoundRatio * 100),
      estimatedTonnageKg: Math.round(estimatedTonnageKg),
      tonnageComparison: formatTonnageAnalogy(estimatedTonnageKg),
      axialBeforePct,
      axialAfterPct,
      localBeforePct,
      localAfterPct,
      axialTier,
      axialTierLabel,
      muscles,
      bodyMap,
      lowestTargetReadiness: worstTarget
        ? { name: worstTarget.name, pct: worstTarget.readinessPct }
        : null,
      avgTargetReadinessPct,
      hasTargetReadinessData,
    };
  }
}
