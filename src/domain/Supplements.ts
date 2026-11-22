import { addCalendarDays, localDate } from "../lib/calendar";

export type SupplementCategory = "base" | "protein" | "vitamins" | "performance";

export type SupplementTiming =
  | "morning"
  | "pre_workout"
  | "intra_workout"
  | "post_workout"
  | "evening"
  | "anytime";

export interface SupplementCatalogItem {
  id: string;
  name: string;
  shortName: string;
  category: SupplementCategory;
  defaultDose: string;
  defaultTiming: SupplementTiming;
  tagline: string;
  accent: string;
}

export interface UserSupplement {
  id: string;
  catalogId?: string;
  name: string;
  category: SupplementCategory;
  dose: string;
  timing: SupplementTiming;
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

export const SUPPLEMENT_TIMINGS: Array<{ id: SupplementTiming; label: string; short: string }> = [
  { id: "morning", label: "Утром с едой", short: "Утро" },
  { id: "pre_workout", label: "До тренировки", short: "До залa" },
  { id: "intra_workout", label: "Во время тренировки", short: "В зале" },
  { id: "post_workout", label: "После тренировки", short: "После зала" },
  { id: "evening", label: "Вечером / перед сном", short: "Вечер" },
  { id: "anytime", label: "В любое время", short: "Любое" },
];

export const SUPPLEMENT_CATALOG: SupplementCatalogItem[] = [
  {
    id: "creatine",
    name: "Креатин моногидрат",
    shortName: "Креатин",
    category: "base",
    defaultDose: "5 г",
    defaultTiming: "anytime",
    tagline: "Сила, взрывная мощность и восстановление АТФ",
    accent: "#e2441f",
  },
  {
    id: "whey-protein",
    name: "Сывороточный протеин (Whey)",
    shortName: "Протеин",
    category: "protein",
    defaultDose: "30 г (1 скуп)",
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
    defaultTiming: "pre_workout",
    tagline: "Фокус, бодрость и снижение субъективной тяжести",
    accent: "#fb923c",
  },
  {
    id: "electrolytes",
    name: "Электролиты (Na / K / Mg)",
    shortName: "Электролиты",
    category: "base",
    defaultDose: "1 порция",
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
    defaultTiming: "morning",
    tagline: "Поддержка связок и сухожилий",
    accent: "#f97316",
  },
];

const TIMING_ORDER: Record<SupplementTiming, number> = {
  morning: 0,
  pre_workout: 1,
  intra_workout: 2,
  post_workout: 3,
  anytime: 4,
  evening: 5,
};

const STORAGE_PREFIX = "tyaga-supplements:";

export class SupplementsStore {
  static key(accountId: string): string {
    return `${STORAGE_PREFIX}${accountId}`;
  }

  static empty(): SupplementsState {
    return { version: 1, stack: [], logs: {} };
  }

  static load(accountId: string): SupplementsState {
    try {
      const raw = localStorage.getItem(this.key(accountId));
      if (!raw) return this.empty();
      const parsed = JSON.parse(raw) as Partial<SupplementsState>;
      if (!parsed || !Array.isArray(parsed.stack)) return this.empty();
      const stack = parsed.stack.filter(
        (item): item is UserSupplement =>
          !!item &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.dose === "string",
      );
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

  static save(accountId: string, state: SupplementsState): void {
    try {
      // Храним историю приёмов за последние 120 дней, чтобы не раздувать localStorage.
      const dates = Object.keys(state.logs).sort().slice(-120);
      const trimmed: Record<string, string[]> = {};
      for (const d of dates) {
        if (state.logs[d]?.length) trimmed[d] = state.logs[d];
      }
      localStorage.setItem(
        this.key(accountId),
        JSON.stringify({ version: 1, stack: state.stack, logs: trimmed }),
      );
    } catch {
      // ignore quota/private mode errors
    }
  }

  static addFromCatalog(state: SupplementsState, catalogId: string): SupplementsState {
    const item = SUPPLEMENT_CATALOG.find((c) => c.id === catalogId);
    if (!item) return state;
    if (state.stack.some((s) => s.catalogId === catalogId)) return state;
    const added: UserSupplement = {
      id: `sup-${catalogId}-${Date.now().toString(36)}`,
      catalogId: item.id,
      name: item.name,
      category: item.category,
      dose: item.defaultDose,
      timing: item.defaultTiming,
      accent: item.accent,
      createdAt: new Date().toISOString(),
    };
    return { ...state, stack: [...state.stack, added] };
  }

  static addCustom(
    state: SupplementsState,
    input: { name: string; dose: string; timing: SupplementTiming; category: SupplementCategory; note?: string },
  ): SupplementsState {
    const name = input.name.trim();
    if (!name) return state;
    const dose = input.dose.trim() || "1 порция";
    const accentByCat: Record<SupplementCategory, string> = {
      base: "#e2441f",
      protein: "#38bdf8",
      vitamins: "#22c55e",
      performance: "#f59e0b",
    };
    const added: UserSupplement = {
      id: `sup-custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      name: name.slice(0, 80),
      category: input.category,
      dose: dose.slice(0, 40),
      timing: input.timing,
      ...(input.note?.trim() ? { note: input.note.trim().slice(0, 120) } : {}),
      accent: accentByCat[input.category],
      createdAt: new Date().toISOString(),
    };
    return { ...state, stack: [...state.stack, added] };
  }

  static update(
    state: SupplementsState,
    id: string,
    patch: Partial<Pick<UserSupplement, "name" | "dose" | "timing" | "note">>,
  ): SupplementsState {
    return {
      ...state,
      stack: state.stack.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    };
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
    return {
      ...state,
      logs: {
        ...state.logs,
        [date]: taken ? state.stack.map((s) => s.id) : [],
      },
    };
  }

  static orderedStack(stack: readonly UserSupplement[]): UserSupplement[] {
    return [...stack].sort(
      (a, b) => TIMING_ORDER[a.timing] - TIMING_ORDER[b.timing] || a.name.localeCompare(b.name, "ru"),
    );
  }

  static summary(state: SupplementsState, today: string) {
    const total = state.stack.length;
    const validIds = new Set(state.stack.map((s) => s.id));
    const takenSet = new Set((state.logs[today] ?? []).filter((id) => validIds.has(id)));
    const taken = takenSet.size;
    const ratio = total > 0 ? taken / total : 0;

    // 7-дневная лента приверженности
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const date = addCalendarDays(today, -(6 - i));
      const count = (state.logs[date] ?? []).filter((id) => validIds.has(id)).length;
      const done = total > 0 && count >= total;
      const partial = total > 0 && count > 0 && count < total;
      return { date, count, total, done, partial };
    });

    // Серия дней подряд (если сегодня ещё не всё принято, считаем от вчера)
    let streak = 0;
    if (total > 0) {
      let cursor = taken >= total ? today : addCalendarDays(today, -1);
      for (let i = 0; i < 120; i++) {
        const count = (state.logs[cursor] ?? []).filter((id) => validIds.has(id)).length;
        if (count >= total) {
          streak += 1;
          cursor = addCalendarDays(cursor, -1);
        } else {
          break;
        }
      }
    }

    return {
      total,
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
