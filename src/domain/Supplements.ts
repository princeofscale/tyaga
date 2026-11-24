import { addCalendarDays, localDate } from "../lib/calendar";
import { calendarWeekday } from "./TrainingProgram";

export type SupplementCategory = "base" | "protein" | "vitamins" | "performance";

export type SupplementTiming =
  | "morning"
  | "pre_workout"
  | "intra_workout"
  | "post_workout"
  | "evening"
  | "anytime";

export type SupplementDoseUnit =
  | "г"
  | "мг"
  | "мкг"
  | "МЕ"
  | "мл"
  | "капс."
  | "таб."
  | "скуп"
  | "порц.";

export const SUPPLEMENT_DOSE_UNITS: readonly SupplementDoseUnit[] = [
  "г",
  "мг",
  "мкг",
  "МЕ",
  "мл",
  "капс.",
  "таб.",
  "скуп",
  "порц.",
];

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export interface SupplementCatalogItem {
  id: string;
  name: string;
  shortName: string;
  category: SupplementCategory;
  defaultDose: string;
  defaultAmount: number;
  defaultUnit: SupplementDoseUnit;
  defaultTiming: SupplementTiming;
  tagline: string;
  accent: string;
}

export interface UserSupplement {
  id: string;
  catalogId?: string;
  name: string;
  category: SupplementCategory;
  /** Форматированная дозировка, например «5 г» или «2000 МЕ». */
  dose: string;
  doseAmount?: number;
  doseUnit?: SupplementDoseUnit;
  timing: SupplementTiming;
  /** Дни недели 0..6 (Пн–Вс). Если не задано — каждый день. */
  days?: number[];
  /** Опциональное время напоминания HH:MM (например, "08:30"). */
  reminderTime?: string;
  note?: string;
  accent: string;
  createdAt: string;
}

export interface SupplementsState {
  version: 1;
  stack: UserSupplement[];
  /** Ключ YYYY-MM-DD -> список ID принятых в этот день добавок. */
  logs: Record<string, string[]>;
}

export const SUPPLEMENT_CATEGORIES: Array<{ id: "all" | SupplementCategory; label: string }> = [
  { id: "all", label: "Все" },
  { id: "base", label: "База" },
  { id: "protein", label: "Белок и масса" },
  { id: "vitamins", label: "Витамины" },
  { id: "performance", label: "Энергия" },
];

export const SUPPLEMENT_TIMINGS: Array<{ id: SupplementTiming; label: string; short: string; defaultTime: string }> = [
  { id: "morning", label: "Утром с едой", short: "Утро", defaultTime: "08:30" },
  { id: "pre_workout", label: "До тренировки", short: "До зала", defaultTime: "17:30" },
  { id: "intra_workout", label: "Во время тренировки", short: "В зале", defaultTime: "18:30" },
  { id: "post_workout", label: "После тренировки", short: "После зала", defaultTime: "19:30" },
  { id: "evening", label: "Вечером / перед сном", short: "Вечер", defaultTime: "22:00" },
  { id: "anytime", label: "В любое время", short: "Любое", defaultTime: "" },
];

export const SUPPLEMENT_CATALOG: SupplementCatalogItem[] = [
  {
    id: "creatine",
    name: "Креатин моногидрат",
    shortName: "Креатин",
    category: "base",
    defaultDose: "5 г",
    defaultAmount: 5,
    defaultUnit: "г",
    defaultTiming: "anytime",
    tagline: "Сила, взрывная мощность и восстановление АТФ",
    accent: "#e2441f",
  },
  {
    id: "whey-protein",
    name: "Сывороточный протеин (Whey)",
    shortName: "Протеин",
    category: "protein",
    defaultDose: "30 г",
    defaultAmount: 30,
    defaultUnit: "г",
    defaultTiming: "post_workout",
    tagline: "Быстрый белок для добора суточной нормы",
    accent: "#38bdf8",
  },
  {
    id: "gainer",
    name: "Гейнер",
    shortName: "Гейнер",
    category: "protein",
    defaultDose: "100 г",
    defaultAmount: 100,
    defaultUnit: "г",
    defaultTiming: "post_workout",
    tagline: "Углеводы + белок для профицита калорий и массы",
    accent: "#f59e0b",
  },
  {
    id: "casein",
    name: "Казеиновый протеин",
    shortName: "Казеин",
    category: "protein",
    defaultDose: "30 г",
    defaultAmount: 30,
    defaultUnit: "г",
    defaultTiming: "evening",
    tagline: "Медленное высвобождение аминокислот на ночь",
    accent: "#818cf8",
  },
  {
    id: "omega3",
    name: "Омега-3 (EPA / DHA)",
    shortName: "Омега-3",
    category: "vitamins",
    defaultDose: "2000 мг",
    defaultAmount: 2000,
    defaultUnit: "мг",
    defaultTiming: "morning",
    tagline: "Суставы, сердце и контроль воспаления",
    accent: "#22c55e",
  },
  {
    id: "vitamin-d3",
    name: "Витамин D3",
    shortName: "Витамин D3",
    category: "vitamins",
    defaultDose: "2000 МЕ",
    defaultAmount: 2000,
    defaultUnit: "МЕ",
    defaultTiming: "morning",
    tagline: "Иммунитет, кости и гормональный фон",
    accent: "#eab308",
  },
  {
    id: "magnesium",
    name: "Магний (глицинат / цитрат)",
    shortName: "Магний",
    category: "vitamins",
    defaultDose: "400 мг",
    defaultAmount: 400,
    defaultUnit: "мг",
    defaultTiming: "evening",
    tagline: "Качество сна и расслабление нервной системы",
    accent: "#a855f7",
  },
  {
    id: "zinc",
    name: "Цинк / ZMA",
    shortName: "Цинк",
    category: "vitamins",
    defaultDose: "15 мг",
    defaultAmount: 15,
    defaultUnit: "мг",
    defaultTiming: "evening",
    tagline: "Восстановление и иммунитет при высоких нагрузках",
    accent: "#14b8a6",
  },
  {
    id: "citrulline",
    name: "Цитруллин малат",
    shortName: "Цитруллин",
    category: "performance",
    defaultDose: "6 г",
    defaultAmount: 6,
    defaultUnit: "г",
    defaultTiming: "pre_workout",
    tagline: "Кровоток, памп и силовая выносливость",
    accent: "#f43f5e",
  },
  {
    id: "beta-alanine",
    name: "Бета-аланин",
    shortName: "Бета-аланин",
    category: "performance",
    defaultDose: "3,2 г",
    defaultAmount: 3.2,
    defaultUnit: "г",
    defaultTiming: "anytime",
    tagline: "Буфер закисления в многоповторных подходах",
    accent: "#ec4899",
  },
  {
    id: "caffeine",
    name: "Кофеин / Предтрен",
    shortName: "Кофеин",
    category: "performance",
    defaultDose: "200 мг",
    defaultAmount: 200,
    defaultUnit: "мг",
    defaultTiming: "pre_workout",
    tagline: "Фокус, бодрость и снижение субъективной тяжести",
    accent: "#fb923c",
  },
  {
    id: "electrolytes",
    name: "Электролиты (Na / K / Mg)",
    shortName: "Электролиты",
    category: "base",
    defaultDose: "1 порц.",
    defaultAmount: 1,
    defaultUnit: "порц.",
    defaultTiming: "intra_workout",
    tagline: "Гидратация и защита от судорог на тяжёлых сессиях",
    accent: "#06b6d4",
  },
  {
    id: "multivitamin",
    name: "Мультивитамины",
    shortName: "Витамины",
    category: "vitamins",
    defaultDose: "1 таб.",
    defaultAmount: 1,
    defaultUnit: "таб.",
    defaultTiming: "morning",
    tagline: "Базовое закрытие микронутриентов",
    accent: "#10b981",
  },
  {
    id: "collagen",
    name: "Коллаген + витамин C",
    shortName: "Коллаген",
    category: "base",
    defaultDose: "10 г",
    defaultAmount: 10,
    defaultUnit: "г",
    defaultTiming: "morning",
    tagline: "Поддержка связок и сухожилий",
    accent: "#f97316",
  },
];

const STORAGE_PREFIX = "tyaga-supplements:";

const UNIT_ALIASES: Array<[RegExp, SupplementDoseUnit]> = [
  [/мкг|mcg|ug/i, "мкг"],
  [/мг|mg/i, "мг"],
  [/ме|iu/i, "МЕ"],
  [/мл|ml/i, "мл"],
  [/капс|caps/i, "капс."],
  [/таб|tab/i, "таб."],
  [/скуп|scoop/i, "скуп"],
  [/порц|serv/i, "порц."],
  [/г|g\b/i, "г"],
];

function sanitizeDays(days: unknown): number[] | undefined {
  if (!Array.isArray(days)) return undefined;
  const clean = [...new Set(days.filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b,
  );
  return clean.length ? clean : undefined;
}

function sanitizeTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed) ? trimmed : undefined;
}

export class SupplementsStore {
  static key(accountId: string): string {
    return `${STORAGE_PREFIX}${accountId}`;
  }

  static empty(): SupplementsState {
    return { version: 1, stack: [], logs: {} };
  }

  /** Валидирует числовую дозировку (отклоняет текст вроде «куцавп», 0 и отрицательные числа). */
  static validateDoseAmount(raw: string | number): number | null {
    if (typeof raw === "number") {
      if (!Number.isFinite(raw) || raw <= 0 || raw > 10000) return null;
      return Math.round(raw * 100) / 100;
    }
    const normalized = raw.trim().replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const value = Number(normalized);
    if (!Number.isFinite(value) || value <= 0 || value > 10000) return null;
    return value;
  }

  static formatDose(amount: number, unit: SupplementDoseUnit): string {
    const clean = Math.round(amount * 100) / 100;
    const formatted = Number.isInteger(clean) ? String(clean) : String(clean).replace(".", ",");
    return `${formatted} ${unit}`;
  }

  static parseDose(dose: string, fallbackAmount = 1, fallbackUnit: SupplementDoseUnit = "г"): {
    amount: number;
    unit: SupplementDoseUnit;
  } {
    const numMatch = dose.match(/(\d+(?:[.,]\d+)?)/);
    const parsed = numMatch ? this.validateDoseAmount(numMatch[1]) : null;
    let unit: SupplementDoseUnit = fallbackUnit;
    for (const [re, u] of UNIT_ALIASES) {
      if (re.test(dose)) {
        unit = u;
        break;
      }
    }
    return { amount: parsed ?? fallbackAmount, unit };
  }

  static getDoseParts(item: Pick<UserSupplement, "dose" | "doseAmount" | "doseUnit">): {
    amount: number;
    unit: SupplementDoseUnit;
  } {
    if (
      typeof item.doseAmount === "number" &&
      Number.isFinite(item.doseAmount) &&
      item.doseAmount > 0 &&
      item.doseUnit &&
      SUPPLEMENT_DOSE_UNITS.includes(item.doseUnit)
    ) {
      return { amount: item.doseAmount, unit: item.doseUnit };
    }
    return this.parseDose(item.dose);
  }

  static getDays(item: Pick<UserSupplement, "days">): number[] {
    return item.days && item.days.length > 0 ? item.days : [...ALL_WEEKDAYS];
  }

  static isScheduledOn(item: Pick<UserSupplement, "days">, date: string): boolean {
    if (!item.days || item.days.length === 0 || item.days.length === 7) return true;
    return item.days.includes(calendarWeekday(date));
  }

  static scheduledForDate(stack: readonly UserSupplement[], date: string): UserSupplement[] {
    return stack.filter((item) => this.isScheduledOn(item, date));
  }

  static load(accountId: string): SupplementsState {
    try {
      const raw = localStorage.getItem(this.key(accountId));
      if (!raw) return this.empty();
      const parsed = JSON.parse(raw) as Partial<SupplementsState>;
      if (!parsed || !Array.isArray(parsed.stack)) return this.empty();
      const stack = parsed.stack
        .filter(
          (item): item is UserSupplement =>
            !!item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            typeof item.dose === "string",
        )
        .map((item) => {
          const parts = this.getDoseParts(item);
          return {
            ...item,
            doseAmount: parts.amount,
            doseUnit: parts.unit,
            dose: this.formatDose(parts.amount, parts.unit),
            days: sanitizeDays(item.days),
            reminderTime: sanitizeTime(item.reminderTime),
          };
        });
      const logs: Record<string, string[]> = {};
      if (parsed.logs && typeof parsed.logs === "object") {
        for (const [date, ids] of Object.entries(parsed.logs)) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Array.isArray(ids)) {
            logs[date] = [...new Set(ids.filter((x): x is string => typeof x === "string"))];
          }
        }
      }
      return { version: 1, stack, logs };
    } catch {
      return this.empty();
    }
  }

  static save(accountId: string, state: SupplementsState): boolean {
    try {
      const dates = Object.keys(state.logs).sort().slice(-120);
      const trimmed: Record<string, string[]> = {};
      for (const d of dates) {
        if (state.logs[d]?.length) trimmed[d] = state.logs[d];
      }
      localStorage.setItem(
        this.key(accountId),
        JSON.stringify({ version: 1, stack: state.stack, logs: trimmed }),
      );
      return true;
    } catch {
      return false;
    }
  }

  static addFromCatalog(state: SupplementsState, catalogId: string): SupplementsState {
    const item = SUPPLEMENT_CATALOG.find((c) => c.id === catalogId);
    if (!item) return state;
    if (state.stack.some((s) => s.catalogId === catalogId)) return state;
    const timingDef = SUPPLEMENT_TIMINGS.find((t) => t.id === item.defaultTiming);
    const added: UserSupplement = {
      id: `sup-${catalogId}-${Date.now().toString(36)}`,
      catalogId: item.id,
      name: item.name,
      category: item.category,
      dose: this.formatDose(item.defaultAmount, item.defaultUnit),
      doseAmount: item.defaultAmount,
      doseUnit: item.defaultUnit,
      timing: item.defaultTiming,
      days: [...ALL_WEEKDAYS],
      ...(timingDef?.defaultTime ? { reminderTime: timingDef.defaultTime } : {}),
      accent: item.accent,
      createdAt: new Date().toISOString(),
    };
    return { ...state, stack: [...state.stack, added] };
  }

  static addCustom(
    state: SupplementsState,
    input: {
      name: string;
      dose?: string;
      doseAmount?: number;
      doseUnit?: SupplementDoseUnit;
      timing: SupplementTiming;
      category: SupplementCategory;
      days?: number[];
      reminderTime?: string;
      note?: string;
    },
  ): SupplementsState {
    const name = input.name.trim();
    if (!name) return state;

    let amount: number;
    let unit: SupplementDoseUnit;
    if (input.doseAmount !== undefined && input.doseUnit) {
      const valid = this.validateDoseAmount(input.doseAmount);
      if (valid === null) return state;
      amount = valid;
      unit = input.doseUnit;
    } else if (input.dose) {
      const parsed = this.parseDose(input.dose, 1, "порц.");
      amount = parsed.amount;
      unit = parsed.unit;
    } else {
      amount = 1;
      unit = "порц.";
    }

    const accentByCat: Record<SupplementCategory, string> = {
      base: "#e2441f",
      protein: "#38bdf8",
      vitamins: "#22c55e",
      performance: "#f59e0b",
    };
    const days = sanitizeDays(input.days) ?? [...ALL_WEEKDAYS];
    const reminderTime = sanitizeTime(input.reminderTime);

    const added: UserSupplement = {
      id: `sup-custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      name: name.slice(0, 80),
      category: input.category,
      dose: this.formatDose(amount, unit),
      doseAmount: amount,
      doseUnit: unit,
      timing: input.timing,
      days,
      ...(reminderTime ? { reminderTime } : {}),
      ...(input.note?.trim() ? { note: input.note.trim().slice(0, 120) } : {}),
      accent: accentByCat[input.category],
      createdAt: new Date().toISOString(),
    };
    return { ...state, stack: [...state.stack, added] };
  }

  static update(
    state: SupplementsState,
    id: string,
    patch: Partial<Pick<UserSupplement, "name" | "dose" | "doseAmount" | "doseUnit" | "timing" | "days" | "reminderTime" | "note">>,
  ): SupplementsState {
    return {
      ...state,
      stack: state.stack.map((item) => {
        if (item.id !== id) return item;
        const next: UserSupplement = { ...item, ...patch };
        if (patch.doseAmount !== undefined || patch.doseUnit !== undefined) {
          const current = this.getDoseParts(item);
          const validAmount =
            patch.doseAmount !== undefined
              ? this.validateDoseAmount(patch.doseAmount)
              : current.amount;
          if (validAmount !== null) {
            const nextUnit = patch.doseUnit ?? current.unit;
            next.doseAmount = validAmount;
            next.doseUnit = nextUnit;
            next.dose = this.formatDose(validAmount, nextUnit);
          }
        } else if (patch.dose !== undefined) {
          const parsed = this.parseDose(patch.dose, this.getDoseParts(item).amount, this.getDoseParts(item).unit);
          next.doseAmount = parsed.amount;
          next.doseUnit = parsed.unit;
          next.dose = this.formatDose(parsed.amount, parsed.unit);
        }
        if ("days" in patch) {
          next.days = sanitizeDays(patch.days) ?? [...ALL_WEEKDAYS];
        }
        if ("reminderTime" in patch) {
          next.reminderTime = sanitizeTime(patch.reminderTime);
        }
        return next;
      }),
    };
  }

  static toggleDay(state: SupplementsState, id: string, weekday: number): SupplementsState {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return state;
    return {
      ...state,
      stack: state.stack.map((item) => {
        if (item.id !== id) return item;
        const current = new Set(this.getDays(item));
        if (current.has(weekday)) {
          // Не даём оставить добавку вообще без дней — минимум 1 день в неделе
          if (current.size <= 1) return item;
          current.delete(weekday);
        } else {
          current.add(weekday);
        }
        return { ...item, days: [...current].sort((a, b) => a - b) };
      }),
    };
  }

  /** Сохраняет новый порядок стека после перетаскивания или клавиатурной сортировки. */
  static reorder(state: SupplementsState, orderedIds: readonly string[]): SupplementsState {
    const byId = new Map(state.stack.map((item) => [item.id, item]));
    const next: UserSupplement[] = [];
    for (const id of orderedIds) {
      const found = byId.get(id);
      if (found) {
        next.push(found);
        byId.delete(id);
      }
    }
    for (const leftover of byId.values()) next.push(leftover);
    return { ...state, stack: next };
  }

  static remove(state: SupplementsState, id: string): SupplementsState {
    const nextLogs: Record<string, string[]> = {};
    for (const [date, ids] of Object.entries(state.logs)) {
      const kept = ids.filter((x) => x !== id);
      if (kept.length) nextLogs[date] = kept;
    }
    return {
      ...state,
      stack: state.stack.filter((s) => s.id !== id),
      logs: nextLogs,
    };
  }

  static toggleTaken(state: SupplementsState, date: string, id: string): SupplementsState {
    const current = new Set(state.logs[date] ?? []);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    return {
      ...state,
      logs: {
        ...state.logs,
        [date]: [...current],
      },
    };
  }

  static markAllTaken(state: SupplementsState, date: string, taken: boolean): SupplementsState {
    const scheduledIds = this.scheduledForDate(state.stack, date).map((s) => s.id);
    return {
      ...state,
      logs: {
        ...state.logs,
        [date]: taken ? scheduledIds : [],
      },
    };
  }

  /** Уважает пользовательский порядок стека (из drag-and-drop). */
  static orderedStack(stack: readonly UserSupplement[]): UserSupplement[] {
    return [...stack];
  }

  static summary(state: SupplementsState, today: string) {
    const todayScheduled = this.scheduledForDate(state.stack, today);
    const total = todayScheduled.length;
    const validTodayIds = new Set(todayScheduled.map((s) => s.id));
    const takenSet = new Set((state.logs[today] ?? []).filter((id) => validTodayIds.has(id)));
    const taken = takenSet.size;
    const ratio = total > 0 ? taken / total : 0;

    // 7-дневная лента приверженности с учётом расписания по дням недели
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const date = addCalendarDays(today, -(6 - i));
      const planned = this.scheduledForDate(state.stack, date);
      const plannedIds = new Set(planned.map((s) => s.id));
      const dayTotal = planned.length;
      const count = (state.logs[date] ?? []).filter((id) => plannedIds.has(id)).length;
      const done = dayTotal > 0 && count >= dayTotal;
      const partial = dayTotal > 0 && count > 0 && count < dayTotal;
      return { date, count, total: dayTotal, done, partial };
    });

    // Серия дней подряд
    let streak = 0;
    if (state.stack.length > 0) {
      let cursor = total > 0 && taken >= total ? today : addCalendarDays(today, -1);
      for (let i = 0; i < 120; i++) {
        const planned = this.scheduledForDate(state.stack, cursor);
        if (planned.length === 0) {
          // День отдыха от добавок не рвёт серию, если есть дни до него
          cursor = addCalendarDays(cursor, -1);
          continue;
        }
        const plannedIds = new Set(planned.map((s) => s.id));
        const count = (state.logs[cursor] ?? []).filter((id) => plannedIds.has(id)).length;
        if (count >= planned.length) {
          streak += 1;
          cursor = addCalendarDays(cursor, -1);
        } else {
          break;
        }
      }
    }

    return {
      total,
      stackCount: state.stack.length,
      taken,
      takenIds: takenSet,
      ratio,
      percent: Math.round(ratio * 100),
      streak,
      weekDays,
    };
  }

  static todayDate(timeZone?: string, now = new Date()): string {
    return localDate(now, timeZone);
  }
}
