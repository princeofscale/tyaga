export interface PlateLoadingResult {
  plates: number[];
  weightPerSide: number;
  actualLoaded: number;
  remainder: number;
}

/** Pure, bounded plate-loading math shared by the calculators. */
export class PlateLoadingCalculator {
  public static readonly MAX_TOTAL_WEIGHT_KG = 1000;
  public static readonly MAX_BAR_WEIGHT_KG = 100;
  public static readonly MAX_PLATES_PER_SIDE = 2048;
  public static readonly MAX_PLATE_TYPES = 64;

  private static readonly STANDARD_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

  private static clampFinite(
    value: number | string,
    minimum: number,
    maximum: number,
    fallback = minimum,
  ): number {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    const finiteValue = Number.isFinite(parsed) ? parsed : Number.isFinite(fallback) ? fallback : minimum;
    return Math.min(maximum, Math.max(minimum, finiteValue));
  }

  public static clampWeight(
    value: number | string,
    minimumKg = 0,
    maximumKg: number = this.MAX_TOTAL_WEIGHT_KG,
    fallbackKg = minimumKg,
  ): number {
    const maximum = this.clampFinite(maximumKg, 0, this.MAX_TOTAL_WEIGHT_KG, this.MAX_TOTAL_WEIGHT_KG);
    const minimum = this.clampFinite(minimumKg, 0, maximum);
    return this.clampFinite(value, minimum, maximum, fallbackKg);
  }

  public static clampBarWeight(value: number | string): number {
    return this.clampWeight(value, 0, this.MAX_BAR_WEIGHT_KG, 20);
  }

  public static adjustWeight(weightKg: number, deltaKg: number, barWeightKg = 20): number {
    const bar = this.clampBarWeight(barWeightKg);
    // Clamp before multiplying for quarter-kilogram rounding, avoiding overflow.
    const adjusted = this.clampWeight(weightKg + deltaKg, bar);
    return Math.round(adjusted * 4) / 4;
  }

  public static calculate(
    totalWeightKg: number,
    barWeightKg = 20,
    availablePlateWeights: readonly number[] = this.STANDARD_PLATES,
  ): PlateLoadingResult {
    const bar = this.clampBarWeight(barWeightKg);
    const total = this.clampWeight(totalWeightKg, 0, this.MAX_TOTAL_WEIGHT_KG, bar);
    const weightPerSide = Math.max(0, (total - bar) / 2);
    let remaining = weightPerSide;
    const plates: number[] = [];

    const inventory = [...new Set(
      availablePlateWeights.slice(0, this.MAX_PLATE_TYPES)
        .filter((weight) => Number.isFinite(weight) && weight > 0),
    )].sort((a, b) => b - a);

    for (const plate of inventory) {
      if (remaining <= 0 || plates.length >= this.MAX_PLATES_PER_SIDE) break;
      // A relative tolerance cannot turn a tiny plate into an unlimited zero-weight load.
      const tolerance = Math.min(0.001, plate * 1e-9);
      const count = Math.min(
        this.MAX_PLATES_PER_SIDE - plates.length,
        Math.floor((remaining + tolerance) / plate),
      );
      for (let i = 0; i < count; i++) plates.push(plate);
      remaining = Math.max(0, remaining - count * plate);
    }

    const actualLoaded = bar + plates.reduce((sum, plate) => sum + plate, 0) * 2;
    return { plates, weightPerSide, actualLoaded, remainder: remaining };
  }
}
