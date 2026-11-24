import type { Exercise } from "../lib/types";
import { BiomechanicsEngine } from "./BiomechanicsEngine";

export type SubstitutionClass = "A" | "B" | "C";
export type PrescriptionMode = "percent_1rm" | "calibration" | "rir_range";
export type SwapScope = "today" | "block" | "program" | "avoid";
export type AvoidReason = "pain" | "equipment" | "dislike" | "other";
export type InjuryZone = "lower_back" | "shoulder" | "knee" | "elbow" | "wrist";
export type LengthenedEvidenceLevel = "strong" | "moderate" | "limited" | "none";

export interface SubstitutionCompatibility {
  subClass: SubstitutionClass;
  prescriptionMode: PrescriptionMode;
  badge: string;
  summary: string;
  allowHeavySingles: boolean;
}

export interface InjuryZoneSpec {
  id: InjuryZone;
  label: string;
  short: string;
  hint: string;
}

export interface AvoidedExercise {
  exerciseId: string;
  reason: AvoidReason;
  addedAt: string;
  note?: string;
}

export interface LengthenedEvidenceInfo {
  level: LengthenedEvidenceLevel;
  label: string;
  detail: string;
  citation: string;
}

export const INJURY_DISCLAIMER =
  "Фильтр отсеивает потенциально провоцирующие варианты для подбора альтернатив и не является медицинским диагнозом. При новой, усиливающейся боли или острой травме обратись к врачу или физиотерапевту.";

export const INJURY_ZONES: readonly InjuryZoneSpec[] = [
  {
    id: "lower_back",
    label: "Поясница / спина",
    short: "Поясница",
    hint: "Без высокой осевой нагрузки на позвоночник и тяжёлого неподдерживаемого наклона",
  },
  {
    id: "shoulder",
    label: "Плечевой сустав",
    short: "Плечо",
    hint: "Без тяжёлых вертикальных жимов над головой и широких жимов с глубокой экстензией",
  },
  {
    id: "knee",
    label: "Коленный сустав",
    short: "Колено",
    hint: "Без высокоударного или глубокого перегруза разгибателя колена",
  },
  {
    id: "elbow",
    label: "Локоть / предплечье",
    short: "Локоть",
    hint: "Без жёсткого супинированного/прямого грифа и тяжёлой изоляции сгибания/разгибания локтя",
  },
  {
    id: "wrist",
    label: "Кисть / запястье",
    short: "Запястье",
    hint: "Нейтральный хват, тренажёры или блоки без крайнего разгибания запястья",
  },
] as const;

export const AVOID_REASON_LABELS: Record<AvoidReason, string> = {
  pain: "Дискомфорт / боль (до пересмотра)",
  equipment: "Нет оборудования в зале",
  dislike: "Не подходит / не нравится",
  other: "Другая причина",
};

export const SWAP_SCOPE_META: Record<SwapScope, { label: string; sub: string }> = {
  today: { label: "Только сегодня", sub: "Изменит упражнение только в текущей тренировке" },
  block: { label: "До конца волны", sub: "Заменит в программе и текущем блоке" },
  program: { label: "На всю программу", sub: "Обновит во всех будущих днях программы/цикла" },
  avoid: { label: "Не предлагать", sub: "Заменит и скроет старое упражнение из рекомендаций" },
};

/**
 * Доказательная политика совместимости замен (классы A / B / C), фильтры по зонам дискомфорта,
 * список исключённых упражнений и честные evidence-теги по stretch-mediated hypertrophy.
 */
export class SubstitutionPolicy {
  /**
   * Классифицирует замену базового движения DUP:
   * - Класс A: близкий штанговый вариант того же семейства с e1RM (можно % от собственного 1ПМ, при наличии истории).
   * - Класс B: другой стабильный compound (жим ногами, хип-траст, RDL, гантели, тренажёр) — 1-я неделя в калибровке (RIR + диапазон),
   *   без переноса старого 1ПМ; проценты включаются только по собственной истории (≥2 тренировок).
   * - Класс C: изоляция, одностороннее, собственный вес или замена по причине боли — никогда не наследует 90–97,5% синглы/двойки.
   */
  static classify(
    original: Exercise | undefined,
    replacement: Exercise | undefined,
    options: { hasOwnHistory?: boolean; painFlag?: boolean } = {},
  ): SubstitutionCompatibility {
    if (!replacement) {
      return {
        subClass: "C",
        prescriptionMode: "rir_range",
        badge: "Класс C · по RIR",
        summary: "Без процентной привязки: работа по целевому диапазону повторений и RIR.",
        allowHeavySingles: false,
      };
    }

    if (options.painFlag) {
      return {
        subClass: "C",
        prescriptionMode: "rir_range",
        badge: "Щадящий режим · RIR",
        summary: "При пометке боли тяжёлые синглы 95% и автоповышение веса отключены — ориентируйся на переносимый вес и RIR 2–3.",
        allowHeavySingles: false,
      };
    }

    const loadClass = BiomechanicsEngine.loadClass(replacement);
    const isUnilateral = replacement.recording.laterality === "unilateral";
    const isBodyweightOrDuration =
      replacement.recording.type === "duration" ||
      replacement.recording.loadMode === "bodyweight" ||
      replacement.recording.loadMode === "assisted_bodyweight";

    if (loadClass === "isolation" || isUnilateral || isBodyweightOrDuration) {
      return {
        subClass: "C",
        prescriptionMode: "rir_range",
        badge: "Класс C · по RIR",
        summary: "Односуставное или одностороннее движение: тяжёлые синглы 95% заменены на безопасный диапазон повторений и RIR 1–2.",
        allowHeavySingles: false,
      };
    }

    const sameFamily = !!original && replacement.familyId === original.familyId;
    const isBarbellTotal = replacement.recording.loadMode === "total_external" && replacement.recording.e1rmEligible;

    if (sameFamily && isBarbellTotal) {
      return {
        subClass: "A",
        prescriptionMode: options.hasOwnHistory ? "percent_1rm" : "calibration",
        badge: options.hasOwnHistory ? "Класс A · % от 1ПМ" : "Класс A · калибровка",
        summary: options.hasOwnHistory
          ? "Близкий силовой вариант со своей историей — волновые проценты DUP работают от его собственного 1ПМ."
          : "Близкий силовой вариант, но без собственной истории — введи осторожный 1ПМ этого движения или включи калибровку.",
        allowHeavySingles: true,
      };
    }

    return {
      subClass: "B",
      prescriptionMode: options.hasOwnHistory ? "percent_1rm" : "calibration",
      badge: options.hasOwnHistory ? "Класс B · % по истории" : "Класс B · калибровка",
      summary: options.hasOwnHistory
        ? "Другой базовый паттерн/снаряд: проценты считаются только от собственной истории этого упражнения, без переноса старого 1ПМ."
        : "Другой базовый паттерн/снаряд (тренажёр, гантели или иной рычаг): % от старого 1ПМ не переносится — начни с калибровки по RIR.",
      allowHeavySingles: false,
    };
  }

  /**
   * Проверяет, подходит ли упражнение-кандидат под выбранную зону ограничения.
   * Это эвристический фильтр для удобства выбора, не медицинское назначение.
   */
  static isZoneFriendly(exercise: Exercise, zone: InjuryZone): boolean {
    const id = exercise.id.toLowerCase();
    const name = exercise.name.toLowerCase();
    const loadClass = BiomechanicsEngine.loadClass(exercise);

    switch (zone) {
      case "lower_back":
        return loadClass !== "axial_compound" && !id.includes("deadlift") && !id.includes("good-morning") && !id.includes("back-extension");
      case "shoulder":
        return (
          exercise.familyId !== "overhead-press" &&
          !id.includes("dip") &&
          !id.includes("behind") &&
          !id.includes("upright") &&
          !name.includes("широким хватом")
        );
      case "knee":
        return (
          !id.includes("sissy") &&
          !id.includes("pistol") &&
          !id.includes("jump") &&
          !(exercise.familyId === "squat" && loadClass === "axial_compound") &&
          !id.includes("lunge") &&
          !id.includes("bulgarian")
        );
      case "elbow":
        return (
          !id.includes("skullcrusher") &&
          !id.includes("curl-bar") &&
          !id.includes("curl-ez") &&
          !id.includes("chinup") &&
          !id.includes("pullup") &&
          !id.includes("dip")
        );
      case "wrist":
        return (
          exercise.recording.loadMode === "machine_stack" ||
          id.includes("cable") ||
          id.includes("hammer") ||
          id.includes("neutral") ||
          id.includes("leg") ||
          id.includes("calf") ||
          id.includes("hip-thrust") ||
          id.includes("glute") ||
          (!id.includes("curl-bar") && !id.includes("front-squat") && !id.includes("pushup") && !id.includes("skullcrusher"))
        );
    }
  }

  /**
   * Честный тег доказательности по stretch-mediated hypertrophy / тренировке на больших длинах мышцы.
   * Без псевдонаучных множителей к подходам (×1.2 и т.д.).
   */
  static lengthenedEvidence(exercise: Exercise | undefined): LengthenedEvidenceInfo {
    if (!exercise) {
      return { level: "none", label: "Нет данных по длине", detail: "Недостаточно специфических RCT.", citation: "" };
    }
    const id = exercise.id.toLowerCase();
    const name = exercise.name.toLowerCase();
    const muscles = new Set(exercise.muscles.filter((m) => m.role === "primary").map((m) => m.muscleId));

    // Икроножная на прямых коленях (standing calf) — сильная доказательность (Kassiano 2023)
    if (muscles.has("gastrocnemius") && (id.includes("standing") || id.includes("donkey") || id.includes("legpress-calf"))) {
      return {
        level: "strong",
        label: "Сильная база по растяжению",
        detail: "Прямое колено растягивает икроножную; работа в полной амплитуде с паузой внизу превосходит вариант сидя для gastrocnemius.",
        citation: "Kassiano et al., 2023",
      };
    }
    // Сгибание ног сидя — сильная доказательность (Maeo 2021)
    if (id.includes("legcurl-seated") || (exercise.familyId === "knee-flexion" && name.includes("сидя"))) {
      return {
        level: "strong",
        label: "Сильная база по растяжению",
        detail: "Согнутый таз ставит двусуставные мышцы задней поверхности бедра на большую длину — в RCT давало больше гипертрофии, чем вариант лёжа.",
        citation: "Maeo et al., 2021",
      };
    }
    // Разгибание трицепса из-за головы — сильная доказательность для длинной головки (Maeo 2022)
    if (
      (id.includes("overhead") || name.includes("из-за головы") || id.includes("triceps-db")) &&
      exercise.primary.includes("triceps")
    ) {
      return {
        level: "strong",
        label: "Сильная база по растяжению",
        detail: "Поднятое плечо растягивает длинную головку трицепса — в RCT давало преимущество над нейтральным положением руки.",
        citation: "Maeo et al., 2022",
      };
    }
    // Квадрицепсы / RDL / глубокий присед / грудные в растяжении — умеренная доказательность
    if (
      exercise.familyId === "squat" ||
      exercise.familyId === "hip-hinge" ||
      id.includes("incline-db") ||
      id.includes("fly")
    ) {
      return {
        level: "moderate",
        label: "Умеренная база по растяжению",
        detail: "Полная амплитуда с контролем нижней растянутой точки остаётся сильным вариантом; преимущество частичных над full ROM не универсально.",
        citation: "Wolf et al., 2023; 2025",
      };
    }
    // Сгибатели локтя — Wolf 2025 показал паритет lengthened partials и full ROM у тренированных
    if (exercise.primary.includes("biceps")) {
      return {
        level: "limited",
        label: "Смешанные данные по растяжению",
        detail: "У тренированных атлетов частичные в растяжении и полная амплитуда дали сходный рост сгибателей локтя — важнее стабильный full ROM и прогрессия.",
        citation: "Wolf et al., 2025",
      };
    }
    return {
      level: "none",
      label: "Базовые данные по ROM",
      detail: "Для этой мышцы прямых RCT по растянутым частичным мало — ориентируйся на полную контролируемую амплитуду.",
      citation: "Wolf et al., 2023",
    };
  }
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Локальный список упражнений «Не предлагать» (травма / нет инвентаря / не подходит), изолированный по аккаунту.
 * При причине `pain` всегда трактуется как «до пересмотра», а не пожизненный запрет.
 */
export class ExerciseAvoidStore {
  static key(accountId: string) {
    return `tyaga-avoid-exercises:${accountId}`;
  }

  constructor(
    private accountId: string,
    private storage: () => Store | null = () => (typeof localStorage === "undefined" ? null : localStorage),
  ) {}

  private store(): Store | null {
    try {
      return this.storage();
    } catch {
      return null;
    }
  }

  read(): AvoidedExercise[] {
    try {
      const raw = this.store()?.getItem(ExerciseAvoidStore.key(this.accountId));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is AvoidedExercise =>
          !!item &&
          typeof item.exerciseId === "string" &&
          item.exerciseId.length > 0 &&
          ["pain", "equipment", "dislike", "other"].includes(item.reason),
      );
    } catch {
      return [];
    }
  }

  private write(items: AvoidedExercise[]) {
    const s = this.store();
    if (!s) return;
    const key = ExerciseAvoidStore.key(this.accountId);
    if (!items.length) s.removeItem(key);
    else s.setItem(key, JSON.stringify(items.slice(-60)));
  }

  add(exerciseId: string, reason: AvoidReason, note?: string): AvoidedExercise[] {
    const next = this.read().filter((x) => x.exerciseId !== exerciseId);
    next.push({
      exerciseId,
      reason,
      addedAt: new Date().toISOString().slice(0, 10),
      ...(note?.trim() ? { note: note.trim().slice(0, 140) } : {}),
    });
    this.write(next);
    return next;
  }

  remove(exerciseId: string): AvoidedExercise[] {
    const next = this.read().filter((x) => x.exerciseId !== exerciseId);
    this.write(next);
    return next;
  }

  ids(): Set<string> {
    return new Set(this.read().map((x) => x.exerciseId));
  }
}
