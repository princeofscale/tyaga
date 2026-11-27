import { AnalyticsFacts } from "./AnalyticsFacts";
import {
  ALL_BIOMECH_PROFILES_V3,
  ALL_HYPERTROPHY_REGIONS,
  AUDITED_REGIONS,
  EXERCISE_PROFILES_V3,
  REGION_META,
  type AnatomicalCluster,
  type AuditedHypertrophyRegion,
  type ExerciseBiomechanicalProfile,
  type HypertrophyRegionId,
} from "./BiomechanicsCatalogV3";
import {
  JointGuardEngine,
  STANDARD_GYM_INVENTORY_ADAPTER,
  type GymInventoryAdapter,
  type JointPainLog,
} from "./JointGuardEngine";
import { addCalendarDays, browserTimeZone, localDate } from "../lib/calendar";
import type { Routine, Workout } from "../lib/types";

export interface WeeklyExerciseVolume {
  readonly exerciseId: string;
  readonly sets: number;
}

export interface RegionBlindSpot {
  readonly region: AuditedHypertrophyRegion;
  readonly volume: number;
  readonly threshold: number;
  readonly deficit: number;
  readonly isWeakLinkPriority: boolean;
}

export interface AuditRecommendation {
  readonly type: "joint_safety" | "fill_blind_spot" | "improve_sfr";
  readonly mode: "swap" | "swap_same_cluster" | "split_sets" | "add_sets";
  readonly targetRegion?: AuditedHypertrophyRegion;
  readonly removeExerciseId: string | null;
  readonly addExerciseId: string;
  readonly reason: string;
}

export interface VolumeLandmarksBridge {
  readonly regionFractionalSets: Readonly<Record<HypertrophyRegionId, number>>;
  readonly sessionCapWarningRegions: readonly HypertrophyRegionId[];
  readonly weeklyPlateauRegions: readonly HypertrophyRegionId[];
}

export interface WeakLinkContext {
  readonly priorityRegions: readonly AuditedHypertrophyRegion[];
}

export interface HypertrophyAuditReport {
  readonly totalScore: number;
  readonly regionalCoverageScore: number;
  readonly stretchStimulusShare: number;
  readonly stretchMetricScore: number;
  readonly averageSfr: number;
  readonly sfrScore: number;
  readonly jointSafetyScore: number;
  readonly blindSpots: readonly RegionBlindSpot[];
  readonly recommendations: readonly AuditRecommendation[];
  readonly volumeBridge: VolumeLandmarksBridge;
  readonly totalSets: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Модуль B «Тяга v3» — аудитор региональной гипертрофии, растянутого стимула и SFR.
 * Строго интегрирован с JointGuardEngine (приоритет безопасности) и WeakLinkAnalyzer.
 */
export class HypertrophyAuditEngine {
  private readonly guard: JointGuardEngine;

  constructor(guard: JointGuardEngine = new JointGuardEngine()) {
    this.guard = guard;
  }

  /** Главный детерминированный аудит недельного плана / факта (O(N)). */
  auditWeek(
    weeklySets: readonly WeeklyExerciseVolume[],
    longLevers: boolean,
    painLogs: readonly JointPainLog[],
    nowMs: number,
    inventory: GymInventoryAdapter = STANDARD_GYM_INVENTORY_ADAPTER,
    weakLinks?: WeakLinkContext,
    perSessionMaxSets?: Readonly<Partial<Record<HypertrophyRegionId, number>>>,
  ): HypertrophyAuditReport {
    const regionFractionalSets = {} as Record<HypertrophyRegionId, number>;
    for (const r of ALL_HYPERTROPHY_REGIONS) regionFractionalSets[r] = 0;

    // Объединяем дубликаты одного exerciseId в рамках недели
    const setsByExercise = new Map<string, number>();
    for (const item of weeklySets) {
      if (!Number.isFinite(item.sets) || item.sets <= 0) continue;
      setsByExercise.set(item.exerciseId, (setsByExercise.get(item.exerciseId) ?? 0) + item.sets);
    }

    let totalSets = 0;
    let stretchWeightedSets = 0;
    let sfrWeightedSum = 0;
    let jointPenalty = 0;

    const unsafeItems: Array<{ exerciseId: string; severityRank: number }> = [];

    for (const [exerciseId, sets] of setsByExercise) {
      const profile = EXERCISE_PROFILES_V3[exerciseId];
      if (!profile) continue;

      totalSets += sets;
      const sfr = longLevers ? profile.sfrLongLevers : profile.sfrBase;
      sfrWeightedSum += sets * sfr;

      if (profile.stretchScore === 3) {
        stretchWeightedSets += sets;
      } else if (profile.stretchScore === 2 && profile.resistanceProfile === "lengthened") {
        stretchWeightedSets += sets * 0.5;
      }

      for (const rc of profile.regions) {
        regionFractionalSets[rc.region] = round2(regionFractionalSets[rc.region] + sets * rc.weight);
      }

      const safety = this.guard.evaluateExerciseSafety(exerciseId, painLogs, longLevers, nowMs);
      if (safety.action === "block_swap_required") {
        jointPenalty += 35;
        unsafeItems.push({ exerciseId, severityRank: 2 });
      } else if (safety.action === "swap_recommended") {
        jointPenalty += 15;
        unsafeItems.push({ exerciseId, severityRank: 1 });
      } else if (safety.action === "modify_load_tempo") {
        jointPenalty += 5;
      }
    }

    // 1. Региональное покрытие (RCS, 0..100, вес 0.40)
    const prioritySet = new Set(weakLinks?.priorityRegions ?? []);
    let coverageSum = 0;
    const blindSpots: RegionBlindSpot[] = [];

    for (const region of AUDITED_REGIONS) {
      const meta = REGION_META[region];
      const vol = round1(regionFractionalSets[region]);
      coverageSum += Math.min(1.0, vol / meta.minSets);
      if (vol < meta.minSets) {
        blindSpots.push({
          region,
          volume: vol,
          threshold: meta.minSets,
          deficit: round1(meta.minSets - vol),
          isWeakLinkPriority: prioritySet.has(region),
        });
      }
    }

    blindSpots.sort((a, b) => {
      const scoreA = a.deficit / a.threshold + (a.isWeakLinkPriority ? 0.15 : 0);
      const scoreB = b.deficit / b.threshold + (b.isWeakLinkPriority ? 0.15 : 0);
      return scoreB - scoreA || a.region.localeCompare(b.region);
    });

    const regionalCoverageScore = totalSets > 0 ? round1((100 / AUDITED_REGIONS.length) * coverageSum) : 0;

    // 2. Доля стимула в растянутой позиции (45..70% = 100 б., вес 0.20)
    const stretchStimulusShare = totalSets > 0 ? round1((100 * stretchWeightedSets) / totalSets) : 0;
    let stretchMetricScore = 0;
    if (totalSets > 0) {
      if (stretchStimulusShare >= 45 && stretchStimulusShare <= 70) {
        stretchMetricScore = 100;
      } else if (stretchStimulusShare < 45) {
        stretchMetricScore = round1(Math.max(0, 100 - 2.5 * (45 - stretchStimulusShare)));
      } else {
        stretchMetricScore = round1(Math.max(75, 100 - 1.2 * (stretchStimulusShare - 70)));
      }
    }

    // 3. Средний SFR (вес 0.25)
    const averageSfr = totalSets > 0 ? round2(sfrWeightedSum / totalSets) : 0;
    const sfrScore = totalSets > 0 ? round1(Math.min(100, (averageSfr / 8.5) * 100)) : 0;

    // 4. Индекс суставной безопасности (JSS, вес 0.15)
    const jointSafetyScore = round1(Math.max(0, 100 - jointPenalty));

    const totalScore =
      totalSets > 0
        ? round1(
            0.4 * regionalCoverageScore +
              0.2 * stretchMetricScore +
              0.25 * sfrScore +
              0.15 * jointSafetyScore,
          )
        : 0;

    // Генерация Топ-3 рекомендаций в строгой иерархии приоритетов
    const recommendations: AuditRecommendation[] = [];
    const addedSet = new Set<string>();
    const removedSet = new Set<string>();

    // Приоритет 1: joint_safety
    unsafeItems.sort((a, b) => b.severityRank - a.severityRank || a.exerciseId.localeCompare(b.exerciseId));
    for (const item of unsafeItems) {
      if (recommendations.length >= 3) break;
      const swaps = this.guard.recommendSwap(item.exerciseId, 0, painLogs, longLevers, nowMs, inventory, 3);
      const best = swaps.find((s) => !addedSet.has(s.targetExerciseId));
      if (!best) continue; // Нет безопасной замены -> слот удаляется, небезопасный кандидат не предлагается
      addedSet.add(best.targetExerciseId);
      removedSet.add(item.exerciseId);
      recommendations.push({
        type: "joint_safety",
        mode: "swap",
        removeExerciseId: item.exerciseId,
        addExerciseId: best.targetExerciseId,
        reason: `Безопасная замена для защиты суставов (SFR ${best.sfr.toFixed(1)}).`,
      });
    }

    // Приоритет 2: fill_blind_spot (строго через фильтр JointGuard)
    for (const spot of blindSpots) {
      if (recommendations.length >= 3) break;
      const candidate = this.pickBestSafeRegionCandidate(
        spot.region,
        setsByExercise,
        addedSet,
        longLevers,
        painLogs,
        nowMs,
        inventory,
      );
      if (!candidate) continue;

      const cluster = REGION_META[spot.region].cluster;
      const donor = this.findClusterDonor(
        cluster,
        candidate,
        setsByExercise,
        removedSet,
        regionFractionalSets,
      );

      addedSet.add(candidate.id);
      if (donor) {
        removedSet.add(donor.exerciseId);
        recommendations.push({
          type: "fill_blind_spot",
          mode: donor.mode,
          targetRegion: spot.region,
          removeExerciseId: donor.mode === "swap_same_cluster" ? donor.exerciseId : null,
          addExerciseId: candidate.id,
          reason:
            donor.mode === "swap_same_cluster"
              ? `Заменяет дублирующее движение в кластере и закрывает слепую зону «${REGION_META[spot.region].label}».`
              : `Расщепляет избыточный объём и закрывает «${REGION_META[spot.region].label}».`,
        });
      } else {
        recommendations.push({
          type: "fill_blind_spot",
          mode: "add_sets",
          targetRegion: spot.region,
          removeExerciseId: null,
          addExerciseId: candidate.id,
          reason: `Закрывает слепую зону «${REGION_META[spot.region].label}» (${spot.volume}/${spot.threshold} экв. подх.).`,
        });
      }
    }

    // Приоритет 3: improve_sfr (только при longLevers = true и среднем SFR < 6.8)
    if (recommendations.length < 3 && longLevers && totalSets > 0 && averageSfr < 6.8) {
      const lowSfrList = [...setsByExercise.keys()]
        .filter((id) => !removedSet.has(id))
        .map((id) => EXERCISE_PROFILES_V3[id])
        .filter((p): p is ExerciseBiomechanicalProfile => Boolean(p && p.sfrLongLevers < 5.0))
        .sort((a, b) => a.sfrLongLevers - b.sfrLongLevers || a.id.localeCompare(b.id));

      for (const low of lowSfrList) {
        if (recommendations.length >= 3) break;
        const swaps = this.guard.recommendSwap(low.id, 0, painLogs, longLevers, nowMs, inventory, 5);
        const upgrade = swaps.find(
          (s) => s.sfr - low.sfrLongLevers >= 1.5 && !addedSet.has(s.targetExerciseId),
        );
        if (!upgrade) continue;
        addedSet.add(upgrade.targetExerciseId);
        removedSet.add(low.id);
        recommendations.push({
          type: "improve_sfr",
          mode: "swap",
          removeExerciseId: low.id,
          addExerciseId: upgrade.targetExerciseId,
          reason: `Повышает SFR длиннорычажного профиля с ${low.sfrLongLevers.toFixed(1)} до ${upgrade.sfr.toFixed(1)} и разгружает ЦНС.`,
        });
      }
    }

    // VolumeLandmarksBridge (Pelland/Remmert плато >11/сессию и >31/неделю)
    const weeklyPlateauRegions = ALL_HYPERTROPHY_REGIONS.filter((r) => regionFractionalSets[r] > 31);
    const sessionCapWarningRegions = perSessionMaxSets
      ? ALL_HYPERTROPHY_REGIONS.filter((r) => (perSessionMaxSets[r] ?? 0) > 11)
      : [];

    return {
      totalScore,
      regionalCoverageScore,
      stretchStimulusShare,
      stretchMetricScore,
      averageSfr,
      sfrScore,
      jointSafetyScore,
      blindSpots,
      recommendations,
      volumeBridge: {
        regionFractionalSets,
        sessionCapWarningRegions,
        weeklyPlateauRegions,
      },
      totalSets,
    };
  }

  /** Удобный аудит фактической скользящей 7-дневной истории тренировок пользователя. */
  auditWorkouts(
    workouts: readonly Workout[],
    options: {
      today?: string;
      timeZone?: string;
      longLevers?: boolean;
      painLogs?: readonly JointPainLog[];
      now?: Date;
      inventory?: GymInventoryAdapter;
      weakLinks?: WeakLinkContext;
    } = {},
  ): HypertrophyAuditReport {
    const now = options.now ?? new Date();
    const tz = options.timeZone ?? browserTimeZone();
    const today = options.today ?? localDate(now, tz);
    const from = addCalendarDays(today, -6);

    const weekWorkouts = new AnalyticsFacts([...workouts], {
      from,
      through: today,
      now,
      timeZone: tz,
    }).workouts();

    const weeklyMap = new Map<string, number>();
    const sessionMax: Partial<Record<HypertrophyRegionId, number>> = {};

    for (const w of weekWorkouts) {
      const sessionRegions: Partial<Record<HypertrophyRegionId, number>> = {};
      for (const e of w.exercises) {
        const working = e.sets.filter((s) => s.done && !s.warmup).length;
        if (working <= 0) continue;
        weeklyMap.set(e.exerciseId, (weeklyMap.get(e.exerciseId) ?? 0) + working);
        const prof = EXERCISE_PROFILES_V3[e.exerciseId];
        if (prof) {
          for (const rc of prof.regions) {
            sessionRegions[rc.region] = (sessionRegions[rc.region] ?? 0) + working * rc.weight;
          }
        }
      }
      for (const [r, val] of Object.entries(sessionRegions) as Array<[HypertrophyRegionId, number]>) {
        if (val > (sessionMax[r] ?? 0)) sessionMax[r] = val;
      }
    }

    const weeklySets: WeeklyExerciseVolume[] = [...weeklyMap.entries()].map(([exerciseId, sets]) => ({
      exerciseId,
      sets,
    }));

    return this.auditWeek(
      weeklySets,
      options.longLevers === true,
      options.painLogs ?? [],
      now.getTime(),
      options.inventory ?? STANDARD_GYM_INVENTORY_ADAPTER,
      options.weakLinks,
      sessionMax,
    );
  }

  /** Удобный аудит плановой программы (массива Routine). */
  auditRoutines(
    routines: readonly Routine[],
    options: {
      longLevers?: boolean;
      painLogs?: readonly JointPainLog[];
      nowMs?: number;
      inventory?: GymInventoryAdapter;
      weakLinks?: WeakLinkContext;
    } = {},
  ): HypertrophyAuditReport {
    const weeklyMap = new Map<string, number>();
    for (const r of routines) {
      for (const ex of r.exercises) {
        const working = ex.sets.filter((s) => !s.warmup).length;
        const sets = Math.max(1, working || ex.sets.length || 3);
        weeklyMap.set(ex.exerciseId, (weeklyMap.get(ex.exerciseId) ?? 0) + sets);
      }
    }
    const weeklySets: WeeklyExerciseVolume[] = [...weeklyMap.entries()].map(([exerciseId, sets]) => ({
      exerciseId,
      sets,
    }));
    return this.auditWeek(
      weeklySets,
      options.longLevers === true,
      options.painLogs ?? [],
      options.nowMs ?? Date.now(),
      options.inventory ?? STANDARD_GYM_INVENTORY_ADAPTER,
      options.weakLinks,
    );
  }

  private pickBestSafeRegionCandidate(
    region: AuditedHypertrophyRegion,
    existing: ReadonlyMap<string, number>,
    alreadyAdded: ReadonlySet<string>,
    longLevers: boolean,
    painLogs: readonly JointPainLog[],
    nowMs: number,
    inventory: GymInventoryAdapter,
  ): ExerciseBiomechanicalProfile | null {
    const eligible: ExerciseBiomechanicalProfile[] = [];
    for (const prof of ALL_BIOMECH_PROFILES_V3) {
      if (existing.has(prof.id) || alreadyAdded.has(prof.id)) continue;
      if (inventory.hasExerciseEquipment && !inventory.hasExerciseEquipment(prof.id)) continue;
      const isPrimary = prof.regions.some((r) => r.region === region && r.weight === 1.0);
      if (!isPrimary) continue;
      const evalRes = this.guard.evaluateExerciseSafety(prof.id, painLogs, longLevers, nowMs);
      if (evalRes.action !== "allow" && evalRes.action !== "modify_load_tempo") continue;
      eligible.push(prof);
    }
    if (!eligible.length) return null;
    eligible.sort((a, b) => {
      const sfrA = longLevers ? a.sfrLongLevers : a.sfrBase;
      const sfrB = longLevers ? b.sfrLongLevers : b.sfrBase;
      return sfrB - sfrA || b.stretchScore - a.stretchScore || a.id.localeCompare(b.id);
    });
    return eligible[0];
  }

  private findClusterDonor(
    cluster: AnatomicalCluster,
    candidate: ExerciseBiomechanicalProfile,
    setsByExercise: ReadonlyMap<string, number>,
    removedSet: ReadonlySet<string>,
    currentVolumes: Readonly<Record<HypertrophyRegionId, number>>,
  ): { exerciseId: string; mode: "swap_same_cluster" | "split_sets" } | null {
    const candMap = new Map(candidate.regions.map((r) => [r.region, r.weight]));
    const clusterExercises: Array<{ id: string; sets: number; prof: ExerciseBiomechanicalProfile }> = [];

    for (const [id, sets] of setsByExercise) {
      if (removedSet.has(id)) continue;
      const prof = EXERCISE_PROFILES_V3[id];
      if (!prof) continue;
      const primary = prof.regions.find((r) => r.weight === 1.0);
      if (!primary || REGION_META[primary.region].cluster !== cluster) continue;
      clusterExercises.push({ id, sets, prof });
    }

    // 1. Проверяем чистую замену в кластере без создания новых слепых зон (например calf-seated -> calf-legpress)
    for (const ex of clusterExercises) {
      let createsBlindSpot = false;
      for (const rc of ex.prof.regions) {
        const meta = REGION_META[rc.region];
        if (!meta.audited) continue;
        const lost = ex.sets * rc.weight;
        const gained = ex.sets * (candMap.get(rc.region) ?? 0);
        const after = currentVolumes[rc.region] - lost + gained;
        if (currentVolumes[rc.region] >= meta.minSets && after < meta.minSets) {
          createsBlindSpot = true;
          break;
        }
      }
      if (!createsBlindSpot) {
        return { exerciseId: ex.id, mode: "swap_same_cluster" };
      }
    }

    // 2. Расщепление избыточного объёма (>=5 сетов) внутри кластера
    const heavy = clusterExercises
      .filter((e) => e.sets >= 5)
      .sort((a, b) => b.sets - a.sets || a.id.localeCompare(b.id))[0];
    if (heavy) {
      return { exerciseId: heavy.id, mode: "split_sets" };
    }

    return null;
  }
}
