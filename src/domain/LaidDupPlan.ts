import { addCalendarDays } from "../lib/calendar";
import { MUSCLES } from "../data/muscles";
import { PeriodizationRules } from "./PeriodizationRules";
import { SubstitutionPolicy, type PrescriptionMode, type SubstitutionClass } from "./SubstitutionPolicy";
import { estimatedOneRepMax, exerciseById, exerciseForEntry, makeExerciseEntry, makeSets } from "../lib/model";
import { quantity } from "../lib/quantity";
import type {
  LaidDay,
  LaidMaxes,
  Muscle,
  Routine,
  RoutinePeriodization,
  SetEntry,
  Workout,
  WorkoutExercise,
} from "../lib/types";

export type { LaidDay };
export type LaidLift = keyof LaidMaxes;
export type LaidRhythm = "6x1" | "3x1x3";
export type LaidSubstitutions = Record<string, string>;
/** Слот недели (0 — Пн … 6 — Вс): один из шести дней цикла или выходной (`null`). */
export type LaidWeekSlot = LaidDay | null;
export const LAID_WEEKS = 9;
/** Недель в одной волне: три волны по три недели. */
const WAVE_WEEKS = 3;
const MAX_KG = PeriodizationRules.MAX_KG;

const AXIAL_FAMILIES = new Set([
  "squat",
  "hip-hinge",
  "overhead-press",
  "horizontal-row-free",
  "horizontal-row",
  "loaded-carry",
]);

function isAxialExercise(exerciseId: string): boolean {
  const def = exerciseById(exerciseId);
  if (!def) return false;
  if (def.recording.loadMode === "machine_stack" || def.recording.loadMode === "bodyweight" || def.recording.loadMode === "assisted_bodyweight")
    return false;
  if (def.id.includes("chest-supported") || def.id.includes("seal") || def.id.includes("legpress") || def.id.includes("hip-thrust") || def.id.includes("belt-squat"))
    return false;
  if (AXIAL_FAMILIES.has(def.familyId)) {
    return def.equipment === "gym" || def.recording.loadMode === "total_external";
  }
  return false;
}

/** Позиция недели в цикле: `raw` — номер недели от старта (0 — первая; < 0 до старта, ≥ 9 после цикла). */
export type LaidPosition = {
  raw: number;
  /** Неделя схемы: 0…8; до старта — первая, после цикла — девятая. */
  week: number;
  wave: 1 | 2 | 3;
  /** Неделя внутри волны: 0, 1, 2. */
  inWave: 0 | 1 | 2;
  finished: boolean;
  beforeStart: boolean;
};

type HeavyScheme = 1 | 3 | 5;
type WorkReps = 2 | 4 | 6 | 8 | 10 | 12;
/** Схема дня по неделе волны: повторения тяжёлого подхода и четырёх рабочих. */
type DayScheme = { heavy: [HeavyScheme, HeavyScheme, HeavyScheme]; work: [WorkReps, WorkReps, WorkReps] };

export type LaidPlanSet = { reps: number; percent: number; weightKg: number };
export type LaidDayPlan = {
  day: LaidDay;
  position: LaidPosition;
  lift: LaidLift;
  liftExerciseId: string;
  originalLiftExerciseId: string;
  prescriptionMode: PrescriptionMode;
  subClass: SubstitutionClass;
  painFlag: boolean;
  maxKg: number;
  heavy: LaidPlanSet & { light: boolean };
  work: LaidPlanSet & { sets: number; light?: boolean };
};

/** Автоматическое обновление максимумов: какие лифты и на сколько выросли, с какой недели действует. */
export type LaidAutoUpdate = {
  maxes: LaidMaxes;
  applied: { lift: LaidLift; from: number; estimate: number; to: number }[];
  fromWeek: number;
};

export type LaidExerciseSpec = {
  exerciseId: string;
  role: "lift" | "wave-aux" | "aux" | "added";
  setsLabel: string;
  intensityLabel: string;
  note?: string;
  added: boolean;
  replacedFrom?: string;
};

export type LaidSlotInfo = {
  originalId: string;
  resolvedId: string;
  role: "lift" | "wave-aux" | "aux" | "added";
  lift?: LaidLift;
  days: LaidDay[];
  weeklySets: number;
  replaced: boolean;
};

export type LaidVolumeSummary = {
  totalSets: number;
  axialSets: number;
  muscles: { id: Muscle; name: string; sets: number }[];
};

type Aux = {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** Повторения зависят от недели волны (push press, жим на наклонной). */
  byWave?: [number, number, number];
  note?: string;
};
type Layout = { aux: Aux[]; extras: Aux[] };

const a = (exerciseId: string, repMin = 10, repMax = repMin, sets = 3, note?: string): Aux => ({
  exerciseId,
  sets,
  repMin,
  repMax,
  ...(note ? { note } : {}),
});

const LEGS_1_AUX = [
  a("rdl", 10, 10, 3, "Тазобедренный шарнир с акцентом на растяжение бицепса бедра"),
  a("lunge-bar", 10, 10, 3, "10 повторений на каждую ногу"),
  a("legcurl-seated", 10, 12, 3, "Замена GHR из таблицы для обычного зала: сгибание колена без осевой нагрузки на поясницу"),
];
const LEGS_2_AUX = [
  a("rdl", 10, 10, 3, "Контролируемое опускание, без рывка с нижней точки"),
  a("lunge-bar", 10, 10, 3, "10 повторений на каждую ногу"),
  a("legcurl-prone", 10, 12, 3, "Замена GHR: сгибание колена лёжа, без осевой нагрузки на поясницу; второй вариант того же движения"),
];
const PULL_AUX = [
  a("deadlift-stiff", 10, 10, 3, "По таблице Лейда — с возвышения 5–7 см (2–3″); при усталости поясницы работай с пола"),
  a("pullup-weighted", 8, 10, 3, "Добавляй вес на пояс по мере сил"),
  a("row-yates", 10, 10, 3, "Наклон ~45°, обратный хват к низу живота"),
  a("shrug-bar", 10, 10, 3),
  a("curl-bar", 10, 10, 3),
  a("hammer-seated", 10, 10, 3),
];

/**
 * Программа Дэвида Лейда (DUP, 9 недель, 6 дней) по распространяемой таблице `David Laid DUP Program.xlsx`.
 * Схема недель и волн — по таблице; порядок упражнений Push 2 сверен с листом оригинала; GHR/Reverse Hyper адаптированы
 * под коммерческий зал сгибаниями ног (коленный сустав без перегрузки разгибателей спины), а отключаемый блок добавок закрывает
 * недостающее в таблице: заднюю дельту, объём средней дельты (там всего 6 подходов махов в неделю), икры и пресс. Чистая логика: ни хранилища, ни React.
 */
export class LaidDupPlan {
  static readonly DAYS: LaidDay[] = PeriodizationRules.DAYS;
  static readonly REST_SECONDS = 180;
  static readonly NAMES: Record<LaidDay, string> = {
    legs1: "Лейд · Ноги 1",
    push1: "Лейд · Жим 1",
    pull1: "Лейд · Тяга 1",
    legs2: "Лейд · Ноги 2",
    push2: "Лейд · Жим 2",
    pull2: "Лейд · Тяга 2",
  };
  /** Короткие названия дней для расписания. */
  static readonly SHORT: Record<LaidDay, string> = {
    legs1: "Ноги 1",
    push1: "Жим 1",
    pull1: "Тяга 1",
    legs2: "Ноги 2",
    push2: "Жим 2",
    pull2: "Тяга 2",
  };
  static readonly ORIGINAL: Record<LaidDay, string> = {
    legs1: "Legs 1",
    push1: "Push 1",
    pull1: "Pull 1",
    legs2: "Legs 2",
    push2: "Push 2",
    pull2: "Pull 2",
  };
  /** День недели по умолчанию (0 — понедельник): Пн–Сб подряд. */
  static readonly WEEKDAY: Record<LaidDay, number> = { legs1: 0, push1: 1, pull1: 2, legs2: 3, push2: 4, pull2: 5 };
  /** Варианты раскладки по неделе: классика Пн–Сб или 3+1+3 с отдыхом в четверг между Тягой 1 и Ногами 2. */
  static readonly RHYTHM_WEEKDAYS: Record<LaidRhythm, Record<LaidDay, number>> = {
    "6x1": LaidDupPlan.WEEKDAY,
    "3x1x3": { legs1: 0, push1: 1, pull1: 2, legs2: 4, push2: 5, pull2: 6 },
  };
  /** Семь слотов недели (Пн–Вс) для выбранного ритма: шесть тренировок и один выходной (`null`). */
  static slotsForRhythm(rhythm: LaidRhythm): LaidWeekSlot[] {
    const slots: LaidWeekSlot[] = Array.from({ length: 7 }, () => null);
    const map = LaidDupPlan.RHYTHM_WEEKDAYS[rhythm];
    for (const day of LaidDupPlan.DAYS) slots[map[day]] = day;
    return slots;
  }
  /** Карта «день цикла → день недели (0–6)» по семи слотам недели. */
  static weekdaysFromSlots(slots: readonly LaidWeekSlot[]): Record<LaidDay, number> {
    const out: Partial<Record<LaidDay, number>> = {};
    slots.forEach((slot, weekday) => {
      if (slot && weekday >= 0 && weekday <= 6 && out[slot] === undefined) out[slot] = weekday;
    });
    for (const day of LaidDupPlan.DAYS) {
      if (out[day] === undefined) out[day] = LaidDupPlan.WEEKDAY[day];
    }
    return out as Record<LaidDay, number>;
  }
  /** Текущая раскладка цикла по семи дням недели (Пн–Вс); коллизии или пустые дни аккуратно раскладываются в свободные слоты. */
  static slotsFromCycle(cycle: readonly Routine[]): LaidWeekSlot[] {
    const slots: LaidWeekSlot[] = Array.from({ length: 7 }, () => null);
    const unplaced: LaidDay[] = [];
    const byDay = new Map<LaidDay, Routine>();
    for (const r of cycle) {
      const p = LaidDupPlan.periodizationOf(r);
      if (p && !byDay.has(p.day)) byDay.set(p.day, r);
    }
    for (const day of LaidDupPlan.DAYS) {
      const r = byDay.get(day);
      const preferred = r?.days.length ? r.days[0] : LaidDupPlan.WEEKDAY[day];
      if (preferred >= 0 && preferred <= 6 && slots[preferred] === null) slots[preferred] = day;
      else unplaced.push(day);
    }
    for (const day of unplaced) {
      const free = slots.indexOf(null);
      if (free !== -1) slots[free] = day;
    }
    return slots;
  }
  /** Переставить слот недели с `fromIndex` на `toIndex` (вставка со сдвигом остальных дней). */
  static moveSlot(slots: readonly LaidWeekSlot[], fromIndex: number, toIndex: number): LaidWeekSlot[] {
    const from = Math.max(0, Math.min(slots.length - 1, Math.trunc(fromIndex)));
    const to = Math.max(0, Math.min(slots.length - 1, Math.trunc(toIndex)));
    if (from === to) return [...slots];
    const next = [...slots];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  }
  /** Поменять два дня недели местами. */
  static swapSlots(slots: readonly LaidWeekSlot[], a: number, b: number): LaidWeekSlot[] {
    if (a === b || a < 0 || b < 0 || a >= slots.length || b >= slots.length) return [...slots];
    const next = [...slots];
    [next[a], next[b]] = [next[b], next[a]];
    return next;
  }
  /** Назначить тренировку `day` на день недели `targetWeekday`, поменяв её местами с тем, что стояло там раньше. */
  static assignDay(slots: readonly LaidWeekSlot[], day: LaidDay, targetWeekday: number): LaidWeekSlot[] {
    const from = slots.indexOf(day);
    if (from === -1 || targetWeekday < 0 || targetWeekday >= slots.length) return [...slots];
    return LaidDupPlan.swapSlots(slots, from, targetWeekday);
  }
  /** Совпадает ли текущая раскладка с одним из готовых ритмов или настроена вручную. */
  static matchingRhythm(slots: readonly LaidWeekSlot[]): LaidRhythm | "custom" {
    for (const rhythm of ["6x1", "3x1x3"] as const) {
      const preset = LaidDupPlan.slotsForRhythm(rhythm);
      if (preset.length === slots.length && preset.every((slot, idx) => slot === slots[idx])) return rhythm;
    }
    return "custom";
  }
  /** Индекс дня отдыха в раскладке (`0..6`) или `null`, если выходного нет. */
  static restWeekday(slots: readonly LaidWeekSlot[]): number | null {
    const idx = slots.indexOf(null);
    return idx === -1 ? null : idx;
  }
  /** Ненавязчивые подсказки о восстановлении, если парные дни (Ноги 1/2, Жим 1/2, Тяга 1/2) стоят подряд; ничего не запрещают. */
  static backToBackNotice(slots: readonly LaidWeekSlot[], dayNames: readonly string[]): string[] {
    const pairs: [LaidDay, LaidDay, string][] = [
      ["legs1", "legs2", "присед два дня подряд"],
      ["push1", "push2", "жимы два дня подряд"],
      ["pull1", "pull2", "становая два дня подряд"],
    ];
    const notes: string[] = [];
    for (const [a, b, reason] of pairs) {
      const ia = slots.indexOf(a);
      const ib = slots.indexOf(b);
      if (ia === -1 || ib === -1) continue;
      const adjacent = Math.abs(ia - ib) === 1 || (ia === 0 && ib === 6) || (ia === 6 && ib === 0);
      if (!adjacent) continue;
      const first = (ia === 6 && ib === 0) ? ia : (ib === 6 && ia === 0) ? ib : Math.min(ia, ib);
      const second = first === ia ? ib : ia;
      notes.push(
        `${LaidDupPlan.SHORT[slots[first]!]} и ${LaidDupPlan.SHORT[slots[second]!]} стоят подряд (${dayNames[first]}–${dayNames[second]}) — ${reason}, следи за восстановлением.`,
      );
    }
    return notes;
  }
  /** Первый назначенный день недели программы (`0..6`), или `7`, если дни не заданы. */
  static weekdayOf(routine: Routine): number {
    return routine.days.length ? Math.min(...routine.days) : 7;
  }
  private static compareCycleRoutines(x: Routine, y: Routine): number {
    const dx = LaidDupPlan.weekdayOf(x) - LaidDupPlan.weekdayOf(y);
    if (dx !== 0) return dx;
    return (
      LaidDupPlan.DAYS.indexOf(LaidDupPlan.periodizationOf(x)!.day) -
      LaidDupPlan.DAYS.indexOf(LaidDupPlan.periodizationOf(y)!.day)
    );
  }
  /**
   * Обновить дни недели цикла: возвращает только те программы, у которых изменились дни или очистились устаревшие
   * будущие разовые переносы. Выполненные и прошлые переносы сохраняются нетронутыми.
   */
  static withWeekdays(
    cycle: readonly Routine[],
    weekdays: Record<LaidDay, number>,
    workouts: readonly Workout[],
    today: string,
  ): Routine[] {
    const changed: Routine[] = [];
    for (const r of cycle) {
      const p = LaidDupPlan.periodizationOf(r);
      if (!p) continue;
      const targetDay = weekdays[p.day];
      if (!Number.isInteger(targetDay) || targetDay < 0 || targetDay > 6) continue;
      const overrides = r.occurrenceOverrides ?? [];
      const kept = overrides.filter((o) => {
        if (workouts.some((w) => w.routineId === r.id && w.programDate === o.from)) return true;
        if (o.from < today && (o.to === null || o.to < today)) return true;
        const fromWeekday = (new Date(o.from + "T12:00:00Z").getUTCDay() + 6) % 7;
        return fromWeekday === targetDay;
      });
      const sameDays = r.days.length === 1 && r.days[0] === targetDay;
      const sameOverrides = kept.length === overrides.length;
      if (!sameDays || !sameOverrides) {
        changed.push({
          ...r,
          days: [targetDay],
          occurrenceOverrides: kept.length ? kept : undefined,
        });
      }
    }
    return changed.sort(LaidDupPlan.compareCycleRoutines);
  }
  static readonly WAVE_META: Record<1 | 2 | 3, { title: string; subtitle: string; range: string }> = {
    1: { title: "Втягивание", subtitle: "Стартовые проценты волны: 85 / 90 / 95 % на топ-сетах", range: "Недели 1–3" },
    2: { title: "Интенсификация", subtitle: "Рост процентов во всех схемах: 86 / 91 / 96,5 % на топ-сетах", range: "Недели 4–6" },
    3: { title: "Пик силы", subtitle: "Пиковые веса цикла: 88 / 92,5 / 97,5 % на топ-сетах", range: "Недели 7–9" },
  };
  static readonly LIFT_OF: Record<LaidDay, LaidLift> = {
    legs1: "squat",
    push1: "bench",
    pull1: "deadlift",
    legs2: "squat",
    push2: "ohp",
    pull2: "deadlift",
  };
  static readonly LIFT_EXERCISE: Record<LaidLift, string> = {
    squat: "squat",
    bench: "bench",
    deadlift: "deadlift-bar",
    ohp: "ohp-bar",
  };
  static readonly LIFT_LABEL: Record<LaidLift, string> = {
    squat: "присед",
    bench: "жим лёжа",
    deadlift: "становая",
    ohp: "армейский жим",
  };
  /** Окно «по истории ≈ N кг» (лучшая оценка 1ПМ по подходам за полгода) и окно подсказки «Можно обновить максимум». */
  static readonly ESTIMATE_DAYS = 182;
  static readonly SUGGEST_DAYS = 28;
  /** «за 26 недель», «за 28 дней»: окно в днях словами. */
  static windowText(days: number): string {
    return days % 7 === 0 && days > 28 ? `за ${quantity(days / 7, "неделю", "недели", "недель")}` : `за ${quantity(days, "день", "дня", "дней")}`;
  }
  static readonly NOTICE = "Веса восстановлены по опубликованной таблице и округлены; официальный калькулятор может дать другие числа.";
  static readonly AUTO_NOTICE = "Максимумы обновляются автоматически, когда оценка 1ПМ по свежим подходам выше действующей на 5 %.";
  static readonly LOAD_NOTICE = "Шесть тренировок в неделю и тяжёлые подходы — вводи осторожные максимумы.";
  static readonly DELOAD_NOTICE =
    "После 9-й недели проведи разгрузочную неделю (50–60 % от 1ПМ, половина подходов, запас 4 повторения) перед новым циклом.";
  static readonly MAX_KG = MAX_KG;

  private static readonly SCHEME: Record<LaidDay, DayScheme> = {
    legs1: { heavy: [5, 1, 3], work: [12, 4, 8] },
    push1: { heavy: [1, 3, 5], work: [4, 8, 12] },
    pull1: { heavy: [3, 1, 5], work: [6, 2, 10] },
    legs2: { heavy: [3, 5, 1], work: [8, 12, 4] },
    push2: { heavy: [5, 1, 3], work: [12, 4, 8] },
    pull2: { heavy: [1, 5, 3], work: [2, 10, 6] },
  };
  /** Проценты от 1ПМ по волнам (В1, В2, В3). */
  private static readonly HEAVY_PCT: Record<HeavyScheme, [number, number, number]> = {
    5: [85, 86, 88],
    3: [90, 91, 92.5],
    1: [95, 96.5, 97.5],
  };
  private static readonly WORK_PCT: Record<WorkReps, [number, number, number]> = {
    12: [65, 66, 67],
    10: [70, 71, 72],
    8: [75, 76, 77],
    6: [80, 81, 82],
    4: [85, 86, 87],
    2: [92.5, 93, 93.5],
  };
  private static readonly LAYOUT: Record<LaidDay, Layout> = {
    legs1: {
      aux: LEGS_1_AUX,
      extras: [
        a("calf-standing-machine", 12, 15, 3, "Икроножная на прямых коленях (в оригинале икр нет)"),
        a("hanging-leg-raise", 10, 15, 3, "Прямая мышца живота с подкручиванием таза"),
      ],
    },
    legs2: {
      aux: LEGS_2_AUX,
      extras: [a("calf-seated", 12, 15, 3, "Камбаловидная мышца при согнутых коленях (в оригинале икр нет)")],
    },
    push1: {
      aux: [
        { ...a("push-press", 4, 12, 3, "Повторения меняются с волной жима: 4 → 8 → 12"), byWave: [4, 8, 12] },
        a("dip-weighted", 10, 10, 3, "Дополнительный вес на поясе"),
        a("fly-db-flat", 10, 10, 3, "В таблице: разведения гантелей или пек-дек"),
        a("lateral", 10, 10, 3),
        a("skullcrusher-ez", 10, 10, 3),
        a("triceps-db", 10, 10, 3, "Акцент на длинную головку трицепса в растяжении"),
      ],
      extras: [a("lateral-cable-single", 12, 15, 3, "Постоянное натяжение средней дельты с нижнего блока")],
    },
    push2: {
      aux: [
        { ...a("incline-bar", 4, 12, 3, "Повторения меняются с волной жима стоя: 12 → 4 → 8"), byWave: [12, 4, 8] },
        a("lateral", 10, 10, 3, "Стоит перед брусьями по оригиналу — даёт передышку трицепсу"),
        a("dip-weighted", 10, 10, 3, "Дополнительный вес на поясе"),
        a("triceps-db", 10, 10, 3, "В Push 2 идёт перед французским жимом по таблице"),
        a("skullcrusher-ez", 10, 10, 3),
      ],
      extras: [a("lateral-cable-single", 12, 15, 3, "Дополнительный объём средней дельты")],
    },
    pull1: {
      aux: PULL_AUX,
      extras: [a("rear-delt-fly", 12, 15, 3, "Баланс плечевого сустава под большой объём жимов")],
    },
    pull2: {
      aux: PULL_AUX,
      extras: [
        a("rear-delt-fly", 12, 15, 3, "Обратный пек-дек на заднюю дельту"),
        a("ab-roller", 8, 12, 3, "Жёсткое антиразгибание кора"),
      ],
    },
  };

  /** Ближайшие 2,5 кг; ровно посередине — большее (76,25 → 77,5; 76 → 75). */
  static roundKg(kg: number): number {
    if (!Number.isFinite(kg) || kg <= 0) return 0;
    return Math.floor(kg / 2.5 + 0.5 + 1e-9) * 2.5;
  }
  static weight(maxKg: number, percent: number): number {
    return LaidDupPlan.roundKg((maxKg * percent) / 100);
  }

  /** Номер недели от понедельника старта: с понедельника старта — 0, до него — меньше нуля. */
  static weekOf(startMonday: string, date: string): number {
    const day = (iso: string) => Math.round(new Date(iso + "T12:00:00Z").getTime() / 86_400_000);
    const monday = addCalendarDays(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
    return Math.round((day(monday) - day(startMonday)) / 7);
  }
  static position(raw: number): LaidPosition {
    const n = Number.isFinite(raw) ? Math.trunc(raw) : 0;
    const week = Math.max(0, Math.min(LAID_WEEKS - 1, n));
    return {
      raw: n,
      week,
      wave: (Math.floor(week / WAVE_WEEKS) + 1) as 1 | 2 | 3,
      inWave: (week % WAVE_WEEKS) as 0 | 1 | 2,
      finished: n >= LAID_WEEKS,
      beforeStart: n < 0,
    };
  }
  /** Понедельник «этой» или «следующей» недели от `today`. */
  static startMonday(today: string, which: "this" | "next"): string {
    const monday = addCalendarDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
    return which === "this" ? monday : addCalendarDays(monday, 7);
  }
  /** Какой старт по умолчанию предлагать сегодня: пн–ср — эта неделя, чт–вс — следующая. */
  static defaultStart(today: string): "this" | "next" {
    return (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7 <= 2 ? "this" : "next";
  }

  /** Максимумы, действующие в неделе `week` (0-based): последняя настройка, начавшаяся не позже этой недели. */
  static maxesFor(p: Pick<RoutinePeriodization, "maxes" | "maxesFromWeek" | "earlier">, week: number): LaidMaxes {
    const stages = [...(p.earlier ?? []), { fromWeek: p.maxesFromWeek, maxes: p.maxes }].sort((x, y) => x.fromWeek - y.fromWeek);
    let chosen = stages[0].maxes;
    for (const stage of stages) if (stage.fromWeek <= week) chosen = stage.maxes;
    return chosen;
  }

  /** Нормализовать карту замен: убрать пустые и самозамены; вернуть undefined, если замен нет. */
  static normalizeSubstitutions(substitutions?: LaidSubstitutions): LaidSubstitutions | undefined {
    if (!substitutions) return undefined;
    const cleaned: LaidSubstitutions = {};
    for (const [orig, repl] of Object.entries(substitutions)) {
      const from = orig.trim();
      const to = typeof repl === "string" ? repl.trim() : "";
      if (from && to && from !== to) cleaned[from] = to;
    }
    return Object.keys(cleaned).length ? cleaned : undefined;
  }

  /** Итоговый exerciseId с учётом замен цикла. */
  static resolveExerciseId(originalId: string, substitutions?: LaidSubstitutions): string {
    return substitutions?.[originalId] || originalId;
  }

  /** Итоговый exerciseId базового лифта с учётом замен цикла. */
  static liftExerciseId(lift: LaidLift, substitutions?: LaidSubstitutions): string {
    return LaidDupPlan.resolveExerciseId(LaidDupPlan.LIFT_EXERCISE[lift], substitutions);
  }

  /** Заменён ли базовый лифт на другое упражнение. */
  static isLiftSubstituted(lift: LaidLift, substitutions?: LaidSubstitutions): boolean {
    const orig = LaidDupPlan.LIFT_EXERCISE[lift];
    return !!substitutions?.[orig] && substitutions[orig] !== orig;
  }

  /** Человеческое название базового лифта: исходное («становая») или имя замены. */
  static liftLabel(lift: LaidLift, substitutions?: LaidSubstitutions): string {
    if (LaidDupPlan.isLiftSubstituted(lift, substitutions)) {
      const id = LaidDupPlan.liftExerciseId(lift, substitutions);
      return exerciseById(id)?.name ?? LaidDupPlan.LIFT_LABEL[lift];
    }
    return LaidDupPlan.LIFT_LABEL[lift];
  }

  /**
   * План одного дня: тяжёлый подход и четыре рабочих с весами, округлёнными до 2,5 кг.
   * В режиме `light` синглы (1 повтор, 95–97,5 %) заменяются тройками (90–92,5 %), а парные двойки становой (4 × 2 @ 92,5–93,5 %)
   * сдвигаются до 4 × 4 @ 85–87 %, чтобы откатные подходы никогда не оказывались тяжелее топ-сета (исправление PO-R10-08).
   */
  static day(
    day: LaidDay,
    raw: number,
    maxes: LaidMaxes,
    options: {
      light?: boolean;
      substitutions?: LaidSubstitutions;
      calibrationLifts?: readonly LaidLift[];
      painFlags?: readonly LaidLift[];
    } = {},
  ): LaidDayPlan {
    const position = LaidDupPlan.position(raw);
    const lift = LaidDupPlan.LIFT_OF[day];
    const maxKg = maxes[lift];
    const scheme = LaidDupPlan.SCHEME[day];
    const originalLiftExerciseId = LaidDupPlan.LIFT_EXERCISE[lift];
    const liftExerciseId = LaidDupPlan.resolveExerciseId(originalLiftExerciseId, options.substitutions);
    const isReplaced = liftExerciseId !== originalLiftExerciseId;
    const isCalibration = !!options.calibrationLifts?.includes(lift);
    const painFlag = !!options.painFlags?.includes(lift);

    const compat = isReplaced
      ? SubstitutionPolicy.classify(exerciseById(originalLiftExerciseId), exerciseById(liftExerciseId), {
          hasOwnHistory: !isCalibration,
          painFlag,
        })
      : {
          subClass: "A" as SubstitutionClass,
          prescriptionMode: (painFlag ? "rir_range" : isCalibration ? "calibration" : "percent_1rm") as PrescriptionMode,
          badge: "",
          summary: "",
          allowHeavySingles: !painFlag && !isCalibration,
        };

    const prescriptionMode: PrescriptionMode = painFlag
      ? "rir_range"
      : isCalibration
        ? "calibration"
        : compat.prescriptionMode;
    const noPercent = prescriptionMode !== "percent_1rm";
    const blockSingles = !!options.light || !compat.allowHeavySingles || noPercent;

    const light = blockSingles && scheme.heavy[position.inWave] === 1;
    const heavyScheme: HeavyScheme =
      prescriptionMode === "rir_range"
        ? 5
        : light
          ? 3
          : scheme.heavy[position.inWave];
    const wave = position.wave - 1;
    const heavyPercent = LaidDupPlan.HEAVY_PCT[heavyScheme][wave];
    const rawWorkReps = scheme.work[position.inWave];
    const workLight = (light && rawWorkReps === 2) || (prescriptionMode === "rir_range" && rawWorkReps < 6);
    const workReps: WorkReps =
      prescriptionMode === "rir_range" && rawWorkReps < 6
        ? 8
        : light && rawWorkReps === 2
          ? 4
          : rawWorkReps;
    const workPercent = LaidDupPlan.WORK_PCT[workReps][wave];
    return {
      day,
      position,
      lift,
      liftExerciseId,
      originalLiftExerciseId,
      prescriptionMode,
      subClass: compat.subClass,
      painFlag,
      maxKg,
      heavy: {
        reps: heavyScheme,
        percent: noPercent ? 0 : heavyPercent,
        weightKg: noPercent ? 0 : LaidDupPlan.weight(maxKg, heavyPercent),
        light: !!options.light && scheme.heavy[position.inWave] === 1,
      },
      work: {
        sets: 4,
        reps: workReps,
        percent: noPercent ? 0 : workPercent,
        weightKg: noPercent ? 0 : LaidDupPlan.weight(maxKg, workPercent),
        ...(workLight && !!options.light ? { light: true } : {}),
      },
    };
  }

  /** Недельные повторения вспомогательного (push press, наклонный жим): для остальных — null. */
  static auxReps(day: LaidDay, exerciseId: string, inWave: 0 | 1 | 2, substitutions?: LaidSubstitutions): number | null {
    const found = LaidDupPlan.LAYOUT[day].aux.find(
      (x) => LaidDupPlan.resolveExerciseId(x.exerciseId, substitutions) === exerciseId,
    );
    return found?.byWave ? found.byWave[inWave] : null;
  }
  /** Волновую подсобку дня на конкретной неделе (Push 1 — push press, Push 2 — наклонный жим), если есть. */
  static waveAuxSummary(day: LaidDay, inWave: 0 | 1 | 2, substitutions?: LaidSubstitutions): string | null {
    const found = LaidDupPlan.LAYOUT[day].aux.find((x) => x.byWave);
    if (!found?.byWave) return null;
    const resolvedId = LaidDupPlan.resolveExerciseId(found.exerciseId, substitutions);
    const label =
      resolvedId !== found.exerciseId
        ? (exerciseById(resolvedId)?.name ?? resolvedId)
        : found.exerciseId === "push-press"
          ? "Push press"
          : "Наклонный жим";
    return `${label} ${found.sets} × ${found.byWave[inWave]}`;
  }
  /** Подробная спецификация упражнения дня для расписания и разбора состава. */
  static exerciseSpec(day: LaidDay, exerciseId: string, substitutions?: LaidSubstitutions): LaidExerciseSpec {
    const originalLiftId = LaidDupPlan.LIFT_EXERCISE[LaidDupPlan.LIFT_OF[day]];
    const resolvedLiftId = LaidDupPlan.resolveExerciseId(originalLiftId, substitutions);
    if (exerciseId === resolvedLiftId) {
      const s = LaidDupPlan.SCHEME[day];
      return {
        exerciseId,
        role: "lift",
        setsLabel: `1 × (${s.heavy.join("/")}) + 4 × (${s.work.join("/")})`,
        intensityLabel: "85–97,5 % от 1ПМ · отдых 3–4 мин",
        note: "Вес и повторения меняются каждую неделю по волне DUP",
        added: false,
        ...(resolvedLiftId !== originalLiftId ? { replacedFrom: originalLiftId } : {}),
      };
    }
    const layout = LaidDupPlan.LAYOUT[day];
    const aux = layout.aux.find((x) => LaidDupPlan.resolveExerciseId(x.exerciseId, substitutions) === exerciseId);
    if (aux) {
      const repsText = aux.byWave
        ? `${aux.byWave.join(" / ")} по неделе волны`
        : aux.repMin === aux.repMax
          ? String(aux.repMin)
          : `${aux.repMin}–${aux.repMax}`;
      return {
        exerciseId,
        role: aux.byWave ? "wave-aux" : "aux",
        setsLabel: `${aux.sets} × ${repsText}`,
        intensityLabel: "RPE 8–9 · запас 1–2 повт.",
        note: aux.exerciseId === exerciseId ? aux.note : undefined,
        added: false,
        ...(aux.exerciseId !== exerciseId ? { replacedFrom: aux.exerciseId } : {}),
      };
    }
    const extra = layout.extras.find((x) => LaidDupPlan.resolveExerciseId(x.exerciseId, substitutions) === exerciseId);
    const repsText = extra ? (extra.repMin === extra.repMax ? String(extra.repMin) : `${extra.repMin}–${extra.repMax}`) : "12–15";
    return {
      exerciseId,
      role: "added",
      setsLabel: `${extra?.sets ?? 3} × ${repsText}`,
      intensityLabel: "RPE 8–9 · запас 1–2 повт.",
      note: extra && extra.exerciseId === exerciseId ? extra.note : undefined,
      added: true,
      ...(extra && extra.exerciseId !== exerciseId ? { replacedFrom: extra.exerciseId } : {}),
    };
  }
  /** Упражнения оригинального дня (включая базовое): всё, чего здесь нет, — «добавлено». */
  static originalIds(day: LaidDay, substitutions?: LaidSubstitutions): string[] {
    return [
      LaidDupPlan.resolveExerciseId(LaidDupPlan.LIFT_EXERCISE[LaidDupPlan.LIFT_OF[day]], substitutions),
      ...LaidDupPlan.LAYOUT[day].aux.map((x) => LaidDupPlan.resolveExerciseId(x.exerciseId, substitutions)),
    ];
  }
  static isAdded(day: LaidDay, exerciseId: string, substitutions?: LaidSubstitutions): boolean {
    return !LaidDupPlan.originalIds(day, substitutions).includes(exerciseId);
  }

  /** Строка плана дня: «1 × 5 × 85 кг · 4 × 12 × 65 кг» или калибровка/RIR без фиктивных процентов. */
  static line(plan: LaidDayPlan): string {
    if (plan.prescriptionMode === "calibration") {
      return `Калибровка · 1 × ${plan.heavy.reps} (RIR 2–3) · ${plan.work.sets} × ${plan.work.reps} (RIR 2)`;
    }
    if (plan.prescriptionMode === "rir_range") {
      const rirText = plan.painFlag ? "RIR 2–3 · щадяще" : "RIR 1–2";
      return `По RIR · 1 × ${plan.heavy.reps} (${rirText}) · ${plan.work.sets} × ${plan.work.reps} (RIR 2)`;
    }
    return `1 × ${plan.heavy.reps} × ${LaidDupPlan.kg(plan.heavy.weightKg)} кг · ${plan.work.sets} × ${plan.work.reps} × ${LaidDupPlan.kg(plan.work.weightKg)} кг`;
  }
  /** Короткая строка для компактных плиток дней: «85×5 · 4×12×65 кг». */
  static compactLine(plan: LaidDayPlan): string {
    if (plan.prescriptionMode === "calibration") {
      return `Калибровка · 1×${plan.heavy.reps} · ${plan.work.sets}×${plan.work.reps} (RIR 2–3)`;
    }
    if (plan.prescriptionMode === "rir_range") {
      return `По RIR · 1×${plan.heavy.reps} · ${plan.work.sets}×${plan.work.reps}`;
    }
    return `1×${plan.heavy.reps} ${LaidDupPlan.kg(plan.heavy.weightKg)} кг · ${plan.work.sets}×${plan.work.reps} ${LaidDupPlan.kg(plan.work.weightKg)} кг`;
  }
  /** Число с запятой, без лишнего нуля: 67,5; 85. */
  static kg(value: number): string {
    return String(value).replace(".", ",");
  }
  /** Подпись недели: «Неделя 4 из 9 · волна 2»; после цикла — пометка про обновление максимумов. */
  static weekLabel(position: LaidPosition): string {
    if (position.finished) return `Неделя ${position.raw + 1} · схема недели 9 · цикл закончен — обнови максимумы`;
    return `Неделя ${position.week + 1} из ${LAID_WEEKS} · волна ${position.wave}`;
  }
  /** «повторение / повторения / повторений» по числу (11–14 — «повторений»). */
  static repsWord(n: number): string {
    const last = n % 10;
    const teen = n % 100 >= 11 && n % 100 <= 14;
    return !teen && last === 1 ? "повторение" : !teen && last >= 2 && last <= 4 ? "повторения" : "повторений";
  }
  /** Начало строки плана в заметке упражнения: по ней видно, что вес подходов задан планом недели. */
  static readonly PLAN_MARK = "Тяжёлый подход:";
  /** Вес упражнения задан планом Лейда (тяжёлый подход и рабочие): «Повторить прошлые» и «+2,5 кг» его не трогают. */
  static hasPlanWeight(entry: { progressionNote?: string }): boolean {
    return typeof entry.progressionNote === "string" && entry.progressionNote.includes(LaidDupPlan.PLAN_MARK);
  }
  /** Что делает день: для заметки тяжёлого упражнения. */
  static describe(plan: LaidDayPlan): string {
    const { heavy, work } = plan;
    if (plan.prescriptionMode === "calibration") {
      return [
        `${LaidDupPlan.weekLabel(plan.position)}.`,
        `${LaidDupPlan.PLAN_MARK} калибровка 1 × ${heavy.reps} ${LaidDupPlan.repsWord(heavy.reps)} с запасом 2–3 повторения (RIR 2–3), затем ${work.sets} × ${work.reps} ${LaidDupPlan.repsWord(work.reps)} (RIR 2).`,
        "Подбери комфортный рабочий вес без привязки к старому 1ПМ — после 2 тренировок сможешь задать собственный максимум.",
      ].join(" ");
    }
    if (plan.prescriptionMode === "rir_range") {
      return [
        `${LaidDupPlan.weekLabel(plan.position)}.`,
        `${LaidDupPlan.PLAN_MARK} ${plan.painFlag ? "щадящий режим (пометка боли)" : "работа по RIR (класс C)"}: 1 × ${heavy.reps} ${LaidDupPlan.repsWord(heavy.reps)} и ${work.sets} × ${work.reps} ${LaidDupPlan.repsWord(work.reps)} с запасом ${plan.painFlag ? "2–3" : "1–2"} повт.`,
        plan.painFlag
          ? "Тяжёлые синглы 95 % и автоповышение веса отключены — ориентируйся на переносимый вес без усиления симптомов."
          : "Для этого типа движения проценты от 1ПМ неточны — прогрессируй по повторениям и RIR.",
      ].join(" ");
    }
    const replacedNote =
      plan.liftExerciseId !== plan.originalLiftExerciseId
        ? `Замена вместо «${exerciseById(plan.originalLiftExerciseId)?.name ?? LaidDupPlan.LIFT_LABEL[plan.lift]}»: волновая периодизация и проценты сохранены.`
        : "";
    return [
      `${LaidDupPlan.weekLabel(plan.position)}.`,
      `${LaidDupPlan.PLAN_MARK} 1 × ${heavy.reps} ${LaidDupPlan.repsWord(heavy.reps)} · ${LaidDupPlan.pct(heavy.percent)} % от 1ПМ (${LaidDupPlan.kg(plan.maxKg)} кг) = ${LaidDupPlan.kg(heavy.weightKg)} кг${heavy.light ? " (облегчённо, не по оригиналу)" : ""}.`,
      `Затем ${work.sets} × ${work.reps} ${LaidDupPlan.repsWord(work.reps)} · ${LaidDupPlan.pct(work.percent)} % = ${LaidDupPlan.kg(work.weightKg)} кг${work.light ? " (облегчённо)" : ""}.`,
      ...(replacedNote ? [replacedNote] : []),
    ].join(" ");
  }
  static pct(value: number): string {
    return String(value).replace(".", ",");
  }

  /** Подходы базового упражнения дня: тяжёлый и четыре рабочих (ничего не отмечено). */
  static liftSets(plan: LaidDayPlan): SetEntry[] {
    const rir = plan.prescriptionMode === "percent_1rm" ? null : 2;
    const set = (weight: number, reps: number): SetEntry => ({ id: crypto.randomUUID(), weight, reps, rir, warmup: false, done: false });
    return [set(plan.heavy.weightKg, plan.heavy.reps), ...Array.from({ length: plan.work.sets }, () => set(plan.work.weightKg, plan.work.reps))];
  }

  /** Упражнения дня для шаблона программы (веса базового — недели 1; на старте считаются заново). */
  static entries(
    day: LaidDay,
    maxes: LaidMaxes,
    options: {
      extras: boolean;
      light: boolean;
      substitutions?: LaidSubstitutions;
      calibrationLifts?: readonly LaidLift[];
      painFlags?: readonly LaidLift[];
    },
  ): WorkoutExercise[] {
    const plan = LaidDupPlan.day(day, 0, maxes, options);
    const layout = LaidDupPlan.LAYOUT[day];
    const lift = { ...makeExerciseEntry(plan.liftExerciseId), sets: LaidDupPlan.liftSets(plan) };
    const seen = new Set<string>([plan.liftExerciseId]);
    const rows: WorkoutExercise[] = [];
    for (const x of [...layout.aux, ...(options.extras ? layout.extras : [])]) {
      const resolvedId = LaidDupPlan.resolveExerciseId(x.exerciseId, options.substitutions);
      if (seen.has(resolvedId)) continue;
      seen.add(resolvedId);
      const reps = x.byWave ? x.byWave[0] : x.repMin;
      const def = exerciseById(resolvedId);
      const isDuration = def?.recording.type === "duration";
      rows.push({
        ...makeExerciseEntry(resolvedId),
        sets: makeSets(x.sets, 0, isDuration ? 0 : reps).map((s) => ({
          ...s,
          rir: null,
          ...(isDuration ? { durationSeconds: 45 } : {}),
        })),
        ...(isDuration
          ? {}
          : {
              repMin: x.byWave ? reps : x.repMin,
              repMax: x.byWave ? reps : x.repMax,
            }),
      });
    }
    return [lift, ...rows];
  }

  /** Шесть программ цикла: названия, дни недели (Пн–Сб, 3+1+3 или свой порядок), отдых 180 с, общая настройка периодизации. */
  static routines(input: {
    maxes: LaidMaxes;
    extras: boolean;
    light: boolean;
    startMonday: string;
    cycleId?: string;
    rhythm?: LaidRhythm;
    weekdays?: Partial<Record<LaidDay, number>>;
    substitutions?: LaidSubstitutions;
    calibrationLifts?: readonly LaidLift[];
    painFlags?: readonly LaidLift[];
  }): Routine[] {
    const cycleId = input.cycleId ?? crypto.randomUUID();
    const baseWeekdays = LaidDupPlan.RHYTHM_WEEKDAYS[input.rhythm ?? "6x1"];
    const weekdays: Record<LaidDay, number> = { ...baseWeekdays, ...(input.weekdays ?? {}) };
    const substitutions = LaidDupPlan.normalizeSubstitutions(input.substitutions);
    const calibrationLifts = input.calibrationLifts?.length ? [...new Set(input.calibrationLifts)] : undefined;
    const painFlags = input.painFlags?.length ? [...new Set(input.painFlags)] : undefined;
    return LaidDupPlan.DAYS.map((day) => ({
      id: crypto.randomUUID(),
      name: LaidDupPlan.NAMES[day],
      notes: `${LaidDupPlan.ORIGINAL[day]} программы Дэвида Лейда (DUP, 9 недель). Отдых на базовом движении — 3–4 мин, вспомогательные — запас 1–2 повторения (RPE 8–9).`,
      days: [weekdays[day]],
      exercises: LaidDupPlan.entries(day, input.maxes, {
        extras: input.extras,
        light: input.light,
        substitutions,
        calibrationLifts,
        painFlags,
      }),
      restSeconds: LaidDupPlan.REST_SECONDS,
      progression: "repeat" as const,
      repMin: 8,
      repMax: 12,
      incrementKg: 2.5,
      revision: 0,
      periodization: {
        kind: "laid-dup" as const,
        cycleId,
        day,
        startMonday: input.startMonday,
        maxes: { ...input.maxes },
        maxesFromWeek: 0,
        extras: input.extras,
        light: input.light,
        ...(substitutions ? { substitutions } : {}),
        ...(calibrationLifts ? { calibrationLifts } : {}),
        ...(painFlags ? { painFlags } : {}),
      },
    }));
  }

  /** Проверка введённого максимума: текст ошибки или null. */
  static checkMax(raw: string): { value: number | null; error: string | null } {
    const text = raw.trim().replace(",", ".");
    if (!text) return { value: null, error: "Введи максимум в килограммах." };
    if (!/^\d+(\.\d+)?$/.test(text)) return { value: null, error: "Максимум — число в килограммах." };
    const value = Number(text);
    if (!(value > 0)) return { value: null, error: "Максимум должен быть больше нуля." };
    if (value < 1) return { value: null, error: "Введи максимум не меньше 1 кг." };
    if (value > MAX_KG) return { value: null, error: `Максимум не больше ${MAX_KG} кг: проверь число.` };
    return { value, error: null };
  }

  /**
   * Периодизация программы, если её структура проходит те же правила, что на сервере (`PeriodizationRules`); иначе undefined —
   * программа считается обычной. Защита от данных, записанных не нашим клиентом: битое поле не должно ронять экран.
   */
  static periodizationOf(routine: Routine | null | undefined): RoutinePeriodization | undefined {
    const p = routine?.periodization as unknown;
    return p === undefined || p === null ? undefined : PeriodizationRules.check(p).ok ? (p as RoutinePeriodization) : undefined;
  }
  /** Поле есть, но структура битая (после правки программы его нужно убрать). */
  static isBroken(routine: Routine | null | undefined): boolean {
    const p = routine?.periodization as unknown;
    return p !== undefined && !PeriodizationRules.check(p).ok;
  }

  /** Те же программы цикла, что и `routine` (по общему `cycleId`). */
  static cycleOf(routines: Routine[], routine: Routine): Routine[] {
    const id = LaidDupPlan.periodizationOf(routine)?.cycleId;
    return id ? routines.filter((r) => LaidDupPlan.periodizationOf(r)?.cycleId === id) : [];
  }
  /** Цикл программы: по одному представителю каждого дня, дни — в порядке недели (Пн → Вс). */
  static cycles(routines: Routine[]): Routine[][] {
    const valid = routines.filter((r) => LaidDupPlan.periodizationOf(r));
    const ids = [...new Set(valid.map((r) => LaidDupPlan.periodizationOf(r)!.cycleId))];
    return ids.map((id) =>
      valid
        .filter((r) => LaidDupPlan.periodizationOf(r)!.cycleId === id)
        .sort(LaidDupPlan.compareCycleRoutines),
    );
  }

  /**
   * Список программ для показа: шесть программ цикла идут в порядке назначенных дней недели (Пн → Вс) на тех же местах списка,
   * остальные программы не двигаются.
   */
  static ordered(routines: Routine[]): Routine[] {
    const out = [...routines];
    const slots = new Map<string, number[]>();
    routines.forEach((r, i) => {
      const id = LaidDupPlan.periodizationOf(r)?.cycleId;
      if (id) slots.set(id, [...(slots.get(id) ?? []), i]);
    });
    for (const at of slots.values()) {
      const sorted = at.map((i) => routines[i]).sort(LaidDupPlan.compareCycleRoutines);
      at.forEach((index, k) => (out[index] = sorted[k]));
    }
    return out;
  }

  /** План дня этой программы на дату: null, если у программы нет периодизации. */
  static planFor(routine: Routine, date: string): LaidDayPlan | null {
    const p = LaidDupPlan.periodizationOf(routine);
    if (!p) return null;
    const raw = LaidDupPlan.weekOf(p.startMonday, date);
    const position = LaidDupPlan.position(raw);
    return LaidDupPlan.day(p.day, raw, LaidDupPlan.maxesFor(p, position.week), {
      light: p.light,
      substitutions: p.substitutions,
      calibrationLifts: p.calibrationLifts,
      painFlags: p.painFlags,
    });
  }

  /**
   * Сделан ли день на неделе `week` (0-based): тренировка по этой программе, дата которой попала в календарную неделю.
   * Пропущена — неделя прошла или назначенный день недели уже позади, а тренировки нет; иначе впереди.
   */
  static status(
    routine: Routine,
    workouts: Workout[],
    week: number,
    today: string,
  ): { state: "done" | "missed" | "ahead"; date?: string } {
    const p = LaidDupPlan.periodizationOf(routine);
    if (!p) return { state: "ahead" };
    const monday = addCalendarDays(p.startMonday, week * 7);
    const sunday = addCalendarDays(monday, 6);
    const done = workouts
      .filter((w) => {
        if (w.routineId !== routine.id) return false;
        const effective = w.programDate ?? w.date;
        return effective >= monday && effective <= sunday;
      })
      .map((w) => w.date)
      .sort()[0];
    if (done) return { state: "done", date: done };
    const planned = routine.days.length ? Math.max(...routine.days) : 6;
    const plannedDate = addCalendarDays(monday, planned);
    const override = routine.occurrenceOverrides?.find((o) => o.from === plannedDate);
    if (override) {
      if (override.to === null) return { state: today < monday ? "ahead" : "missed" };
      return { state: override.to < today ? "missed" : "ahead" };
    }
    if (today > sunday) return { state: "missed" };
    if (today < monday) return { state: "ahead" };
    return { state: plannedDate < today ? "missed" : "ahead" };
  }

  /**
   * Статус дня для показа: как `status`, но на неделе 10 и позже («схема недели 9, цикл закончен») день девятой недели без тренировки
   * не «пропущен» — цикла уже нет, красное было бы упрёком за то, чего не изменить (R11-REQ04). Остальные недели и дни не меняются.
   */
  static dayStatus(
    routine: Routine,
    workouts: Workout[],
    week: number,
    today: string,
  ): { state: "done" | "missed" | "ahead" | "ended"; date?: string } {
    const result = LaidDupPlan.status(routine, workouts, week, today);
    const p = LaidDupPlan.periodizationOf(routine);
    if (result.state === "missed" && p && week === LAID_WEEKS - 1 && LaidDupPlan.weekOf(p.startMonday, today) >= LAID_WEEKS)
      return { state: "ended" };
    return result;
  }

  /**
   * Сколько подходов в неделю даёт цикл (шесть дней: тяжёлый и четыре рабочих подхода базового упражнения плюс вспомогательные):
   * `base` — по оригиналу (117), `added` — добавленное: задняя дельта, отведения на среднюю дельту, икры и пресс (+24).
   */
  static weeklySets(): { base: number; added: number } {
    const maxes: LaidMaxes = { squat: 100, bench: 100, deadlift: 100, ohp: 100 };
    const total = (extras: boolean) =>
      LaidDupPlan.DAYS.reduce((sum, day) => sum + LaidDupPlan.entries(day, maxes, { extras, light: false }).reduce((n, e) => n + e.sets.length, 0), 0);
    const base = total(false);
    return { base, added: total(true) - base };
  }

  /** Сколько тренировок за окно содержат выполненные рабочие подходы этого упражнения (для проверки калибровки ≥ 2 сессий). */
  static sessionsForExercise(workouts: Workout[], exerciseId: string, since = "0000-01-01", until = "9999-12-31"): number {
    const dates = new Set<string>();
    for (const w of workouts) {
      if (w.date < since || w.date > until) continue;
      if (w.exercises.some((e) => e.exerciseId === exerciseId && e.sets.some((s) => s.done && !s.warmup && s.reps > 0))) {
        dates.add(`${w.id}:${w.date}`);
      }
    }
    return dates.size;
  }

  /**
   * Лучший расчётный 1ПМ базового упражнения по Эпли среди выполненных рабочих подходов с даты `since` (включительно):
   * null, если подходящих нет. Дедуплицирует ревизии тренировок и игнорирует частичную амплитуду (ROM),
   * чтобы не завышать рабочие максимумы полной амплитуды.
   */
  static estimate(
    workouts: Workout[],
    lift: LaidLift,
    since = "0000-01-01",
    until = "9999-12-31",
    exerciseIdOverride?: string,
    maxReps = 12,
  ): number | null {
    const id = exerciseIdOverride || LaidDupPlan.LIFT_EXERCISE[lift];
    const unique = new Map<string, Workout>();
    for (const w of workouts) {
      const prev = unique.get(w.id);
      if (
        !prev ||
        (w.revision ?? 0) > (prev.revision ?? 0) ||
        ((w.revision ?? 0) === (prev.revision ?? 0) && (w.updatedAt ?? "") > (prev.updatedAt ?? ""))
      ) {
        unique.set(w.id, w);
      }
    }
    let best: number | null = null;
    for (const w of unique.values()) {
      if (w.date < since || w.date > until) continue;
      for (const entry of w.exercises) {
        if (entry.exerciseId !== id) continue;
        for (const set of entry.sets) {
          if (set.reps > maxReps) continue;
          const rom = set.execution?.rom ?? entry.execution?.rom;
          if (rom === "shortened_partial" || rom === "lengthened_partial") continue;
          const value = estimatedOneRepMax(set, entry);
          if (value !== null && (best === null || value > best)) best = value;
        }
      }
    }
    return best === null ? null : Math.round(best * 10) / 10;
  }

  /** Оценка по истории для окна создания: свежая история за последние полгода (с учётом замен базовых лифтов). */
  static estimates(workouts: Workout[], today: string, substitutions?: LaidSubstitutions): Record<LaidLift, number | null> {
    const since = addCalendarDays(today, -LaidDupPlan.ESTIMATE_DAYS);
    return {
      squat: LaidDupPlan.estimate(workouts, "squat", since, today, LaidDupPlan.liftExerciseId("squat", substitutions)),
      bench: LaidDupPlan.estimate(workouts, "bench", since, today, LaidDupPlan.liftExerciseId("bench", substitutions)),
      deadlift: LaidDupPlan.estimate(workouts, "deadlift", since, today, LaidDupPlan.liftExerciseId("deadlift", substitutions)),
      ohp: LaidDupPlan.estimate(workouts, "ohp", since, today, LaidDupPlan.liftExerciseId("ohp", substitutions)),
    };
  }

  /**
   * «Можно обновить максимум»: оценка по подходам последних 28 дней (и не раньше действующей настройки) не меньше чем на 5 %
   * выше действующего максимума. Guardrails:
   * - пропускает лифты с пометкой боли (`painFlags`) и в режиме калибровки (`calibrationLifts`);
   * - не принимает подходы выше 10 повторений как силовой триггер (высокая погрешность e1RM на 11+ повт.).
   */
  static suggestion(
    p: RoutinePeriodization,
    workouts: Workout[],
    today: string,
    options: { maxJumpFactor?: number } = {},
  ): { lift: LaidLift; from: number; estimate: number; to: number }[] {
    const settingStart = addCalendarDays(p.startMonday, p.maxesFromWeek * 7);
    const window = addCalendarDays(today, -LaidDupPlan.SUGGEST_DAYS);
    const since = settingStart > window ? settingStart : window;
    const found: { lift: LaidLift; from: number; estimate: number; to: number }[] = [];
    for (const lift of ["squat", "bench", "deadlift", "ohp"] as const) {
      if (p.painFlags?.includes(lift) || p.calibrationLifts?.includes(lift)) continue;
      const estimate = LaidDupPlan.estimate(workouts, lift, since, today, LaidDupPlan.liftExerciseId(lift, p.substitutions), 10);
      const current = p.maxes[lift];
      if (estimate !== null && estimate >= current * 1.05) {
        const capped =
          options.maxJumpFactor && options.maxJumpFactor > 1
            ? Math.min(estimate, current * options.maxJumpFactor)
            : estimate;
        const to = Math.min(MAX_KG, Math.floor(capped / 2.5) * 2.5);
        if (to > current) found.push({ lift, from: current, estimate, to });
      }
    }
    return found;
  }

  /**
   * Максимумы, которые обновляются сами: то же правило, что у подсказки (оценка по подходам за 28 дней выше
   * действующего максимума не меньше чем на 5 %), но без нажатия. Действуют с текущей недели; прошлые недели
   * остаются на прежних числах, потому что старая настройка уходит в `earlier` (`withMaxes`). После 9-й недели
   * не срабатывает: обновлять нечего, цикл закончен. Ничего не понижается — правило только на рост.
   */
  static autoMaxes(
    p: RoutinePeriodization,
    workouts: Workout[],
    today: string,
    options: { maxJumpFactor?: number; minorMode?: boolean } = {},
  ): LaidAutoUpdate | null {
    if (options.minorMode) return null;
    const position = LaidDupPlan.position(LaidDupPlan.weekOf(p.startMonday, today));
    if (position.finished) return null;
    const applied = LaidDupPlan.suggestion(p, workouts, today, { maxJumpFactor: options.maxJumpFactor });
    if (!applied.length) return null;
    const maxes = { ...p.maxes };
    for (const item of applied) maxes[item.lift] = item.to;
    return { maxes, applied, fromWeek: position.week };
  }
  /** Уведомление об автопересчёте: что выросло и с какой недели. */
  static autoNotice(update: LaidAutoUpdate, substitutions?: LaidSubstitutions): string {
    const list = update.applied
      .map((item) => `${LaidDupPlan.liftLabel(item.lift, substitutions)} ${LaidDupPlan.kg(item.from)} → ${LaidDupPlan.kg(item.to)} кг`)
      .join("; ");
    return `Максимумы обновлены автоматически: ${list}. Оценка — по подходам ${LaidDupPlan.windowText(LaidDupPlan.SUGGEST_DAYS)}, новые веса — с недели ${update.fromWeek + 1}.`;
  }

  /** Новые настройки программы после обновления максимумов: с недели `fromWeek` действуют `maxes`, прежние остаются для прошлых недель. */
  static withMaxes(p: RoutinePeriodization, maxes: LaidMaxes, fromWeek: number): RoutinePeriodization {
    const week = Math.max(0, Math.min(LAID_WEEKS, Math.trunc(fromWeek)));
    const earlier = [...(p.earlier ?? []), { fromWeek: p.maxesFromWeek, maxes: p.maxes }]
      .filter((stage) => stage.fromWeek < week)
      .slice(-7);
    return { ...p, maxes: { ...maxes }, maxesFromWeek: week, earlier: earlier.length ? earlier : undefined };
  }

  /** Уникальные упражнения цикла (сначала 4 базовых лифта, затем вспомогательные и добавленные) с днями и недельными подходами. */
  static catalogSlots(extras: boolean, substitutions?: LaidSubstitutions): LaidSlotInfo[] {
    const map = new Map<string, LaidSlotInfo>();
    const addSlot = (originalId: string, role: LaidSlotInfo["role"], day: LaidDay, sets: number, lift?: LaidLift) => {
      const resolvedId = LaidDupPlan.resolveExerciseId(originalId, substitutions);
      const prev = map.get(originalId);
      if (prev) {
        if (!prev.days.includes(day)) prev.days.push(day);
        prev.weeklySets += sets;
        if (role === "lift" || role === "wave-aux") prev.role = role;
        if (lift) prev.lift = lift;
      } else {
        map.set(originalId, {
          originalId,
          resolvedId,
          role,
          ...(lift ? { lift } : {}),
          days: [day],
          weeklySets: sets,
          replaced: resolvedId !== originalId,
        });
      }
    };
    for (const lift of ["squat", "bench", "deadlift", "ohp"] as const) {
      const originalId = LaidDupPlan.LIFT_EXERCISE[lift];
      for (const day of LaidDupPlan.DAYS) {
        if (LaidDupPlan.LIFT_OF[day] === lift) addSlot(originalId, "lift", day, 5, lift);
      }
    }
    for (const day of LaidDupPlan.DAYS) {
      const layout = LaidDupPlan.LAYOUT[day];
      for (const x of layout.aux) addSlot(x.exerciseId, x.byWave ? "wave-aux" : "aux", day, x.sets);
      if (extras) for (const x of layout.extras) addSlot(x.exerciseId, "added", day, x.sets);
    }
    return [...map.values()];
  }

  /** Упражнения, которые уже стоят в тех же днях цикла, что и `originalId` — их нельзя выбирать заменой, чтобы не плодить дубли в одном дне. */
  static conflictingIdsForSubstitution(originalId: string, extras: boolean, substitutions?: LaidSubstitutions): string[] {
    const conflicts = new Set<string>();
    for (const day of LaidDupPlan.DAYS) {
      const layout = LaidDupPlan.LAYOUT[day];
      const dayOriginals = [
        LaidDupPlan.LIFT_EXERCISE[LaidDupPlan.LIFT_OF[day]],
        ...layout.aux.map((x) => x.exerciseId),
        ...(extras ? layout.extras.map((x) => x.exerciseId) : []),
      ];
      if (!dayOriginals.includes(originalId)) continue;
      for (const other of dayOriginals) {
        if (other !== originalId) conflicts.add(LaidDupPlan.resolveExerciseId(other, substitutions));
      }
    }
    return [...conflicts];
  }

  /** Сводка планового недельного объёма по группам мышц (прямые + 0,5 косвенных) и осевой нагрузки по массиву упражнений. */
  private static summarizeExercisesVolume(items: { exerciseId: string; sets: number; entry?: WorkoutExercise }[]): LaidVolumeSummary {
    const totals = Object.fromEntries(MUSCLES.map((m) => [m.id, 0])) as Record<Muscle, number>;
    let totalSets = 0;
    let axialSets = 0;
    for (const item of items) {
      totalSets += item.sets;
      if (isAxialExercise(item.exerciseId)) axialSets += item.sets;
      const def = (item.entry ? exerciseForEntry(item.entry) : undefined) ?? exerciseById(item.exerciseId);
      if (!def) continue;
      for (const p of def.primary) totals[p] += item.sets;
      for (const s of def.secondary) totals[s] += item.sets * 0.5;
    }
    const muscles = MUSCLES.map((m) => ({
      id: m.id,
      name: m.short,
      sets: Math.round(totals[m.id] * 10) / 10,
    })).filter((m) => m.sets > 0);
    return { totalSets, axialSets, muscles };
  }

  /** Недельный объём и осевая нагрузка шаблона цикла с учётом `extras` и `substitutions`. */
  static weeklyMuscleVolume(options: { extras: boolean; substitutions?: LaidSubstitutions }): LaidVolumeSummary {
    const maxes: LaidMaxes = { squat: 100, bench: 100, deadlift: 100, ohp: 100 };
    const items: { exerciseId: string; sets: number; entry: WorkoutExercise }[] = [];
    for (const day of LaidDupPlan.DAYS) {
      for (const entry of LaidDupPlan.entries(day, maxes, { extras: options.extras, light: false, substitutions: options.substitutions })) {
        items.push({ exerciseId: entry.exerciseId, sets: entry.sets.filter((s) => !s.warmup).length, entry });
      }
    }
    return LaidDupPlan.summarizeExercisesVolume(items);
  }

  /** Недельный объём и осевая нагрузка уже созданного цикла. */
  static cycleMuscleVolume(cycle: readonly Routine[]): LaidVolumeSummary {
    const items: { exerciseId: string; sets: number; entry: WorkoutExercise }[] = [];
    for (const r of cycle) {
      for (const entry of r.exercises) {
        items.push({ exerciseId: entry.exerciseId, sets: entry.sets.filter((s) => !s.warmup).length, entry });
      }
    }
    return LaidDupPlan.summarizeExercisesVolume(items);
  }

  /**
   * Применить новые замены упражнений ко всем программам действующего цикла:
   * заменяет упражнения во всех днях, сохраняет дни недели, историю максимумов (`earlier`) и прочие правки,
   * а если для заменённого базового лифта передан новый 1ПМ — обновляет его с недели `fromWeek`.
   */
  static withSubstitutions(
    cycle: readonly Routine[],
    nextSubstitutions?: LaidSubstitutions,
    options?: {
      maxes?: LaidMaxes;
      fromWeek?: number;
      calibrationLifts?: readonly LaidLift[];
      painFlags?: readonly LaidLift[];
    },
  ): Routine[] {
    const normalized = LaidDupPlan.normalizeSubstitutions(nextSubstitutions);
    const out: Routine[] = [];
    for (const routine of cycle) {
      const prev = LaidDupPlan.periodizationOf(routine);
      if (!prev) continue;
      const oldSubs = prev.substitutions;
      const nextPeriodizationBase =
        options?.maxes &&
        (["squat", "bench", "deadlift", "ohp"] as const).some((l) => options.maxes![l] !== prev.maxes[l])
          ? LaidDupPlan.withMaxes(prev, options.maxes, options.fromWeek ?? 0)
          : { ...prev };
      const calLifts =
        options?.calibrationLifts !== undefined
          ? options.calibrationLifts.length
            ? [...new Set(options.calibrationLifts)]
            : undefined
          : prev.calibrationLifts;
      const pFlags =
        options?.painFlags !== undefined
          ? options.painFlags.length
            ? [...new Set(options.painFlags)]
            : undefined
          : prev.painFlags;
      const nextPeriodization: RoutinePeriodization = {
        ...nextPeriodizationBase,
        ...(normalized ? { substitutions: normalized } : {}),
        ...(calLifts ? { calibrationLifts: calLifts } : {}),
        ...(pFlags ? { painFlags: pFlags } : {}),
      };
      if (!normalized) delete nextPeriodization.substitutions;
      if (!calLifts) delete nextPeriodization.calibrationLifts;
      if (!pFlags) delete nextPeriodization.painFlags;

      const day = prev.day;
      const layout = LaidDupPlan.LAYOUT[day];
      const origLiftId = LaidDupPlan.LIFT_EXERCISE[LaidDupPlan.LIFT_OF[day]];
      const slotOriginals = [
        origLiftId,
        ...layout.aux.map((x) => x.exerciseId),
        ...layout.extras.map((x) => x.exerciseId),
      ];
      // Карта «текущий exerciseId в программе → новый exerciseId»
      const remap = new Map<string, string>();
      for (const origId of slotOriginals) {
        const oldId = LaidDupPlan.resolveExerciseId(origId, oldSubs);
        const newId = LaidDupPlan.resolveExerciseId(origId, normalized);
        if (oldId !== newId) remap.set(oldId, newId);
      }

      const activeWeek = options?.fromWeek ?? 0;
      const newPlan = LaidDupPlan.day(day, activeWeek, LaidDupPlan.maxesFor(nextPeriodization, activeWeek), {
        light: nextPeriodization.light,
        substitutions: normalized,
        calibrationLifts: calLifts,
        painFlags: pFlags,
      });

      const seen = new Set<string>();
      const nextExercises: WorkoutExercise[] = [];
      for (const entry of routine.exercises) {
        const mappedId = remap.get(entry.exerciseId);
        const targetId = mappedId ?? entry.exerciseId;
        if (seen.has(targetId)) continue;
        seen.add(targetId);

        if (!mappedId) {
          // Если у базового лифта поменялся только 1ПМ, обновим шаблон подходов на актуальный план
          if (entry.exerciseId === newPlan.liftExerciseId && options?.maxes) {
            nextExercises.push({ ...entry, sets: LaidDupPlan.liftSets(newPlan) });
          } else {
            nextExercises.push(entry);
          }
          continue;
        }

        const fresh = makeExerciseEntry(mappedId);
        if (mappedId === newPlan.liftExerciseId) {
          nextExercises.push({
            ...fresh,
            sets: LaidDupPlan.liftSets(newPlan),
          });
        } else {
          const def = exerciseById(mappedId);
          const isDuration = def?.recording.type === "duration";
          const workingCount = Math.max(1, entry.sets.filter((s) => !s.warmup).length || entry.sets.length);
          const fallbackReps = entry.repMin ?? (entry.sets.find((s) => !s.warmup)?.reps || 10);
          nextExercises.push({
            ...fresh,
            sets: makeSets(workingCount, 0, isDuration ? 0 : fallbackReps).map((s) => ({
              ...s,
              rir: null,
              ...(isDuration ? { durationSeconds: 45 } : {}),
            })),
            ...(isDuration
              ? {}
              : {
                  ...(entry.repMin !== undefined ? { repMin: entry.repMin } : {}),
                  ...(entry.repMax !== undefined ? { repMax: entry.repMax } : {}),
                }),
          });
        }
      }

      out.push({
        ...routine,
        exercises: nextExercises,
        periodization: nextPeriodization,
      });
    }
    return out;
  }
}
