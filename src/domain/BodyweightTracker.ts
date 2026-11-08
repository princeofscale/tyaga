/**
 * BodyweightTracker
 *
 * OOP Domain Service for bodyweight tracking and exponential moving average (EMA)
 * analytics, inspired by OpenGym.
 *
 * Daily scale weights fluctuate due to water retention, glycogen, sodium, and digestion.
 * The 7-day EMA smoothing curve reveals true progress (surplus/deficit rate).
 */

export interface BodyweightEntry {
  id: string;
  date: string; // "YYYY-MM-DD"
  weightKg: number;
  note?: string;
  createdAt: number;
}

export interface BodyweightTrendPoint {
  date: string;
  weightKg: number;
  emaKg: number;
  note?: string;
}

export interface BodyweightStats {
  currentKg: number;
  startKg: number;
  minKg: number;
  maxKg: number;
  averageKg: number;
  totalChangeKg: number;
  count: number;
}

export interface BodyweightGoal {
  targetWeightKg: number | null;
  startWeightKg: number | null;
}

export class BodyweightTracker {
  private storageKey: string;
  private goalKey: string;

  constructor(private accountId: string) {
    this.storageKey = `tyaga-bodyweight:${accountId}`;
    this.goalKey = `tyaga-bodyweight-goal:${accountId}`;
  }

  public getEntries(): BodyweightEntry[] {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every((entry) => this.isEntry(entry))) return [];
      return parsed.sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  }

  private isEntry(value: unknown): value is BodyweightEntry {
    if (!value || typeof value !== "object") return false;
    const entry = value as Record<string, unknown>;
    if (typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return false;
    const date = new Date(entry.date);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === entry.date
      && typeof entry.id === "string"
      && typeof entry.weightKg === "number" && Number.isFinite(entry.weightKg)
      && typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
      && (entry.note === undefined || typeof entry.note === "string");
  }

  public saveEntries(entries: BodyweightEntry[]): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(entries));
    } catch {
      // storage unavailable
    }
  }

  public addEntry(weightKg: number, date?: string, note = ""): BodyweightEntry {
    if (weightKg <= 20 || weightKg >= 500) {
      throw new Error("Вес тела должен быть от 20 до 500 кг");
    }

    const todayDate = date || new Date().toISOString().slice(0, 10);
    const entries = this.getEntries();

    // Check if entry for this date already exists; if so, update it
    const existingIndex = entries.findIndex((e) => e.date === todayDate);

    if (existingIndex >= 0) {
      entries[existingIndex].weightKg = Math.round(weightKg * 10) / 10;
      if (note) entries[existingIndex].note = note.trim();
      this.saveEntries(entries);
      return entries[existingIndex];
    }

    const newEntry: BodyweightEntry = {
      id: `bw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: todayDate,
      weightKg: Math.round(weightKg * 10) / 10,
      note: note.trim(),
      createdAt: Date.now(),
    };

    entries.push(newEntry);
    this.saveEntries(entries);
    return newEntry;
  }

  public removeEntry(id: string): void {
    const entries = this.getEntries().filter((e) => e.id !== id);
    this.saveEntries(entries);
  }

  /**
   * Calculates Exponential Moving Average (EMA) to smooth out daily water weight fluctuations.
   * alpha defaults to 0.25 (~7-day smoothing factor).
   */
  public getTrend(alpha = 0.25): BodyweightTrendPoint[] {
    const entries = this.getEntries();
    if (!entries.length) return [];

    const result: BodyweightTrendPoint[] = [];
    let prevEma = entries[0].weightKg;

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (i === 0) {
        prevEma = e.weightKg;
      } else {
        prevEma = alpha * e.weightKg + (1 - alpha) * prevEma;
      }

      result.push({
        date: e.date,
        weightKg: e.weightKg,
        emaKg: Math.round(prevEma * 10) / 10,
        note: e.note,
      });
    }

    return result;
  }

  /**
   * Estimates weekly rate of change based on the last 2-4 weeks of data.
   */
  public getWeeklyRate(): {
    rateKgPerWeek: number;
    direction: "loss" | "gain" | "maintenance";
    label: string;
  } {
    const entries = this.getEntries();
    if (entries.length < 2) {
      return { rateKgPerWeek: 0, direction: "maintenance", label: "Мало данных" };
    }

    const first = entries[0];
    const last = entries[entries.length - 1];

    const d1 = new Date(first.date).getTime();
    const d2 = new Date(last.date).getTime();
    const daysDiff = Math.max(1, (d2 - d1) / (1000 * 60 * 60 * 24));
    const weeks = daysDiff / 7;

    const diffKg = last.weightKg - first.weightKg;
    const rate = Math.round((diffKg / Math.max(0.5, weeks)) * 100) / 100;

    if (rate <= -0.15) {
      return {
        rateKgPerWeek: rate,
        direction: "loss",
        label: `${rate} кг/нед (снижение)`,
      };
    } else if (rate >= 0.15) {
      return {
        rateKgPerWeek: rate,
        direction: "gain",
        label: `+${rate} кг/нед (набор)`,
      };
    } else {
      return {
        rateKgPerWeek: rate,
        direction: "maintenance",
        label: "Удержание веса",
      };
    }
  }

  public getStats(): BodyweightStats | null {
    const entries = this.getEntries();
    if (!entries.length) return null;

    const weights = entries.map((e) => e.weightKg);
    const minKg = Math.min(...weights);
    const maxKg = Math.max(...weights);
    const sum = weights.reduce((acc, w) => acc + w, 0);
    const averageKg = Math.round((sum / weights.length) * 10) / 10;
    const currentKg = entries[entries.length - 1].weightKg;
    const startKg = entries[0].weightKg;
    const totalChangeKg = Math.round((currentKg - startKg) * 10) / 10;

    return {
      currentKg,
      startKg,
      minKg,
      maxKg,
      averageKg,
      totalChangeKg,
      count: entries.length,
    };
  }

  public getGoal(): BodyweightGoal {
    try {
      const raw = localStorage.getItem(this.goalKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (this.isGoal(parsed)) return parsed;
      }
    } catch {
      // fallback
    }
    return { targetWeightKg: null, startWeightKg: null };
  }

  private isGoal(value: unknown): value is BodyweightGoal {
    if (!value || typeof value !== "object") return false;
    const goal = value as Record<string, unknown>;
    return [goal.targetWeightKg, goal.startWeightKg].every((weight) =>
      weight === null || (typeof weight === "number" && Number.isFinite(weight))
    );
  }

  public setGoal(targetWeightKg: number | null): void {
    const currentStats = this.getStats();
    const startWeightKg = currentStats ? currentStats.currentKg : null;
    const goal: BodyweightGoal = { targetWeightKg, startWeightKg };
    try {
      localStorage.setItem(this.goalKey, JSON.stringify(goal));
    } catch {
      // storage unavailable
    }
  }
}
