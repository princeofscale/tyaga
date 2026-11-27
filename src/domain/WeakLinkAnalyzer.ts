import { AnalyticsFacts } from "./AnalyticsFacts";
import { OneRepMaxFormulas } from "./OneRepMaxFormulas";
import { addCalendarDays, browserTimeZone, localDate } from "../lib/calendar";
import { exerciseForEntry } from "../lib/catalog";
import type { Workout, WorkoutExercise } from "../lib/types";

export type PatternKey = "bench" | "row" | "ohp" | "vpull" | "squat" | "hinge";

export type BalanceAxisId =
  | "row_vs_bench"
  | "ohp_vs_bench"
  | "vpull_vs_bench"
  | "squat_vs_bench"
  | "hinge_vs_squat"
  | "row_vs_ohp";

export type AxisStatus = "balanced" | "lagging" | "dominant" | "missing";

export interface PatternBest {
  key: PatternKey;
  label: string;
  e1rmKg: number | null;
  sourceName: string | null;
  estimated: boolean;
}

export interface BalanceAxis {
  id: BalanceAxisId;
  label: string;
  shortLabel: string;
  numeratorKey: PatternKey;
  denominatorKey: PatternKey;
  numeratorE1rm: number | null;
  denominatorE1rm: number | null;
  ratio: number | null;
  targetMin: number;
  targetIdeal: number;
  targetMax: number;
  /** Нормализованный балл 0..100 для паутины (100 = ровно в оптимальном коридоре). */
  score: number;
  status: AxisStatus;
  diagnosis: string;
  fixHint: string;
  recommendedExerciseIds: string[];
}

export interface WeakLinkReport {
  symmetryScore: number | null;
  measuredAxes: number;
  totalAxes: number;
  longLeversAdjusted: boolean;
  patterns: Record<PatternKey, PatternBest>;
  axes: BalanceAxis[];
  primaryWeakLink: BalanceAxis | null;
  headline: string;
}

const PATTERN_LABELS: Record<PatternKey, string> = {
  bench: "Жим лёжа",
  row: "Тяга в горизонте",
  ohp: "Жим стоя",
  vpull: "Подтягивания / тяга сверху",
  squat: "Присед",
  hinge: "Становая / РДЛ",
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface PatternMatch {
  pattern: PatternKey;
  scale: number;
  estimated: boolean;
  priority: number; // higher = more direct canonical lift
}

/**
 * ООП-анализатор биомеханических пропорций силы и детектор слабых звеньев.
 * Оценивает 6 ключевых соотношений по e1RM с поправкой на длинные рычаги.
 */
export class WeakLinkAnalyzer {
  private readonly workouts: readonly Workout[];
  private readonly timeZone: string;
  private readonly today: string;
  private readonly bodyMassKg: number;
  private readonly longLevers: boolean;
  private readonly now: Date;

  constructor(
    workouts: readonly Workout[],
    options: {
      timeZone?: string;
      today?: string;
      bodyMassKg?: number | null;
      longLevers?: boolean;
      now?: Date;
    } = {},
  ) {
    this.workouts = workouts;
    this.timeZone = options.timeZone ?? browserTimeZone();
    this.now = options.now ?? new Date();
    this.today = options.today ?? localDate(this.now, this.timeZone);
    this.bodyMassKg =
      typeof options.bodyMassKg === "number" && Number.isFinite(options.bodyMassKg) && options.bodyMassKg >= 35
        ? options.bodyMassKg
        : 78;
    this.longLevers = options.longLevers === true;
  }

  /** Матчит упражнение на один из 6 базовых паттернов движения с коэффициентом пересчёта. */
  private static matchPattern(entry: WorkoutExercise): PatternMatch | null {
    const def = exerciseForEntry(entry);
    const id = entry.exerciseId;
    const fam = def?.familyId ?? "";

    // 1. Жим лёжа
    if (id === "bench") return { pattern: "bench", scale: 1.0, estimated: false, priority: 3 };
    if (id === "incline-bar") return { pattern: "bench", scale: 1.15, estimated: true, priority: 2 };
    if (id === "flat-db-press" || id === "incline-db") {
      // Для гантелей записывается вес одной гантели -> суммарно ~2× с поправкой на стабилизацию
      const perHand = def?.recording.loadMode === "per_implement";
      return { pattern: "bench", scale: perHand ? 2.15 : 1.1, estimated: true, priority: 1 };
    }

    // 2. Горизонтальная тяга
    if (id === "row" || id === "row-bent-bar" || id === "row-yates") {
      return { pattern: "row", scale: 1.0, estimated: false, priority: 3 };
    }
    if (id === "row-v-grip" || id === "row-cable" || id === "row-chest-supported") {
      return { pattern: "row", scale: 1.0, estimated: false, priority: 2 };
    }
    if (fam === "horizontal-row") {
      const perHand = def?.recording.loadMode === "per_implement";
      return { pattern: "row", scale: perHand ? 2.0 : 1.0, estimated: true, priority: 1 };
    }

    // 3. Жим стоя
    if (id === "ohp-bar" || id === "ohp") {
      const perHand = def?.recording.loadMode === "per_implement";
      return { pattern: "ohp", scale: perHand ? 2.05 : 1.0, estimated: perHand, priority: perHand ? 2 : 3 };
    }
    if (fam === "overhead-press") {
      const perHand = def?.recording.loadMode === "per_implement";
      return { pattern: "ohp", scale: perHand ? 2.05 : 0.95, estimated: true, priority: 1 };
    }

    // 4. Вертикальная тяга / подтягивания
    if (id === "pullup-weighted" || id === "pullup" || id === "chinup") {
      return { pattern: "vpull", scale: 1.0, estimated: false, priority: 3 };
    }
    if (id === "lat-pulldown" || fam === "vertical-pull") {
      return { pattern: "vpull", scale: 1.0, estimated: id !== "lat-pulldown", priority: 2 };
    }

    // 5. Присед
    if (id === "squat") return { pattern: "squat", scale: 1.0, estimated: false, priority: 3 };
    if (id === "hack-squat") return { pattern: "squat", scale: 0.9, estimated: true, priority: 2 };
    if (id === "legpress") return { pattern: "squat", scale: 0.55, estimated: true, priority: 1 };

    // 6. Задняя цепь (Становая / РДЛ)
    if (id === "deadlift-bar" || id === "deadlift" || id === "trap-bar-deadlift") {
      return { pattern: "hinge", scale: 1.0, estimated: false, priority: 3 };
    }
    if (id === "rdl" || id === "deadlift-stiff") {
      return { pattern: "hinge", scale: 1.22, estimated: true, priority: 2 };
    }
    if (id === "db-rdl") {
      const perHand = def?.recording.loadMode === "per_implement";
      return { pattern: "hinge", scale: perHand ? 2.35 : 1.25, estimated: true, priority: 1 };
    }

    return null;
  }

  /** Считает эффективный e1RM подхода с учётом веса тела для подтягиваний. */
  private effectiveSetE1rm(entry: WorkoutExercise, weight: number, reps: number): number {
    const def = exerciseForEntry(entry);
    const loadMode = def?.recording.loadMode;
    let totalLoad = weight;
    if (loadMode === "bodyweight") {
      totalLoad = this.bodyMassKg;
    } else if (loadMode === "added_bodyweight") {
      totalLoad = this.bodyMassKg + Math.max(0, weight);
    } else if (loadMode === "assisted_bodyweight") {
      totalLoad = Math.max(15, this.bodyMassKg - Math.max(0, weight));
    }
    if (totalLoad <= 0 || reps < 1 || reps > 15) return 0;
    return OneRepMaxFormulas.round(OneRepMaxFormulas.epley(totalLoad, reps));
  }

  private extractPatterns(): Record<PatternKey, PatternBest> {
    const eligible = new AnalyticsFacts([...this.workouts], {
      now: this.now,
      timeZone: this.timeZone,
    }).workouts();

    // Берём окно 120 дней, если есть свежие тренировки; иначе всю историю
    const cutoff = addCalendarDays(this.today, -120);
    const recent = eligible.filter((w) => w.date >= cutoff);
    const source = recent.length >= 2 ? recent : eligible;

    const best = new Map<PatternKey, { e1rm: number; priority: number; name: string; estimated: boolean }>();

    for (const w of source) {
      for (const entry of w.exercises) {
        const match = WeakLinkAnalyzer.matchPattern(entry);
        if (!match) continue;
        const def = exerciseForEntry(entry);
        let entryBest = 0;
        for (const s of entry.sets) {
          if (!s.done || s.warmup) continue;
          const raw = this.effectiveSetE1rm(entry, s.weight, s.reps);
          const scaled = raw * match.scale;
          if (scaled > entryBest) entryBest = scaled;
        }
        if (entryBest <= 0) continue;

        const cur = best.get(match.pattern);
        const name = entry.displayNameSnapshot ?? def?.name ?? entry.exerciseId;
        // Прямое базовое движение (priority 3) имеет приоритет над оценкой по подсобке (priority 1)
        if (!cur || match.priority > cur.priority || (match.priority === cur.priority && entryBest > cur.e1rm)) {
          best.set(match.pattern, {
            e1rm: round1(entryBest),
            priority: match.priority,
            name,
            estimated: match.estimated,
          });
        }
      }
    }

    const keys: PatternKey[] = ["bench", "row", "ohp", "vpull", "squat", "hinge"];
    const result = {} as Record<PatternKey, PatternBest>;
    for (const key of keys) {
      const found = best.get(key);
      result[key] = {
        key,
        label: PATTERN_LABELS[key],
        e1rmKg: found?.e1rm ?? null,
        sourceName: found?.name ?? null,
        estimated: found?.estimated ?? false,
      };
    }
    return result;
  }

  /** Преобразует соотношение в балл 0..100 (100 в коридоре [min..max], мягкий спад при отклонении). */
  private static scoreRatio(ratio: number, min: number, ideal: number, max: number): { score: number; status: AxisStatus } {
    if (ratio >= min && ratio <= max) {
      // Внутри нормы: 88..100
      const dist = Math.abs(ratio - ideal) / Math.max(0.05, Math.max(ideal - min, max - ideal));
      return { score: Math.round(100 - dist * 12), status: "balanced" };
    }
    if (ratio < min) {
      const deficitPct = (min - ratio) / Math.max(0.1, min);
      return {
        score: Math.max(22, Math.round(84 - deficitPct * 120)),
        status: "lagging",
      };
    }
    // Превышение верхней границы: доминирует числитель (значит знаменатель отстаёт)
    const excessPct = (ratio - max) / Math.max(0.1, max);
    return {
      score: Math.max(30, Math.round(86 - excessPct * 95)),
      status: "dominant",
    };
  }

  build(): WeakLinkReport {
    const patterns = this.extractPatterns();
    const ll = this.longLevers;

    const specs: Array<{
      id: BalanceAxisId;
      label: string;
      shortLabel: string;
      num: PatternKey;
      den: PatternKey;
      min: number;
      ideal: number;
      max: number;
      lagText: string;
      lagFix: string;
      lagIds: string[];
      domText: string;
      domFix: string;
      domIds: string[];
    }> = [
      {
        id: "row_vs_bench",
        label: "Тяга к поясу / Жим лёжа",
        shortLabel: "Тяга / Жим",
        num: "row",
        den: "bench",
        min: 0.8,
        ideal: 0.9,
        max: 1.05,
        lagText: "Горизонтальная тяга отстаёт от жима — плечи тянет вперёд, жим упирается в нестабильную спину.",
        lagFix: "Добавь 3–4 подхода тяги в наклоне или тяги блока к поясу + Face Pull.",
        lagIds: ["row", "row-v-grip", "facepull-er"],
        domText: "Спина заметно сильнее груди — отличный запас стабильности, можно смелее грузить жимы.",
        domFix: "Сделай упор на жим лёжа и жим гантелей на наклонной.",
        domIds: ["bench", "incline-db"],
      },
      {
        id: "ohp_vs_bench",
        label: "Жим стоя / Жим лёжа",
        shortLabel: "Плечи / Жим",
        num: "ohp",
        den: "bench",
        min: ll ? 0.57 : 0.6,
        ideal: ll ? 0.63 : 0.66,
        max: 0.74,
        lagText: "Передняя дельта и верх груди слабее жима лёжа — срыв со дна и дожим теряют мощность.",
        lagFix: "Подключи армейский жим и жим на наклонной 30°.",
        lagIds: ["ohp-bar", "incline-db", "lateral"],
        domText: "Вертикальный жим очень силён относительно жима лёжа — грудные недогружены.",
        domFix: "Усиль жим лёжа с паузой и сведения на грудь.",
        domIds: ["bench", "high-cable-fly"],
      },
      {
        id: "vpull_vs_bench",
        label: "Подтягивания / Жим лёжа",
        shortLabel: "Широчайшие",
        num: "vpull",
        den: "bench",
        min: 0.85,
        ideal: 0.95,
        max: 1.15,
        lagText: "Вертикальная тяга уступает жиму — широчайшие недостаточно держат лопатку под тяжёлой штангой.",
        lagFix: "Прогрессируй в подтягиваниях с весом или тяге верхнего блока.",
        lagIds: ["pullup", "lat-pulldown"],
        domText: "Отличные широчайшие и верх спины относительно жима.",
        domFix: "Поддерживай объём спины и сфокусируйся на прогрессии в жимах.",
        domIds: ["bench", "dip-weighted"],
      },
      {
        id: "squat_vs_bench",
        label: "Присед / Жим лёжа",
        shortLabel: "Ноги / Верх",
        num: "squat",
        den: "bench",
        min: ll ? 1.18 : 1.25,
        ideal: ll ? 1.27 : 1.35,
        max: 1.5,
        lagText: ll
          ? "Ноги отстают от верха даже с поправкой на длинное бедро."
          : "Низ тела отстаёт от верха — классический перекос в сторону жимовых дней.",
        lagFix: "Приоритет приседу (или гакку/жиму ногами) в начале недели, 12–16 подходов на квадрицепс.",
        lagIds: ["squat", "legpress", "bulgarian-split-squat"],
        domText: "Очень сильные ноги относительно верха тела.",
        domFix: "Добавь объём на грудь и трицепс, чтобы подтянуть жимовую базу.",
        domIds: ["bench", "incline-db", "dip-weighted"],
      },
      {
        id: "hinge_vs_squat",
        label: "Становая (РДЛ) / Присед",
        shortLabel: "Задняя цепь",
        num: "hinge",
        den: "squat",
        min: ll ? 1.2 : 1.15,
        ideal: ll ? 1.3 : 1.23,
        max: ll ? 1.45 : 1.35,
        lagText: "Задняя цепь (бицепс бедра и ягодицы) отстаёт от квадрицепсов — это тормозит присед и грузит колени.",
        lagFix: "Усиль румынскую тягу и сгибания ног сидя в полной амплитуде.",
        lagIds: ["rdl", "legcurl-seated", "barbell-hip-thrust"],
        domText: "Задняя цепь заметно сильнее квадрицепсов — присед упирается в срыв снизу.",
        domFix: "Добавь присед с паузой, болгарские выпады или жим ногами в глубокую амплитуду.",
        domIds: ["squat", "bulgarian-split-squat", "leg-extension"],
      },
      {
        id: "row_vs_ohp",
        label: "Тяга к поясу / Жим стоя",
        shortLabel: "Осанка",
        num: "row",
        den: "ohp",
        min: 1.2,
        ideal: 1.38,
        max: 1.6,
        lagText: "Средняя трапеция и ромбовидные слабее вертикального жима — плечи устают раньше времени.",
        lagFix: "Добавь тягу к груди широким хватом и отведения на заднюю дельту.",
        lagIds: ["row-v-grip", "rear-delt-fly", "facepull-er"],
        domText: "Сильная средняя спина относительно жима стоя — хороший фундамент для роста плеч.",
        domFix: "Подтяни армейский жим и махи на среднюю дельту.",
        domIds: ["ohp-bar", "lateral-cable-single"],
      },
    ];

    const axes: BalanceAxis[] = specs.map((spec) => {
      const n = patterns[spec.num].e1rmKg;
      const d = patterns[spec.den].e1rmKg;
      if (n === null || d === null || d <= 0) {
        return {
          id: spec.id,
          label: spec.label,
          shortLabel: spec.shortLabel,
          numeratorKey: spec.num,
          denominatorKey: spec.den,
          numeratorE1rm: n,
          denominatorE1rm: d,
          ratio: null,
          targetMin: spec.min,
          targetIdeal: spec.ideal,
          targetMax: spec.max,
          score: 0,
          status: "missing",
          diagnosis: `Нужны записи для «${PATTERN_LABELS[spec.num]}» и «${PATTERN_LABELS[spec.den]}».`,
          fixHint: "Запиши оба движения в дневнике — радар пересчитается автоматически.",
          recommendedExerciseIds: spec.lagIds,
        };
      }

      const ratio = round2(n / d);
      const { score, status } = WeakLinkAnalyzer.scoreRatio(ratio, spec.min, spec.ideal, spec.max);
      const diagnosis =
        status === "balanced"
          ? "В оптимальном биомеханическом коридоре."
          : status === "lagging"
            ? spec.lagText
            : spec.domText;
      const fixHint =
        status === "balanced"
          ? "Сохраняй текущий баланс объёма между этими движениями."
          : status === "lagging"
            ? spec.lagFix
            : spec.domFix;
      const recommendedExerciseIds = status === "dominant" ? spec.domIds : spec.lagIds;

      return {
        id: spec.id,
        label: spec.label,
        shortLabel: spec.shortLabel,
        numeratorKey: spec.num,
        denominatorKey: spec.den,
        numeratorE1rm: n,
        denominatorE1rm: d,
        ratio,
        targetMin: spec.min,
        targetIdeal: spec.ideal,
        targetMax: spec.max,
        score,
        status,
        diagnosis,
        fixHint,
        recommendedExerciseIds,
      };
    });

    const measured = axes.filter((a) => a.status !== "missing");
    const symmetryScore = measured.length
      ? Math.round(measured.reduce((sum, a) => sum + a.score, 0) / measured.length)
      : null;

    const nonBalanced = measured
      .filter((a) => a.status !== "balanced")
      .sort((a, b) => a.score - b.score);
    const primaryWeakLink = nonBalanced[0] ?? null;

    let headline = "Запиши базовые движения, чтобы построить карту пропорций силы";
    if (measured.length > 0) {
      if (!primaryWeakLink) {
        headline =
          measured.length >= 4
            ? "Силовые пропорции в балансе — явных слабых звеньев нет"
            : "Измеренные пары в балансе — добавь ещё базовых движений для полной картины";
      } else {
        headline = `Главное слабое звено: ${primaryWeakLink.label} (${primaryWeakLink.ratio?.toFixed(2)} при норме ${primaryWeakLink.targetMin.toFixed(2)}–${primaryWeakLink.targetMax.toFixed(2)})`;
      }
    }

    return {
      symmetryScore,
      measuredAxes: measured.length,
      totalAxes: axes.length,
      longLeversAdjusted: this.longLevers,
      patterns,
      axes,
      primaryWeakLink,
      headline,
    };
  }
}
