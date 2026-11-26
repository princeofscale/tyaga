import type { E1RMLoadMode } from "./OneRepMaxFormulas";
import { OneRepMaxFormulas } from "./OneRepMaxFormulas";
import { DEFAULT_GYM_INVENTORY, type GymInventory } from "./GymInventory";

export type RoundMode = "nearest" | "ceil" | "floor";

export interface ProgressionInventory {
  barbellWeightKg: number;
  minPlateKg: number;
  dumbbellStepsKg?: number[];
  stackStepKg: number;
}

export function toProgressionInventory(
  inv: Partial<GymInventory> & Partial<ProgressionInventory> = DEFAULT_GYM_INVENTORY,
): ProgressionInventory {
  return {
    barbellWeightKg: inv.barbellWeightKg ?? inv.barWeightKg ?? DEFAULT_GYM_INVENTORY.barWeightKg,
    minPlateKg: inv.minPlateKg ?? DEFAULT_GYM_INVENTORY.minPlateKg,
    ...(inv.dumbbellStepsKg ? { dumbbellStepsKg: inv.dumbbellStepsKg } : {}),
    stackStepKg: inv.stackStepKg ?? 5,
  };
}

/** Определяет минимальный физический шаг изменения веса для данного типа отягощения и инвентаря зала. */
export function equipmentStepKg(
  currentWeightKg: number,
  loadMode: E1RMLoadMode,
  inventory: ProgressionInventory = toProgressionInventory(),
): number {
  switch (loadMode) {
    case "total_external":
      return Math.max(0.5, inventory.minPlateKg * 2);
    case "per_implement": {
      const steps = inventory.dumbbellStepsKg;
      if (steps && steps.length >= 2) {
        const sorted = [...steps].sort((a, b) => a - b);
        const next = sorted.find((v) => v > currentWeightKg + 1e-6);
        if (next !== undefined) {
          return Math.max(0.5, Math.round((next - currentWeightKg) * 100) / 100);
        }
        return Math.max(0.5, sorted[sorted.length - 1] - sorted[sorted.length - 2]);
      }
      if (currentWeightKg <= 10) return 1.0;
      if (currentWeightKg <= 30) return 2.0;
      return 2.5;
    }
    case "machine_stack":
      return Math.max(0.5, inventory.stackStepKg || 5);
    case "added_bodyweight":
      return Math.max(0.5, inventory.minPlateKg);
    case "assisted_bodyweight":
      return Math.max(0.5, inventory.stackStepKg || 5);
    default:
      return Math.max(0.5, inventory.minPlateKg * 2);
  }
}

/**
 * Детерминированное округление сырого веса под реальный инвентарь зала.
 */
export function roundToEquipment(
  rawWeightKg: number,
  loadMode: E1RMLoadMode,
  inventory: ProgressionInventory = toProgressionInventory(),
  roundMode: RoundMode = "nearest",
): number {
  if (!Number.isFinite(rawWeightKg) || rawWeightKg <= 0) {
    if (loadMode === "total_external") return inventory.barbellWeightKg;
    return 0;
  }
  if (loadMode === "bodyweight" || loadMode === "legacy_unspecified") {
    return Math.round(rawWeightKg * 100) / 100;
  }

  if (loadMode === "per_implement" && inventory.dumbbellStepsKg?.length) {
    const sorted = [...inventory.dumbbellStepsKg].sort((a, b) => a - b);
    if (rawWeightKg <= sorted[0]) return sorted[0];
    if (rawWeightKg >= sorted[sorted.length - 1]) return sorted[sorted.length - 1];
    if (roundMode === "ceil") {
      return sorted.find((v) => v >= rawWeightKg - 1e-6) ?? sorted[sorted.length - 1];
    }
    if (roundMode === "floor") {
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i] <= rawWeightKg + 1e-6) return sorted[i];
      }
      return sorted[0];
    }
    let best = sorted[0];
    let bestDiff = Math.abs(rawWeightKg - best);
    for (const v of sorted) {
      const d = Math.abs(rawWeightKg - v);
      if (d < bestDiff) {
        best = v;
        bestDiff = d;
      }
    }
    return best;
  }

  const step = equipmentStepKg(rawWeightKg, loadMode, inventory);
  const minWeight =
    loadMode === "total_external"
      ? inventory.barbellWeightKg
      : loadMode === "added_bodyweight" || loadMode === "assisted_bodyweight"
        ? 0
        : step;

  const fn =
    roundMode === "ceil" ? Math.ceil : roundMode === "floor" ? Math.floor : Math.round;
  const snapped = fn(rawWeightKg / step) * step;
  return Math.round(Math.max(minWeight, snapped) * 100) / 100;
}

export interface DDPSetHistory {
  weight: number;
  reps: number;
  rir: number | null;
}

export interface DDPInput {
  previousSets: DDPSetHistory[];
  repMin: number;
  repMax: number;
  rirMin?: number;
  rirMax?: number;
  loadMode: E1RMLoadMode;
  inventory?: ProgressionInventory;
  /** Явный шаг веса (если нужно переопределить стандартный шаг инвентаря, напр. для теста или кастомных гантелей). */
  stepOverrideKg?: number;
}

export interface DDPSetRecommendation {
  setIndex: number;
  recommendedWeight: number;
  recommendedReps: number;
  effectiveRepMax: number;
  action: "increase_weight" | "increase_reps" | "hold_improve_rir" | "decrease_weight";
  reasonCode: string;
}

export interface TMUpdateInput {
  currentTM: number;
  targetReps: number;
  targetRIR: number;
  actualReps: number;
  actualRIR: number | null;
  positiveStreak: number;
  negativeStreak: number;
  isCycleEndTest?: boolean;
  inventory?: ProgressionInventory;
}

export interface TMUpdateDecision {
  currentTM: number;
  newTM: number;
  changePct: number;
  pDelta: number;
  status: "increased" | "pending_increase" | "hold" | "pending_decrease" | "decreased";
  stateUpdated: {
    positiveStreak: number;
    negativeStreak: number;
  };
  requiresUserConfirmation: boolean;
}

export interface DetrainingPlan {
  active: boolean;
  gapDays: number;
  weightMultiplier: number;
  volumeMultiplier: number;
  rirFloor: number | null;
  rampSessions: number;
  label: string;
}

export interface PlateauSessionPoint {
  date: string;
  bestE1rm: number;
  confidence: number;
  avgRir: number | null;
  missedTarget?: boolean;
}

export interface PlateauDecision {
  isPlateau: boolean;
  growthPct: number;
  protocol: "none" | "exercise_rotation" | "rep_range_shift" | "micro_deload";
  suggestedRepRange?: [number, number];
  suggestedWeightKg?: number;
  reason: string;
}

/**
 * Модуль 2: Детерминированный движок межтренировочной прогрессии:
 * - Dynamic Double Progression (DDP) с RIR-коридором и защитой от скачка шага инвентаря;
 * - Авторегуляция Training Max (TM) для DUP v2 с двухшаговым гистерезисом;
 * - Протокол возврата после перерыва (Detraining);
 * - Детектор и протокол выхода из плато.
 */
export class ProgressionEngine {
  /** Сценарий A: Dynamic Double Progression (поподходная прогрессия). */
  static recommendDdpSets(input: DDPInput): DDPSetRecommendation[] {
    const inv = input.inventory ?? toProgressionInventory();
    const repMin = Math.max(1, Math.round(input.repMin));
    const repMax = Math.max(repMin, Math.round(input.repMax));
    const rirMin = input.rirMin ?? 1;

    return input.previousSets.map((prev, setIndex) => {
      const prevWeight = Math.max(0, prev.weight);
      const step =
        input.stepOverrideKg !== undefined && input.stepOverrideKg > 0
          ? input.stepOverrideKg
          : equipmentStepKg(prevWeight, input.loadMode, inv);
      const relJump = prevWeight > 0 ? step / prevWeight : 0;
      const repBonus = relJump > 0.25 ? 4 : relJump > 0.125 ? 2 : 0;
      const effectiveRepMax = repMax + repBonus;
      const prevRir = prev.rir ?? rirMin;

      // 1. Цель достигнута чисто -> поднимаем вес на 1 шаг и возвращаемся к repMin
      if (prev.reps >= effectiveRepMax && prevRir >= rirMin && prevWeight > 0) {
        const nextWeight =
          input.stepOverrideKg !== undefined
            ? Math.round((prevWeight + step) * 100) / 100
            : roundToEquipment(prevWeight + step, input.loadMode, inv, "nearest");
        return {
          setIndex,
          recommendedWeight: nextWeight,
          recommendedReps: repMin,
          effectiveRepMax,
          action: "increase_weight",
          reasonCode: repBonus > 0 ? "target_met_after_extended_cap" : "target_met",
        };
      }

      // 2. Потолок повторов взят, но ценой отказа (RIR < rirMin) -> удержать вес
      if (prev.reps >= effectiveRepMax && prevRir < rirMin) {
        return {
          setIndex,
          recommendedWeight: prevWeight,
          recommendedReps: effectiveRepMax,
          effectiveRepMax,
          action: "hold_improve_rir",
          reasonCode: "overreached_rir",
        };
      }

      // 3. Внутри рабочего диапазона (включая расширенный effectiveRepMax при большом шаге)
      if (prev.reps >= repMin && prev.reps < effectiveRepMax) {
        const nextReps = prevRir >= rirMin ? Math.min(effectiveRepMax, prev.reps + 1) : prev.reps;
        return {
          setIndex,
          recommendedWeight: prevWeight,
          recommendedReps: nextReps,
          effectiveRepMax,
          action: nextReps > prev.reps ? "increase_reps" : "hold_improve_rir",
          reasonCode:
            repBonus > 0 && prev.reps >= repMax
              ? "equipment_jump_guard_extend_reps"
              : nextReps > prev.reps
                ? "in_range_add_rep"
                : "in_range_hold_rir",
        };
      }

      // 4. Недобор ниже repMin на отказе -> снизить вес на 1 шаг (или -5%, округление вниз)
      if (prev.reps < repMin && prevRir <= 0 && prevWeight > 0) {
        const rawDrop = Math.min(prevWeight - step, prevWeight * 0.95);
        const nextWeight =
          input.stepOverrideKg !== undefined
            ? Math.max(0, Math.round(rawDrop * 100) / 100)
            : roundToEquipment(Math.max(0, rawDrop), input.loadMode, inv, "floor");
        return {
          setIndex,
          recommendedWeight: nextWeight,
          recommendedReps: repMin,
          effectiveRepMax,
          action: "decrease_weight",
          reasonCode: "underperformed_at_failure",
        };
      }

      // 5. Недобор ниже repMin с запасом (sandbagging / технический сбой) -> удержать вес
      return {
        setIndex,
        recommendedWeight: prevWeight,
        recommendedReps: repMin,
        effectiveRepMax,
        action: "hold_improve_rir",
        reasonCode: "underperformed_with_reserve",
      };
    });
  }

  /** Сценарий B: Авторегуляция Training Max (TM) в DUP v2 с двухшаговым гистерезисом. */
  static evaluateTmUpdate(input: TMUpdateInput): TMUpdateDecision {
    const deltaReps = input.actualReps - input.targetReps;
    const deltaRir = (input.actualRIR ?? 1.5) - input.targetRIR;
    const pDelta = Math.round((deltaReps + 0.7 * deltaRir) * 100) / 100;

    let changePct = 0;
    let positiveStreak = input.positiveStreak;
    let negativeStreak = input.negativeStreak;
    let status: TMUpdateDecision["status"];

    if (pDelta >= 1.5) {
      const desiredPct = pDelta >= 3.0 ? 0.025 : 0.0125;
      positiveStreak += 1;
      negativeStreak = 0;
      if (input.isCycleEndTest || positiveStreak >= 2) {
        changePct = desiredPct;
        positiveStreak = 0;
        negativeStreak = 0;
        status = "increased";
      } else {
        status = "pending_increase";
      }
    } else if (pDelta < -2.5) {
      // Критический провал: немедленный аварийный сброс -2.5% без ожидания
      changePct = -0.025;
      positiveStreak = 0;
      negativeStreak = 0;
      status = "decreased";
    } else if (pDelta < -1.0) {
      negativeStreak += 1;
      positiveStreak = 0;
      if (negativeStreak >= 2) {
        changePct = -0.025;
        positiveStreak = 0;
        negativeStreak = 0;
        status = "decreased";
      } else {
        status = "pending_decrease";
      }
    } else {
      positiveStreak = 0;
      negativeStreak = 0;
      status = "hold";
    }

    const rawNewTm = input.currentTM * (1 + changePct);
    const newTM =
      changePct === 0
        ? input.currentTM
        : Math.round(rawNewTm * 2) / 2;

    return {
      currentTM: input.currentTM,
      newTM,
      changePct,
      pDelta,
      status,
      stateUpdated: { positiveStreak, negativeStreak },
      requiresUserConfirmation: changePct !== 0,
    };
  }

  /** Сценарий C: Протокол возврата после перерыва (Detraining / Return-to-Load). */
  static evaluateDetraining(gapDays: number): DetrainingPlan {
    const cleanGap = Math.max(0, Math.floor(gapDays));
    if (cleanGap < 7) {
      return {
        active: false,
        gapDays: cleanGap,
        weightMultiplier: 1.0,
        volumeMultiplier: 1.0,
        rirFloor: null,
        rampSessions: 0,
        label: "Обычный режим",
      };
    }
    if (cleanGap <= 13) {
      return {
        active: true,
        gapDays: cleanGap,
        weightMultiplier: 0.95,
        volumeMultiplier: 0.8,
        rirFloor: 2,
        rampSessions: 1,
        label: "Мягкий вход после паузы (7–13 дн.)",
      };
    }
    if (cleanGap <= 27) {
      return {
        active: true,
        gapDays: cleanGap,
        weightMultiplier: 0.85,
        volumeMultiplier: 0.65,
        rirFloor: 3,
        rampSessions: 2,
        label: "Плавный возврат после перерыва (14–27 дн.)",
      };
    }
    if (cleanGap <= 55) {
      return {
        active: true,
        gapDays: cleanGap,
        weightMultiplier: 0.75,
        volumeMultiplier: 0.5,
        rirFloor: 3,
        rampSessions: 3,
        label: "Адаптационный возврат (28–55 дн.)",
      };
    }
    return {
      active: true,
      gapDays: cleanGap,
      weightMultiplier: 0.65,
      volumeMultiplier: 0.5,
      rirFloor: 4,
      rampSessions: 4,
      label: "Перезапуск после долгой паузы (56+ дн.)",
    };
  }

  /** Применяет модификатор detraining к весу и числу подходов с округлением под инвентарь. */
  static applyDetrainingToPlan(
    weightKg: number,
    setsCount: number,
    gapDays: number,
    loadMode: E1RMLoadMode = "total_external",
    inventory: ProgressionInventory = toProgressionInventory(),
  ): { weightKg: number; setsCount: number; plan: DetrainingPlan } {
    const plan = ProgressionEngine.evaluateDetraining(gapDays);
    if (!plan.active) return { weightKg, setsCount, plan };
    const nextWeight =
      weightKg > 0
        ? roundToEquipment(weightKg * plan.weightMultiplier, loadMode, inventory, "floor")
        : weightKg;
    const minSets = plan.gapDays >= 56 ? 1 : 2;
    const nextSets = Math.max(
      Math.min(setsCount, minSets),
      Math.round(setsCount * plan.volumeMultiplier),
    );
    return { weightKg: nextWeight, setsCount: nextSets, plan };
  }

  /** Сценарий D: Детектор и детерминированный протокол выхода из плато. */
  static detectPlateau(params: {
    sessions: PlateauSessionPoint[];
    isCoreOrDupFixed: boolean;
    weeksInCurrentVariant: number;
    currentRepRange: [number, number];
    loadMode: E1RMLoadMode;
    globalDeloadRecommended: boolean;
    inventory?: ProgressionInventory;
  }): PlateauDecision {
    if (params.globalDeloadRecommended) {
      return {
        isPlateau: false,
        growthPct: 0,
        protocol: "none",
        reason: "Глобальная разгрузка приоритетнее разбора плато.",
      };
    }

    const valid = params.sessions
      .filter((s) => s.bestE1rm > 0 && s.confidence >= 0.4)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (valid.length < 4) {
      return {
        isPlateau: false,
        growthPct: 0,
        protocol: "none",
        reason: "Недостаточно сессий (нужно минимум 4 за 35 дней).",
      };
    }

    const last2 = valid.slice(-2);
    const prior = valid.slice(Math.max(0, valid.length - 6), valid.length - 2);
    const recentAvg = (last2[0].bestE1rm + last2[1].bestE1rm) / 2;
    const priorPeak = Math.max(...prior.map((p) => p.bestE1rm));
    const growthPct = priorPeak > 0 ? Math.round(((recentAvg - priorPeak) / priorPeak) * 1000) / 10 : 0;

    const consecutiveMisses = last2.filter((s) => s.missedTarget).length;
    const highEffort = last2.every((s) => s.avgRir !== null && s.avgRir <= 1.0);

    if (growthPct > 0.5 || (consecutiveMisses < 2 && !highEffort)) {
      return {
        isPlateau: false,
        growthPct,
        protocol: "none",
        reason: "Динамика в пределах нормы.",
      };
    }

    const inv = params.inventory ?? toProgressionInventory();

    // 1. Вариация упражнения (для не-базовых при стаже >= 6 недель)
    if (!params.isCoreOrDupFixed && params.weeksInCurrentVariant >= 6) {
      return {
        isPlateau: true,
        growthPct,
        protocol: "exercise_rotation",
        reason: "Стагнация ≥4 сессий в одном варианте (>6 нед.) — смени вариацию на биомеханический аналог.",
      };
    }

    // 2. Смена диапазона повторений с пересчётом веса через e1RM
    const [, curMax] = params.currentRepRange;
    const nextRange: [number, number] = curMax <= 8 ? [10, 12] : [6, 8];
    const targetMidReps = Math.round((nextRange[0] + nextRange[1]) / 2);
    const targetStartWeight = roundToEquipment(
      recentAvg / (1 + 0.0333 * (targetMidReps + 2)),
      params.loadMode,
      inv,
      "nearest",
    );
    if (params.isCoreOrDupFixed || curMax <= 12) {
      return {
        isPlateau: true,
        growthPct,
        protocol: "rep_range_shift",
        suggestedRepRange: nextRange,
        suggestedWeightKg: targetStartWeight,
        reason: `Плато (${growthPct}% за 4+ сессии): перейди в диапазон ${nextRange[0]}–${nextRange[1]} повт. (~${OneRepMaxFormulas.round(targetStartWeight)} кг при RIR 2).`,
      };
    }

    // 3. Микро-делауд конкретного движения (-10% на 1 неделю)
    return {
      isPlateau: true,
      growthPct,
      protocol: "micro_deload",
      reason: "Плато без системной усталости: сбрось рабочий вес этого движения на 10 % на 1 неделю.",
    };
  }
}
