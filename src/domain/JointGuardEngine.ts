import {
  ALL_BIOMECH_PROFILES_V3,
  COMPATIBLE_FAMILIES,
  EXERCISE_PROFILES_V3,
  JOINT_ZONES,
  TRANSFER_RATIOS,
  type ExerciseBiomechanicalProfile,
  type JointRiskLevel,
  type JointZone,
  type LoadModeV3,
  type PainSeverity,
} from "./BiomechanicsCatalogV3";
import { exerciseById } from "../lib/catalog";

export type SafetyAction =
  | "allow"
  | "modify_load_tempo"
  | "swap_recommended"
  | "block_swap_required";

export type OptionalWarmupProtocolId =
  | "mcgill_big_3"
  | "iso_patellar_5x45"
  | "subthreshold_elbow_iso"
  | "scapular_er_iso";

export interface WarmupProtocolInfo {
  readonly id: OptionalWarmupProtocolId;
  readonly zone: JointZone;
  readonly title: string;
  readonly prescription: string;
  readonly note: string;
}

export const OPTIONAL_WARMUP_PROTOCOLS: Readonly<Record<OptionalWarmupProtocolId, WarmupProtocolInfo>> = {
  mcgill_big_3: {
    id: "mcgill_big_3",
    zone: "lumbar",
    title: "Большая тройка Макгилла",
    prescription: "Curl-up · Side Bridge · Bird Dog · удержания по 10 с, пирамида 5–3–1",
    note: "Формирует жёсткость корсета в нейтральной пояснице без сгибания позвоночника.",
  },
  iso_patellar_5x45: {
    id: "iso_patellar_5x45",
    zone: "knee_patellar",
    title: "Изометрия колена (60°)",
    prescription: "5×45 с в разгибании ног / стульчике у стены (~60–70% усилия), отдых 90 с",
    note: "Опциональная разминка (Rio 2015 / Holden 2020): оцени реакцию на следующее утро.",
  },
  subthreshold_elbow_iso: {
    id: "subthreshold_elbow_iso",
    zone: "elbow",
    title: "Субпороговая изометрия локтя",
    prescription: "3–4×30 с лёгкое удержание ниже порога боли (RPE 4–5)",
    note: "Не превышай порог боли (Coombes 2016: тяжёлая изометрия может усилить дискомфорт).",
  },
  scapular_er_iso: {
    id: "scapular_er_iso",
    zone: "shoulder_anterior",
    title: "Наружная ротация и лопатки",
    prescription: "3×25 с мягкая изометрия наружной ротации у блока/резины + скольжения по стене",
    note: "Опциональная активация вращательной манжеты перед жимами с контролем через 24 ч.",
  },
};

export interface JointPainLog {
  readonly zone: JointZone;
  readonly severity: PainSeverity;
  readonly timestamp: number;
  readonly isAcuteNightOrRadiating?: boolean;
  readonly exerciseId?: string;
}

export interface TriggeredZoneDetail {
  readonly zone: JointZone;
  readonly severity: PainSeverity;
  readonly effectiveRisk: JointRiskLevel;
  readonly action: SafetyAction;
}

export interface ExerciseSafetyEvaluation {
  readonly exerciseId: string;
  readonly action: SafetyAction;
  readonly triggeredZones: readonly TriggeredZoneDetail[];
  readonly loadMultiplier: number;
  readonly repRangeShift: readonly [number, number] | null;
  readonly targetRirFloor: number | null;
  readonly tempoPrescription: string | null;
  readonly requiresMedicalReferralBanner: boolean;
  readonly optionalWarmupProtocol?: OptionalWarmupProtocolId;
}

export interface GymInventoryAdapter {
  roundWeight(rawKg: number, loadMode: LoadModeV3): number;
  hasExerciseEquipment?(exerciseId: string): boolean;
}

export interface SwapRecommendation {
  readonly targetExerciseId: string;
  readonly score: number;
  readonly regionOverlap: number;
  readonly sfr: number;
  readonly safetyAction: "allow" | "modify_load_tempo";
  readonly transferRatio: number;
  readonly painDiscount: 1.0 | 0.9 | 0.85;
  readonly rawWeightKg: number;
  readonly estimatedWorkingWeightKg: number;
  readonly targetLoadMode: LoadModeV3;
  readonly targetRepRange: readonly [number, number];
  readonly targetRirFloor: number;
  readonly tempoPrescription: string;
}

export interface DeloadS5PainSignal {
  readonly painFlagsCount: number;
  readonly corePainRepeated: boolean;
}

export type ReturnToLiftPhase =
  | "acute_swap"
  | "test_reload_70"
  | "ramp_80"
  | "ramp_90"
  | "cleared";

export interface ReturnToLiftState {
  readonly exerciseId: string;
  readonly zone: JointZone;
  readonly phase: ReturnToLiftPhase;
  readonly loadPct: 0.0 | 0.7 | 0.8 | 0.9 | 1.0;
  readonly daysSymptomFree: number;
  readonly consecutiveRelapses: number;
}

export type ReturnToLiftDecision =
  | "hold_acute"
  | "advance_to_test"
  | "progress"
  | "hold_repeat_step"
  | "regress_one_step"
  | "reset_acute_14d";

export interface ReturnToLiftTransition {
  readonly nextState: ReturnToLiftState;
  readonly decision: ReturnToLiftDecision;
}

export const STANDARD_GYM_INVENTORY_ADAPTER: GymInventoryAdapter = {
  roundWeight(rawKg: number, loadMode: LoadModeV3): number {
    if (!Number.isFinite(rawKg) || rawKg <= 0) return 0;
    const step = loadMode === "per_implement" ? 2.0 : 2.5;
    return Math.round(rawKg / step) * step;
  },
};

const MS_PER_DAY = 86_400_000;
const WINDOW_14D_MS = 14 * MS_PER_DAY;

const ACTION_BY_LEVEL: readonly SafetyAction[] = [
  "allow",
  "modify_load_tempo",
  "swap_recommended",
  "block_swap_required",
];

const LEVEL_BY_ACTION: Readonly<Record<SafetyAction, 0 | 1 | 2 | 3>> = {
  allow: 0,
  modify_load_tempo: 1,
  swap_recommended: 2,
  block_swap_required: 3,
};

const DECISION_MATRIX: ReadonlyArray<readonly [0 | 1 | 2 | 3, 0 | 1 | 2 | 3, 0 | 1 | 2 | 3, 0 | 1 | 2 | 3]> = [
  [0, 0, 0, 0], // severity 0
  [0, 0, 1, 2], // severity 1 (Green 1-3/10)
  [0, 1, 2, 3], // severity 2 (Amber 4-5/10 or >24h)
  [0, 3, 3, 3], // severity 3 (Red 6-10/10 or Red Flag)
];

const WARMUP_BY_ZONE: Partial<Record<JointZone, OptionalWarmupProtocolId>> = {
  lumbar: "mcgill_big_3",
  knee_patellar: "iso_patellar_5x45",
  elbow: "subthreshold_elbow_iso",
  shoulder_anterior: "scapular_er_iso",
};

const RTL_PHASE_LOAD: Readonly<Record<ReturnToLiftPhase, 0.0 | 0.7 | 0.8 | 0.9 | 1.0>> = {
  acute_swap: 0.0,
  test_reload_70: 0.7,
  ramp_80: 0.8,
  ramp_90: 0.9,
  cleared: 1.0,
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Модуль A «Тяга v3» — клинико-биомеханический регулятор суставной безопасности.
 * Pure OOP class, O(N) по числу логов боли, 0 побочных эффектов.
 */
export class JointGuardEngine {
  /** Эффективная тяжесть лога боли с безусловным приоритетом красного флага. */
  static effectiveSeverity(log: JointPainLog): PainSeverity {
    return log.isAcuteNightOrRadiating ? 3 : log.severity;
  }

  /** Карта актуальной тяжести по 5 суставным зонам за 14-дневное окно (последний чек-ин зоны; при равном timestamp — максимум). */
  static activeZoneSeverities(
    painLogs: readonly JointPainLog[],
    nowMs: number,
  ): Record<JointZone, PainSeverity> {
    const map: Record<JointZone, PainSeverity> = {
      lumbar: 0,
      shoulder_anterior: 0,
      elbow: 0,
      knee_patellar: 0,
      wrist: 0,
    };
    const latestTs: Record<JointZone, number> = {
      lumbar: -Infinity,
      shoulder_anterior: -Infinity,
      elbow: -Infinity,
      knee_patellar: -Infinity,
      wrist: -Infinity,
    };
    for (const log of painLogs) {
      const age = nowMs - log.timestamp;
      if (age < 0 || age > WINDOW_14D_MS) continue;
      const eff = JointGuardEngine.effectiveSeverity(log);
      if (log.timestamp > latestTs[log.zone]) {
        latestTs[log.zone] = log.timestamp;
        map[log.zone] = eff;
      } else if (log.timestamp === latestTs[log.zone] && eff > map[log.zone]) {
        map[log.zone] = eff;
      }
    }
    return map;
  }

  /** Взвешенный индекс Жаккара пересечения гипертрофических регионов двух упражнений. */
  static regionOverlap(a: ExerciseBiomechanicalProfile, b: ExerciseBiomechanicalProfile): number {
    const mapA = new Map(a.regions.map((r) => [r.region, r.weight]));
    const mapB = new Map(b.regions.map((r) => [r.region, r.weight]));
    const keys = new Set([...mapA.keys(), ...mapB.keys()]);
    let minSum = 0;
    let maxSum = 0;
    for (const k of keys) {
      const wa = mapA.get(k) ?? 0;
      const wb = mapB.get(k) ?? 0;
      minSum += Math.min(wa, wb);
      maxSum += Math.max(wa, wb);
    }
    return maxSum > 0 ? minSum / maxSum : 0;
  }

  /** Проверяет безопасность конкретного упражнения с учётом longLevers и осевой эскалации поясницы. */
  evaluateExerciseSafety(
    exerciseId: string,
    painLogs: readonly JointPainLog[],
    longLevers: boolean,
    nowMs: number,
  ): ExerciseSafetyEvaluation {
    const profile = EXERCISE_PROFILES_V3[exerciseId];
    const active = JointGuardEngine.activeZoneSeverities(painLogs, nowMs);
    const hasRedBanner = JOINT_ZONES.some((z) => active[z] === 3);

    if (!profile) {
      return {
        exerciseId,
        action: "allow",
        triggeredZones: [],
        loadMultiplier: 1.0,
        repRangeShift: null,
        targetRirFloor: null,
        tempoPrescription: null,
        requiresMedicalReferralBanner: hasRedBanner,
      };
    }

    let maxLevel: 0 | 1 | 2 | 3 = 0;
    let maxTriggeredSev: PainSeverity = 0;
    const triggeredZones: TriggeredZoneDetail[] = [];

    for (const zone of JOINT_ZONES) {
      const sev = active[zone];
      if (sev === 0) continue;
      const baseRisk = profile.risk[zone];
      const delta = longLevers ? profile.longLeverRiskDelta[zone] : 0;
      const effectiveRisk = Math.min(3, baseRisk + delta) as JointRiskLevel;
      let level = DECISION_MATRIX[sev][effectiveRisk];

      // Правило осевой эскалации поясницы (Axial Lumbar Escalation)
      if (
        zone === "lumbar" &&
        sev >= 1 &&
        profile.axialLoadMultiplier >= 1.5 &&
        baseRisk >= 2
      ) {
        level = Math.min(3, level + 1) as 0 | 1 | 2 | 3;
      }

      if (level > 0) {
        triggeredZones.push({
          zone,
          severity: sev,
          effectiveRisk,
          action: ACTION_BY_LEVEL[level],
        });
        if (level > maxLevel) maxLevel = level;
        if (sev > maxTriggeredSev) maxTriggeredSev = sev;
      }
    }

    const action = ACTION_BY_LEVEL[maxLevel];
    let loadMultiplier = 1.0;
    let repRangeShift: readonly [number, number] | null = null;
    let targetRirFloor: number | null = null;
    let tempoPrescription: string | null = null;

    if (action === "modify_load_tempo") {
      loadMultiplier = maxTriggeredSev >= 2 ? 0.8 : 0.85;
      repRangeShift = [10, 15];
      targetRirFloor = maxTriggeredSev >= 2 ? 3 : 2;
      tempoPrescription = "3-1-1-0";
    } else if (action === "swap_recommended") {
      loadMultiplier = maxTriggeredSev >= 2 ? 0.75 : 0.85;
      repRangeShift = [8, 15];
      targetRirFloor = maxTriggeredSev >= 2 ? 3 : 2;
      tempoPrescription = "3-1-1-0";
    } else if (action === "block_swap_required") {
      loadMultiplier = 0.0;
      repRangeShift = [10, 15];
      targetRirFloor = 3;
      tempoPrescription = "3-1-1-0";
    }

    // Опциональная разминка для наиболее приоритетной сработавшей зоны (только при sev 1..2)
    let optionalWarmupProtocol: OptionalWarmupProtocolId | undefined;
    const warmupZone = triggeredZones
      .filter((t) => t.severity === 1 || t.severity === 2)
      .sort((a, b) => LEVEL_BY_ACTION[b.action] - LEVEL_BY_ACTION[a.action])[0]?.zone;
    if (warmupZone) {
      optionalWarmupProtocol = WARMUP_BY_ZONE[warmupZone];
    }

    return {
      exerciseId,
      action,
      triggeredZones,
      loadMultiplier,
      repRangeShift,
      targetRirFloor,
      tempoPrescription,
      requiresMedicalReferralBanner: hasRedBanner,
      ...(optionalWarmupProtocol ? { optionalWarmupProtocol } : {}),
    };
  }

  /** Подбирает до topK биомеханически безопасных замен с пересчётом веса под GymInventory. */
  recommendSwap(
    sourceExerciseId: string,
    sourceWorkingWeightKg: number,
    painLogs: readonly JointPainLog[],
    longLevers: boolean,
    nowMs: number,
    inventory: GymInventoryAdapter = STANDARD_GYM_INVENTORY_ADAPTER,
    topK = 3,
  ): readonly SwapRecommendation[] {
    const source = EXERCISE_PROFILES_V3[sourceExerciseId];
    if (!source) return [];

    const active = JointGuardEngine.activeZoneSeverities(painLogs, nowMs);
    const maxActiveSev = Math.max(0, ...JOINT_ZONES.map((z) => active[z])) as PainSeverity;
    const painDiscount: 1.0 | 0.9 | 0.85 =
      maxActiveSev === 0 ? 1.0 : maxActiveSev === 1 ? 0.9 : 0.85;

    const compatible = new Set(COMPATIBLE_FAMILIES[source.family]);
    const primaryRegions = new Set(
      source.regions.filter((r) => r.weight === 1.0).map((r) => r.region),
    );

    const candidates: SwapRecommendation[] = [];

    for (const cand of ALL_BIOMECH_PROFILES_V3) {
      if (cand.id === source.id) continue;
      if (!compatible.has(cand.family)) continue;
      if (inventory.hasExerciseEquipment && !inventory.hasExerciseEquipment(cand.id)) continue;

      const hasPrimaryOverlap = cand.regions.some((r) => primaryRegions.has(r.region));
      if (!hasPrimaryOverlap) continue;

      const evalCand = this.evaluateExerciseSafety(cand.id, painLogs, longLevers, nowMs);
      if (evalCand.action === "swap_recommended" || evalCand.action === "block_swap_required") {
        continue;
      }

      const overlap = JointGuardEngine.regionOverlap(source, cand);
      const sfr = longLevers ? cand.sfrLongLevers : cand.sfrBase;
      const famBonus = cand.family === source.family ? 0.08 : 0;

      let pRes = evalCand.action === "modify_load_tempo" ? 0.15 : 0;
      for (const z of JOINT_ZONES) {
        const sev = active[z];
        if (sev <= 0) continue;
        const rEff = Math.min(3, cand.risk[z] + (longLevers ? cand.longLeverRiskDelta[z] : 0));
        pRes += 0.12 * rEff * sev;
      }

      const bwPenalty = cand.isBodyweight && !source.isBodyweight ? 0.15 : 0;
      const rawScore =
        0.45 * overlap +
        0.3 * (sfr / 10) +
        0.25 * (cand.stretchScore / 3) +
        famBonus -
        pRes -
        bwPenalty;

      const transferRatio = JointGuardEngine.lookupTransferRatio(source, cand);
      const cleanSourceW = Math.max(0, Number.isFinite(sourceWorkingWeightKg) ? sourceWorkingWeightKg : 0);
      const srcDef = exerciseById(source.id);
      const candDef = exerciseById(cand.id);
      const zeroExternalTarget =
        cand.isBodyweight ||
        (candDef?.recording.loadMode === "added_bodyweight" && srcDef?.recording.loadMode !== "added_bodyweight");
      const rawWeightKg = zeroExternalTarget ? 0 : round2(cleanSourceW * transferRatio * painDiscount);
      const estimatedWorkingWeightKg = zeroExternalTarget
        ? 0
        : inventory.roundWeight(rawWeightKg, cand.loadMode);

      candidates.push({
        targetExerciseId: cand.id,
        score: round4(rawScore),
        regionOverlap: round4(overlap),
        sfr,
        safetyAction: evalCand.action,
        transferRatio,
        painDiscount,
        rawWeightKg,
        estimatedWorkingWeightKg,
        targetLoadMode: cand.loadMode,
        targetRepRange: evalCand.repRangeShift ?? [8, 12],
        targetRirFloor: evalCand.targetRirFloor ?? 2,
        tempoPrescription: evalCand.tempoPrescription ?? "3-1-1-0",
      });
    }

    candidates.sort((a, b) => b.score - a.score || a.targetExerciseId.localeCompare(b.targetExerciseId));
    return candidates.slice(0, Math.max(0, topK));
  }

  /** Вычисляет сигнал S5_pain для DeloadEngine.evaluateV2 с 14-дневным окном и 24ч дедупликацией. */
  evaluateDeloadS5(painLogs: readonly JointPainLog[], nowMs: number): DeloadS5PainSignal {
    const activeZones = new Set<JointZone>();
    const moderateTimestamps = new Map<JointZone, number[]>();
    let hasRed = false;

    for (const log of painLogs) {
      const age = nowMs - log.timestamp;
      if (age < 0 || age > WINDOW_14D_MS) continue;
      const eff = JointGuardEngine.effectiveSeverity(log);
      if (eff >= 1) activeZones.add(log.zone);
      if (eff >= 3) hasRed = true;
      if (eff >= 2) {
        const list = moderateTimestamps.get(log.zone) ?? [];
        list.push(log.timestamp);
        moderateTimestamps.set(log.zone, list);
      }
    }

    let corePainRepeated = hasRed;
    if (!corePainRepeated) {
      for (const [zone, stamps] of moderateTimestamps) {
        stamps.sort((a, b) => a - b);
        let distinctEpisodes = 0;
        let lastEpisodeTs = -Infinity;
        for (const ts of stamps) {
          if (ts - lastEpisodeTs >= MS_PER_DAY) {
            distinctEpisodes++;
            lastEpisodeTs = ts;
          }
        }
        if ((zone === "lumbar" || zone === "knee_patellar") && distinctEpisodes >= 2) {
          corePainRepeated = true;
          break;
        }
        if ((zone === "shoulder_anterior" || zone === "elbow") && distinctEpisodes >= 3) {
          corePainRepeated = true;
          break;
        }
      }
    }

    return {
      painFlagsCount: activeZones.size,
      corePainRepeated,
    };
  }

  /** 5-фазный конечный автомат возврата к базовому упражнению (Return-to-Lift FSM). */
  stepReturnToLift(
    state: ReturnToLiftState,
    morningPainNrs: number,
    painIncreasing: boolean,
    daysSymptomFreeDelta = 1,
  ): ReturnToLiftTransition {
    const nrs = Math.max(0, Math.min(10, Math.round(morningPainNrs)));

    if (state.phase === "acute_swap") {
      if (nrs === 0 && !painIncreasing) {
        const nextDays = state.daysSymptomFree + Math.max(0, daysSymptomFreeDelta);
        if (nextDays >= 7) {
          return {
            decision: "advance_to_test",
            nextState: {
              ...state,
              phase: "test_reload_70",
              loadPct: RTL_PHASE_LOAD.test_reload_70,
              daysSymptomFree: nextDays,
              consecutiveRelapses: 0,
            },
          };
        }
        return {
          decision: "hold_acute",
          nextState: {
            ...state,
            daysSymptomFree: nextDays,
          },
        };
      }
      return {
        decision: "hold_acute",
        nextState: {
          ...state,
          daysSymptomFree: nrs > 0 ? Math.min(0, state.daysSymptomFree) : state.daysSymptomFree,
        },
      };
    }

    if (state.phase === "cleared") {
      if (nrs >= 7) {
        return {
          decision: "reset_acute_14d",
          nextState: {
            ...state,
            phase: "acute_swap",
            loadPct: 0.0,
            daysSymptomFree: -7,
            consecutiveRelapses: state.consecutiveRelapses + 1,
          },
        };
      }
      return { decision: "hold_repeat_step", nextState: state };
    }

    // Активные фазы: test_reload_70, ramp_80, ramp_90
    if (nrs <= 2 && !painIncreasing) {
      const nextPhase: ReturnToLiftPhase =
        state.phase === "test_reload_70"
          ? "ramp_80"
          : state.phase === "ramp_80"
            ? "ramp_90"
            : "cleared";
      return {
        decision: "progress",
        nextState: {
          ...state,
          phase: nextPhase,
          loadPct: RTL_PHASE_LOAD[nextPhase],
          consecutiveRelapses: 0,
        },
      };
    }

    if (nrs === 3 && !painIncreasing) {
      return {
        decision: "hold_repeat_step",
        nextState: { ...state },
      };
    }

    // Рецидив: nrs >= 4 ИЛИ painIncreasing
    const nextRelapses = state.consecutiveRelapses + 1;
    if (nextRelapses >= 2 || nrs >= 7) {
      return {
        decision: "reset_acute_14d",
        nextState: {
          ...state,
          phase: "acute_swap",
          loadPct: 0.0,
          daysSymptomFree: -7,
          consecutiveRelapses: nextRelapses,
        },
      };
    }

    const prevPhase: ReturnToLiftPhase =
      state.phase === "ramp_90"
        ? "ramp_80"
        : state.phase === "ramp_80"
          ? "test_reload_70"
          : "acute_swap";

    return {
      decision: "regress_one_step",
      nextState: {
        ...state,
        phase: prevPhase,
        loadPct: RTL_PHASE_LOAD[prevPhase],
        daysSymptomFree: 0,
        consecutiveRelapses: nextRelapses,
      },
    };
  }

  private static lookupTransferRatio(
    source: ExerciseBiomechanicalProfile,
    target: ExerciseBiomechanicalProfile,
  ): number {
    const direct = TRANSFER_RATIOS[`${source.id}->${target.id}`];
    if (direct !== undefined) return direct;
    const srcImpl = exerciseById(source.id)?.recording.implementCount;
    const tgtImpl = exerciseById(target.id)?.recording.implementCount;
    if (source.loadMode === "total_external" && target.loadMode === "per_implement") {
      return tgtImpl === 1 ? 0.75 : 0.38;
    }
    if (source.loadMode === "per_implement" && target.loadMode === "total_external") {
      return srcImpl === 1 ? 0.85 : 2.1;
    }
    return 0.8;
  }
}

// ============================================================================
// Локальное хранилище логов боли (JointPainStore) для синхронизации UI и SmartCoach v2
// ============================================================================

const PAIN_STORAGE_KEY = "tyaga-joint-pain-logs-v3";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export class JointPainStore {
  static key(accountId?: string): string {
    return accountId ? `${PAIN_STORAGE_KEY}:${accountId}` : PAIN_STORAGE_KEY;
  }

  static read(
    storage: StorageLike | null = defaultStorage(),
    nowMs = Date.now(),
    accountId?: string,
  ): JointPainLog[] {
    if (!storage) return [];
    try {
      const raw = storage.getItem(JointPainStore.key(accountId));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const validZones = new Set<string>(JOINT_ZONES);
      return parsed
        .filter((item): item is JointPainLog => {
          if (!item || typeof item !== "object") return false;
          const x = item as Record<string, unknown>;
          return (
            typeof x.zone === "string" &&
            validZones.has(x.zone) &&
            (x.severity === 0 || x.severity === 1 || x.severity === 2 || x.severity === 3) &&
            typeof x.timestamp === "number" &&
            Number.isFinite(x.timestamp) &&
            nowMs - x.timestamp <= 30 * MS_PER_DAY
          );
        })
        .slice(-60);
    } catch {
      return [];
    }
  }

  static save(
    logs: readonly JointPainLog[],
    storage: StorageLike | null = defaultStorage(),
    accountId?: string,
  ): JointPainLog[] {
    const trimmed = logs.slice(-60);
    try {
      storage?.setItem(JointPainStore.key(accountId), JSON.stringify(trimmed));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("tyaga:joint-pain-change"));
      }
    } catch {
      // ignore quota / private mode
    }
    return trimmed;
  }

  /**
   * Записывает актуальный статус боли по зоне:
   * - при severity === 0 очищает активные логи этой зоны в 14-дневном окне (пользователь отметил «всё прошло»);
   * - при severity >= 1 добавляет новый чек-ин (если последний лог этой зоны был <12 ч назад, обновляет его, чтобы не спамить историю).
   */
  static setZoneStatus(
    zone: JointZone,
    severity: PainSeverity,
    isAcuteNightOrRadiating = false,
    nowMs = Date.now(),
    storage: StorageLike | null = defaultStorage(),
    accountId?: string,
  ): JointPainLog[] {
    const existing = JointPainStore.read(storage, nowMs, accountId);
    if (severity === 0 && !isAcuteNightOrRadiating) {
      const cleaned = existing.filter((l) => l.zone !== zone);
      return JointPainStore.save(cleaned, storage, accountId);
    }

    const nextLog: JointPainLog = {
      zone,
      severity,
      timestamp: nowMs,
      ...(isAcuteNightOrRadiating ? { isAcuteNightOrRadiating: true } : {}),
    };

    const lastIdx = [...existing]
      .reverse()
      .findIndex((l) => l.zone === zone && nowMs - l.timestamp < 12 * 3_600_000);
    if (lastIdx >= 0) {
      const realIdx = existing.length - 1 - lastIdx;
      const updated = existing.map((l, i) => (i === realIdx ? nextLog : l));
      return JointPainStore.save(updated, storage, accountId);
    }

    return JointPainStore.save([...existing, nextLog], storage, accountId);
  }
}
