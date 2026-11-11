import { localDate, browserTimeZone, addCalendarDays } from "../lib/calendar";
/**
 * BodyweightTracker
 *
 * OOP Domain Service for bodyweight tracking and exponential moving average (EMA)
 * analytics, inspired by OpenGym.
 *
 * Daily scale weights fluctuate due to water retention, glycogen, sodium, and digestion.
 * The EMA is a visual smoothing aid, not a measurement of tissue or energy balance.
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

  constructor(
    private accountId: string,
    private timeZone = browserTimeZone(),
    private adapter?: Pick<Storage,"getItem"|"setItem">,
  ) {
    this.storageKey = `tyaga-bodyweight:${accountId}`;
    this.goalKey = `tyaga-bodyweight-goal:${accountId}`;
  }

  private get storage() { return this.adapter ?? localStorage; }

  /** Accepts Russian decimal input without accepting trailing junk or non-finite values. */
  static parseWeight(value: string): number {
    const clean = value.trim().replace(",", ".");
    const n = Number(clean);
    if (
      !/^\d+(?:\.\d+)?$/.test(clean) ||
      !Number.isFinite(n) ||
      n < 20 ||
      n > 500
    )
      throw new Error("Введи вес от 20 до 500 кг, например 61,5");
    return Math.round(n * 10) / 10;
  }
  static step(value: string, delta: number) {
    return this.parseWeight(
      String(Math.round((this.parseWeight(value) + delta) * 10) / 10),
    );
  }

  /** Reports unreadable/corrupt storage before a mutation can replace existing bytes. */
  public storageIssue(): string {
    try {
      const entries = this.storage.getItem(this.storageKey),
        goal = this.storage.getItem(this.goalKey);
      if (entries !== null) {
        const data: unknown = JSON.parse(entries);
        if (!Array.isArray(data) || !data.every((e) => this.isEntry(e)))
          return "Сохранённые замеры повреждены. Исходные данные на устройстве не изменены.";
      }
      if (goal !== null && !this.isGoal(JSON.parse(goal)))
        return "Сохранённая цель повреждена. Исходные данные на устройстве не изменены.";
      return "";
    } catch {
      return "Не удалось прочитать замеры на устройстве. Проверь доступ к хранилищу браузера.";
    }
  }

  private requireReadable() {
    const issue = this.storageIssue();
    if (issue) throw new Error(issue);
  }

  public getEntries(): BodyweightEntry[] {
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (
        !Array.isArray(parsed) ||
        !parsed.every((entry) => this.isEntry(entry))
      )
        return [];
      return parsed.sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  }

  private isEntry(value: unknown): value is BodyweightEntry {
    if (!value || typeof value !== "object") return false;
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)
    )
      return false;
    const date = new Date(entry.date);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === entry.date &&
      typeof entry.id === "string" &&
      typeof entry.weightKg === "number" &&
      Number.isFinite(entry.weightKg) &&
      entry.weightKg >= 20 &&
      entry.weightKg <= 500 &&
      typeof entry.createdAt === "number" &&
      Number.isFinite(entry.createdAt) &&
      (entry.note === undefined || typeof entry.note === "string")
    );
  }

  public saveEntries(entries: BodyweightEntry[]): void {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(entries));
    } catch {
      throw new Error(
        "Не удалось сохранить вес на устройстве. Данные в форме сохранены; повтори попытку.",
      );
    }
  }

  public addEntry(weightKg: number, date?: string, note = ""): BodyweightEntry {
    this.requireReadable();
    if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 500) {
      throw new Error("Вес тела должен быть от 20 до 500 кг");
    }

    const todayDate = date || localDate(new Date(), this.timeZone);
    const parsed = new Date(todayDate + "T12:00:00Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(todayDate) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== todayDate ||
      todayDate > localDate(new Date(), this.timeZone)
    )
      throw new Error("Проверь дату взвешивания: она не может быть в будущем");
    const entries = this.getEntries();

    // Check if entry for this date already exists; if so, update it
    const existingIndex = entries.findIndex((e) => e.date === todayDate);

    if (existingIndex >= 0) {
      entries[existingIndex].weightKg = Math.round(weightKg * 10) / 10;
      entries[existingIndex].note = note.trim();
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
    this.requireReadable();
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
        const days =
          (Date.parse(e.date) - Date.parse(entries[i - 1].date)) / 86400000;
        const effectiveAlpha = 1 - Math.pow(1 - alpha, Math.max(1, days));
        prevEma = effectiveAlpha * e.weightKg + (1 - effectiveAlpha) * prevEma;
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
   * Regresses the last 28 days of actual measurements. Requires 3 dates spanning at least a week.
   */
  public getWeeklyRate(): {
    rateKgPerWeek: number;
    direction: "loss" | "gain" | "maintenance";
    label: string;
  } {
    const all = this.getEntries();
    const cutoff = addCalendarDays(localDate(new Date(), this.timeZone), -27);
    const entries = all.filter((e) => e.date >= cutoff);
    if (
      entries.length < 3 ||
      Date.parse(entries[entries.length - 1].date) -
        Date.parse(entries[0].date) <
        7 * 86400000
    ) {
      return {
        rateKgPerWeek: 0,
        direction: "maintenance",
        label: "Мало данных",
      };
    }

    const xs = entries.map(
      (e) => (Date.parse(e.date) - Date.parse(entries[0].date)) / 86400000,
    );
    const meanX = xs.reduce((n, x) => n + x, 0) / xs.length;
    const meanY = entries.reduce((n, e) => n + e.weightKg, 0) / entries.length;
    const numerator = entries.reduce(
      (n, e, i) => n + (xs[i] - meanX) * (e.weightKg - meanY),
      0,
    );
    const denominator = xs.reduce((n, x) => n + (x - meanX) ** 2, 0);
    const rate = Math.round((numerator / denominator) * 7 * 100) / 100;

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
      const raw = this.storage.getItem(this.goalKey);
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
    return [goal.targetWeightKg, goal.startWeightKg].every(
      (weight) =>
        weight === null ||
        (typeof weight === "number" &&
          Number.isFinite(weight) &&
          weight >= 20 &&
          weight <= 500),
    );
  }

  public setGoal(targetWeightKg: number | null): void {
    this.requireReadable();
    if (
      targetWeightKg !== null &&
      (!Number.isFinite(targetWeightKg) ||
        targetWeightKg < 20 ||
        targetWeightKg > 500)
    )
      throw new Error("Цель: от 20 до 500 кг");
    const currentStats = this.getStats();
    const startWeightKg = currentStats ? currentStats.currentKg : null;
    const goal: BodyweightGoal = { targetWeightKg, startWeightKg };
    try {
      this.storage.setItem(this.goalKey, JSON.stringify(goal));
    } catch {
      throw new Error(
        "Не удалось сохранить вес на устройстве. Данные в форме сохранены; повтори попытку.",
      );
    }
  }
}
