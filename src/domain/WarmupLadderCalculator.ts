import { PlateLoadingCalculator } from "./PlateLoadingCalculator";

/**
 * WarmupLadderCalculator
 *
 * OpenGym signature feature: calculates an optimal progressive warm-up ladder
 * for heavy barbell/dumbbell movements, preventing injury and preparing
 * the central nervous system without inducing premature muscular fatigue.
 */

export interface WarmupStep {
  stepIndex: number;
  percent: number;
  weightKg: number;
  reps: number;
  sidePlatesKg: number[];
  platesDescription: string;
  isWorkSet: boolean;
  purpose: string;
}

export class WarmupLadderCalculator {
  public static readonly MAX_TARGET_WEIGHT_KG = 400;
  public static readonly MAX_REPS = 30;

  public static clampTargetWeight(
    value: number | string,
    minimumKg = 0,
    fallbackKg = minimumKg,
  ): number {
    return PlateLoadingCalculator.clampWeight(value, minimumKg, this.MAX_TARGET_WEIGHT_KG, fallbackKg);
  }

  public static clampReps(value: number | string): number {
    const reps = typeof value === "string" ? Number(value) : value;
    if (!Number.isFinite(reps)) return 1;
    return Math.min(this.MAX_REPS, Math.max(1, Math.round(reps)));
  }

  public static clampBarWeight(value: number | string): number {
    return PlateLoadingCalculator.clampBarWeight(value);
  }

  /**
   * Calculates plate configuration per side of an Olympic barbell.
   */
  public static calculateSidePlates(totalWeightKg: number, barWeightKg = 20): number[] {
    const bar = this.clampBarWeight(barWeightKg);
    const target = this.clampTargetWeight(totalWeightKg, 0, bar);
    return PlateLoadingCalculator.calculate(target, bar).plates;
  }

  /**
   * Formats plates per side into human readable string: e.g. "20 + 10 + 2.5 кг" or "Пустой гриф"
   */
  public static formatPlates(totalWeightKg: number, barWeightKg = 20): string {
    const plates = this.calculateSidePlates(totalWeightKg, barWeightKg);
    if (!plates.length) return "Пустой гриф";

    // Count plate occurrences
    const counts: Record<number, number> = {};
    for (const p of plates) {
      counts[p] = (counts[p] || 0) + 1;
    }

    const parts = Object.entries(counts)
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([plate, count]) => (count > 1 ? `${count}×${plate}` : `${plate}`));

    return `По ${parts.join(" + ")} кг на сторону`;
  }

  /**
   * Generates a progressive warm-up ladder based on target working set.
   * Standard athletic ramp:
   * 1. 20 kg (bar) × 10 reps (mobility & motor pattern)
   * 2. ~40-50% × 5 reps (blood flow)
   * 3. ~65-70% × 3 reps (CNS recruitment)
   * 4. ~80-85% × 1-2 reps (potentiating)
   * 5. ~90% × 1 rep (acclimatization - only if work weight >= 90kg)
   * 6. 100% Target working set
   */
  public static generateLadder(
    targetWeightKg: number,
    targetReps = 6,
    barWeightKg = 20
  ): WarmupStep[] {
    barWeightKg = this.clampBarWeight(barWeightKg);
    targetReps = this.clampReps(targetReps);
    const roundedTarget = Math.round(this.clampTargetWeight(targetWeightKg, 0, barWeightKg) * 2) / 2;
    if (roundedTarget <= barWeightKg) {
      return [
        {
          stepIndex: 1,
          percent: 100,
          weightKg: roundedTarget,
          reps: targetReps,
          sidePlatesKg: [],
          platesDescription: "Пустой гриф",
          isWorkSet: true,
          purpose: "Рабочий подход",
        },
      ];
    }

    const steps: WarmupStep[] = [];
    let idx = 1;

    // Step 1: Empty bar
    steps.push({
      stepIndex: idx++,
      percent: Math.round((barWeightKg / roundedTarget) * 100),
      weightKg: barWeightKg,
      reps: 10,
      sidePlatesKg: [],
      platesDescription: "Пустой гриф",
      isWorkSet: false,
      purpose: "Разминка суставов и паттерн движения",
    });

    // Step 2: 45-50%
    const step2Weight = Math.round((roundedTarget * 0.45) / 2.5) * 2.5;
    if (step2Weight > barWeightKg && step2Weight < roundedTarget - 10) {
      steps.push({
        stepIndex: idx++,
        percent: Math.round((step2Weight / roundedTarget) * 100),
        weightKg: step2Weight,
        reps: 5,
        sidePlatesKg: this.calculateSidePlates(step2Weight, barWeightKg),
        platesDescription: this.formatPlates(step2Weight, barWeightKg),
        isWorkSet: false,
        purpose: "Усиление кровотока и активация",
      });
    }

    // Step 3: 65-70%
    const step3Weight = Math.round((roundedTarget * 0.68) / 2.5) * 2.5;
    if (step3Weight > (steps[steps.length - 1]?.weightKg || barWeightKg) && step3Weight < roundedTarget - 7.5) {
      steps.push({
        stepIndex: idx++,
        percent: Math.round((step3Weight / roundedTarget) * 100),
        weightKg: step3Weight,
        reps: 3,
        sidePlatesKg: this.calculateSidePlates(step3Weight, barWeightKg),
        platesDescription: this.formatPlates(step3Weight, barWeightKg),
        isWorkSet: false,
        purpose: "Рекрутирование двигательных единиц",
      });
    }

    // Step 4: 82-85%
    const step4Weight = Math.round((roundedTarget * 0.83) / 2.5) * 2.5;
    if (step4Weight > (steps[steps.length - 1]?.weightKg || barWeightKg) && step4Weight < roundedTarget - 2.5) {
      steps.push({
        stepIndex: idx++,
        percent: Math.round((step4Weight / roundedTarget) * 100),
        weightKg: step4Weight,
        reps: 2,
        sidePlatesKg: this.calculateSidePlates(step4Weight, barWeightKg),
        platesDescription: this.formatPlates(step4Weight, barWeightKg),
        isWorkSet: false,
        purpose: "Подготовка нервной системы (потенциация)",
      });
    }

    // Step 5: 92% (for weights >= 90kg)
    if (roundedTarget >= 90) {
      const step5Weight = Math.round((roundedTarget * 0.92) / 2.5) * 2.5;
      if (step5Weight > (steps[steps.length - 1]?.weightKg || barWeightKg) && step5Weight < roundedTarget) {
        steps.push({
          stepIndex: idx++,
          percent: Math.round((step5Weight / roundedTarget) * 100),
          weightKg: step5Weight,
          reps: 1,
          sidePlatesKg: this.calculateSidePlates(step5Weight, barWeightKg),
          platesDescription: this.formatPlates(step5Weight, barWeightKg),
          isWorkSet: false,
          purpose: "Калибровка веса без закисления",
        });
      }
    }

    // Final: Target Working Set
    steps.push({
      stepIndex: idx++,
      percent: 100,
      weightKg: roundedTarget,
      reps: targetReps,
      sidePlatesKg: this.calculateSidePlates(roundedTarget, barWeightKg),
      platesDescription: this.formatPlates(roundedTarget, barWeightKg),
      isWorkSet: true,
      purpose: "🎯 Целевой рабочий подход",
    });

    return steps;
  }
}
