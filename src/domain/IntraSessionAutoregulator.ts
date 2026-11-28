import type { E1RMLoadMode } from "./OneRepMaxFormulas";
import {
  equipmentStepKg,
  roundDownToEquipment,
  roundToEquipment,
  toProgressionInventory,
  type ProgressionInventory,
} from "./ProgressionEngine";

export type PreSessionReadiness = "normal" | "worse" | "hard";

export interface PreSessionAdjustmentResult {
  weightMultiplier: number;
  adjustedWeight: number;
  targetSetsCount: number;
  targetRirFloor: number | null;
}

export interface IntraSessionInput {
  exerciseId: string;
  isCompoundAxial: boolean;
  loadMode?: E1RMLoadMode;
  plannedWeight: number;
  targetReps: number;
  targetRIR: number;
  actualReps: number;
  actualRIR: number | null;
  remainingSetsCount: number;
  inventory?: ProgressionInventory;
}

export interface IntraSessionAdjustment {
  shouldNotify: boolean;
  status: "high_performance" | "deadzone" | "fatigued" | "severe_drop";
  deviation: number;
  adjustedWeight: number;
  loadDropPct: number;
  repCap: number | null;
  dropLastSet: boolean;
  messageShort: string;
}

/**
 * Модуль 3: Внутритренировочная авторегуляция.
 * 1) Дифференцированная предтренировочная коррекция (осевая база vs подсобка/изоляция).
 * 2) Реакция на 1-й рабочий / топ-сет в реальном времени с мёртвой зоной тишины [-1.0 .. +1.5]
 *    и правилом Stop-Set при критической просадке.
 */
export class IntraSessionAutoregulator {
  /** 1. Предтренировочный модификатор готовности с учётом типа движения и инвентаря. */
  static preSessionAdjustment(params: {
    status: PreSessionReadiness;
    isCompoundAxial: boolean;
    plannedWeight: number;
    plannedSetsCount: number;
    loadMode: E1RMLoadMode;
    inventory?: ProgressionInventory;
  }): PreSessionAdjustmentResult {
    const inv = params.inventory ?? toProgressionInventory();
    if (params.status === "normal") {
      return {
        weightMultiplier: 1.0,
        adjustedWeight: params.plannedWeight,
        targetSetsCount: params.plannedSetsCount,
        targetRirFloor: null,
      };
    }

    const weightMultiplier =
      params.status === "worse"
        ? params.isCompoundAxial
          ? 0.95
          : 0.975
        : params.isCompoundAxial
          ? 0.9
          : 0.95;

    const adjustedWeight =
      params.loadMode === "assisted_bodyweight"
        ? roundToEquipment(
            Math.max(
              params.plannedWeight + equipmentStepKg(params.plannedWeight, params.loadMode, inv),
              params.plannedWeight / weightMultiplier,
            ),
            params.loadMode,
            inv,
            "ceil",
          )
        : params.plannedWeight > 0
          ? roundDownToEquipment(
              params.plannedWeight * weightMultiplier,
              params.plannedWeight,
              params.loadMode,
              inv,
              "floor",
            )
          : params.plannedWeight;

    const targetSetsCount =
      params.status === "hard" && params.plannedSetsCount >= 3
        ? Math.max(2, Math.min(params.plannedSetsCount - 1, Math.round(params.plannedSetsCount * 0.75)))
        : params.plannedSetsCount;

    return {
      weightMultiplier,
      adjustedWeight,
      targetSetsCount,
      targetRirFloor: params.status === "worse" ? 2 : 3,
    };
  }

  /** 2. Автокоррекция оставшихся подходов после выполнения 1-го рабочего или топ-сета. */
  static evaluate(input: IntraSessionInput): IntraSessionAdjustment {
    const inv = input.inventory ?? toProgressionInventory();
    const loadMode: E1RMLoadMode = input.loadMode ?? "total_external";
    const deltaReps = input.actualReps - input.targetReps;
    const deltaRir = (input.actualRIR ?? input.targetRIR) - input.targetRIR;
    const deviation = Math.round((deltaReps + deltaRir) * 100) / 100;

    // Если оставшихся подходов нет — тишина
    if (input.remainingSetsCount <= 0) {
      return {
        shouldNotify: false,
        status: "deadzone",
        deviation,
        adjustedWeight: input.plannedWeight,
        loadDropPct: 0,
        repCap: null,
        dropLastSet: false,
        messageShort: "",
      };
    }

    // Мёртвая зона тишины: [-1.0 .. +1.5]
    if (deviation >= -1.0 && deviation <= 1.5) {
      return {
        shouldNotify: false,
        status: "deadzone",
        deviation,
        adjustedWeight: input.plannedWeight,
        loadDropPct: 0,
        repCap: null,
        dropLastSet: false,
        messageShort: "",
      };
    }

    const step = equipmentStepKg(input.plannedWeight, loadMode, inv);

    const isAssisted = loadMode === "assisted_bodyweight";

    // Запас выше плана (+1.5 < E_dev < +2.5 — мягкая зона без шума; >= +2.5 — High Performance)
    if (deviation > 1.5) {
      if (deviation < 2.5) {
        return {
          shouldNotify: false,
          status: "deadzone",
          deviation,
          adjustedWeight: input.plannedWeight,
          loadDropPct: 0,
          repCap: null,
          dropLastSet: false,
          messageShort: "",
        };
      }
      if (isAssisted) {
        const nextAssist =
          input.plannedWeight > 0
            ? roundToEquipment(Math.max(0, input.plannedWeight - step), loadMode, inv, "floor")
            : 0;
        const lowered = nextAssist < input.plannedWeight;
        return {
          shouldNotify: true,
          status: "high_performance",
          deviation,
          adjustedWeight: nextAssist,
          loadDropPct: lowered ? 0.025 : 0,
          repCap: null,
          dropLastSet: false,
          messageShort: lowered
            ? `Идёт легко: можно снизить помощь до ${nextAssist} кг на оставшиеся ${input.remainingSetsCount}`
            : "Идёт легко: можешь добавить +1–2 повтора с тем же весом",
        };
      }
      const relStep = input.plannedWeight > 0 ? step / input.plannedWeight : 1;
      const canBump = input.plannedWeight > 0 && relStep <= 0.05;
      const nextWeight = canBump
        ? roundToEquipment(input.plannedWeight * 1.025, loadMode, inv, "ceil")
        : input.plannedWeight;
      const bumped = nextWeight > input.plannedWeight;
      return {
        shouldNotify: true,
        status: "high_performance",
        deviation,
        adjustedWeight: nextWeight,
        loadDropPct: bumped ? 0.025 : 0,
        repCap: null,
        dropLastSet: false,
        messageShort: bumped
          ? `Идёт легко: можно поднять до ${nextWeight} кг (+2,5 %) на оставшиеся ${input.remainingSetsCount}`
          : "Идёт легко: можешь добавить +1–2 повтора с тем же весом",
      };
    }

    // Критическая просадка: E_dev <= -2.5
    if (deviation <= -2.5) {
      const pct = input.isCompoundAxial ? -0.1 : -0.075;
      let nextWeight = isAssisted
        ? roundToEquipment(input.plannedWeight + step, loadMode, inv, "ceil")
        : input.plannedWeight > 0
          ? roundDownToEquipment(input.plannedWeight * (1 + pct), input.plannedWeight, loadMode, inv, "nearest")
          : input.plannedWeight;
      let repCap: number | null = Math.max(1, input.targetReps - 1);

      if (!isAssisted && input.plannedWeight > 0 && nextWeight >= input.plannedWeight) {
        const forcedDrop = roundDownToEquipment(
          Math.max(0, input.plannedWeight - step),
          input.plannedWeight,
          loadMode,
          inv,
          "floor",
        );
        if (forcedDrop < input.plannedWeight) {
          nextWeight = forcedDrop;
        } else {
          nextWeight = input.plannedWeight;
          repCap = Math.max(1, input.targetReps - 2);
        }
      }

      // Stop-Set Rule: убираем последний подход только если останется минимум 1 оставшийся (итого ≥2 рабочих с уже сделанным)
      const dropLastSet = input.remainingSetsCount >= 2;
      const setsAfterDrop = dropLastSet ? input.remainingSetsCount - 1 : input.remainingSetsCount;
      const pctLabel = Math.round(Math.abs(pct) * 100);
      const dropText = dropLastSet ? ` и убрать 1 подход (останется ${setsAfterDrop})` : "";

      return {
        shouldNotify: true,
        status: "severe_drop",
        deviation,
        adjustedWeight: nextWeight,
        loadDropPct: pct,
        repCap,
        dropLastSet,
        messageShort: isAssisted
          ? `Высокая усталость: увеличить помощь до ${nextWeight} кг${dropText}`
          : nextWeight < input.plannedWeight
            ? `Высокая усталость: снизить до ${nextWeight} кг (−${pctLabel} %)${dropText}`
            : `Высокая усталость: стоп на ${repCap} повт. (RIR 2)${dropText}`,
      };
    }

    // Просадка: -2.5 < E_dev < -1.0
    const pct = -0.05;
    let nextWeight = isAssisted
      ? roundToEquipment(input.plannedWeight + step, loadMode, inv, "ceil")
      : input.plannedWeight > 0
        ? roundDownToEquipment(input.plannedWeight * (1 + pct), input.plannedWeight, loadMode, inv, "nearest")
        : input.plannedWeight;
    let repCap: number | null = Math.max(1, input.targetReps - 1);

    if (!isAssisted && input.plannedWeight > 0 && nextWeight >= input.plannedWeight) {
      const forcedDrop = roundDownToEquipment(
        Math.max(0, input.plannedWeight - step),
        input.plannedWeight,
        loadMode,
        inv,
        "floor",
      );
      if (forcedDrop < input.plannedWeight) {
        nextWeight = forcedDrop;
      } else {
        nextWeight = input.plannedWeight;
        repCap = Math.max(1, input.targetReps - 2);
      }
    }

    return {
      shouldNotify: true,
      status: "fatigued",
      deviation,
      adjustedWeight: nextWeight,
      loadDropPct: pct,
      repCap,
      dropLastSet: false,
      messageShort: isAssisted
        ? `Усталость: увеличить помощь до ${nextWeight} кг на оставшиеся ${input.remainingSetsCount}`
        : nextWeight < input.plannedWeight
          ? `Усталость: снизить оставшиеся ${input.remainingSetsCount} до ${nextWeight} кг (−5 %)`
          : `Усталость: держи потолок ${repCap} повт. на оставшиеся ${input.remainingSetsCount}`,
    };
  }
}
