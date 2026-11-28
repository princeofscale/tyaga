import { exerciseById } from "../lib/model";
import type { SetEntry, WorkoutExercise } from "../lib/types";
import {
  LAID_LIFT_LABEL,
  LAID_PLAN_MARK,
  LAID_REST_SUMMARY,
  LAID_SCHEME,
  LAID_V2_REST_SUMMARY,
  LAID_WAVE_META,
  LAID_WEEKS,
  isHeavyCompoundAux,
  laidAuxReps,
  laidOriginalIds,
  layoutForVersion,
  liftExerciseForDay,
  resolveLaidExerciseId,
  type LaidAuxProgressionHint,
  type LaidDay,
  type LaidDayPlan,
  type LaidExerciseGuidance,
  type LaidExerciseSpec,
  type LaidPosition,
  type LaidSubstitutions,
  type LaidVersion,
  type LaidWeekGuide,
} from "./laidDupData";
import {
  ACCESSORY_RIR_RAMP_V3,
  getV3ExerciseSlot,
  LAID_V3_REST_SUMMARY,
  LAID_V3_WEEKS,
  type MesocycleWeek,
} from "./LaidDupV3";

export function formatKg(value: number): string {
  return String(value).replace(".", ",");
}

export function formatPct(value: number): string {
  return String(value).replace(".", ",");
}

export function repsWord(n: number): string {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  return !teen && last === 1 ? "повторение" : !teen && last >= 2 && last <= 4 ? "повторения" : "повторений";
}

export function buildWeekLabel(
  position: LaidPosition,
  options: { isDeload?: boolean; totalWeeks?: number; version?: LaidVersion } = {},
): string {
  const isV3 = options.version === "v3";
  const total = options.totalWeeks ?? (isV3 ? LAID_V3_WEEKS : LAID_WEEKS);
  if (isV3) {
    if (options.isDeload || position.raw === 5) {
      return `Неделя ${Math.max(1, position.raw + 1)} из ${total} · активная разгрузка (5+1)`;
    }
    if (position.finished) return `Мезоцикл 5+1 завершён · обнови ТМ и начни новый цикл`;
    return `Неделя ${Math.max(1, position.raw + 1)} из ${total} · Dynamic Wave DUP v3`;
  }
  if (options.isDeload) {
    return `Неделя ${Math.max(1, position.raw + 1)} из ${total} · разгрузочная неделя`;
  }
  if (position.finished) return `Неделя ${position.raw + 1} · схема недели 9 · цикл закончен — обнови максимумы`;
  if (total > LAID_WEEKS) {
    return `Неделя ${Math.max(1, position.raw + 1)} из ${total} · волна ${position.wave} (схема нед. ${position.week + 1})`;
  }
  return `Неделя ${position.week + 1} из ${LAID_WEEKS} · волна ${position.wave}`;
}

export function buildWeekGuide(
  position: LaidPosition,
  options: { light?: boolean; deload?: boolean; totalWeeks?: number; version?: LaidVersion } = {},
): LaidWeekGuide {
  const isV3 = options.version === "v3";
  const totalWeeks = options.totalWeeks ?? (isV3 ? LAID_V3_WEEKS : LAID_WEEKS);
  const isV2 = options.version === "v2";

  if (isV3) {
    const w = Math.max(1, Math.min(6, position.raw + 1)) as MesocycleWeek;
    const isDeload = Boolean(options.deload || w === 6 || position.finished);
    const auxRir = ACCESSORY_RIR_RAMP_V3[isDeload ? 6 : w];
    const v3Focus: Record<MesocycleWeek, { title: string; summary: string; baseRir: string }> = {
      1: {
        title: "Вход в 5-дневный гибрид · RIR 3",
        summary:
          "Настройка 1 авторегулируемого топ-сета + 2 откатных (−12–15 % от факта). Подсобка и изоляция на RIR 3,0, суперсеты экономят до 35 % времени.",
        baseRir: "База: топ RIR 2,5 · откатные −12–15 %",
      },
      2: {
        title: "Смена волны H ↔ S · RIR 2",
        summary:
          "Стимулы H и S меняются местами, %TM растёт на +2,5 %. Подсобка прогрессирует по DDP (каждый сет независимо) при целевом RIR 2,0.",
        baseRir: "База: топ RIR 2,0 · откатные −12–15 %",
      },
      3: {
        title: "Интенсификация · RIR 1,5",
        summary:
          "Высокое механическое натяжение на базе (87,5–92,5 % ТМ). Свежий слот рук и 3D-дельт в Верх B (4 сета махов + 4 в кроссовере = 8 прямых/нед.).",
        baseRir: "База: топ RIR 1,5 · откатные −12–13 %",
      },
      4: {
        title: "Пик гипертрофии · RIR 1 + шлюз LP",
        summary:
          "База выходит на 90–95 % ТМ (RIR 1,0). На последнем сете стабильной растянутой изоляции открывается шлюз удлинённых частичных (LP).",
        baseRir: "База: топ RIR 1,0 · откатные −12–13 %",
      },
      5: {
        title: "Реализация · Rep-out (+3) + RIR 0 на изоляции",
        summary:
          "Пиковая неделя: на топ-сете базы открыт контролируемый rep-out (до +3 повт. при RIR ≥ 1,0) для фиксации реального роста TM. Изоляция до RIR 0 + LP.",
        baseRir: "База: топ RIR 1,0 (rep-out +3) · откатные −15 %",
      },
      6: {
        title: "Активная разгрузка DUP v3 (5+1)",
        summary:
          "Объём −50 % (1 топ + 1 откатный на базе, половина сетов на подсобке), 80–82,5 % ТМ при RIR 4,0. LP и мутации TM отключены; в сушке калории на TDEE.",
        baseRir: "База: 80–82,5 % ТМ · RIR 4,0 (без отказа)",
      },
    };
    const info = v3Focus[isDeload ? 6 : w];
    return {
      weekNumber: isDeload ? Math.max(1, position.raw + 1) : w,
      totalWeeks,
      wave: position.wave,
      waveTitle: isDeload ? "Активная разгрузка" : w === 5 ? "Реализация" : w >= 3 ? "Интенсификация" : "Накопление",
      badge: isDeload ? `DUP v3 · Разгрузка (${w}/${totalWeeks})` : `DUP v3 · Нед. ${w}/${totalWeeks}`,
      focusTitle: position.finished ? "Мезоцикл 5+1 завершён — стартуй новый круг" : info.title,
      summary: info.summary,
      baseRir: info.baseRir,
      auxRir: isDeload
        ? "Подсобка и изоляция: −50 % сетов · RIR 4,0"
        : `Подсобка (DDP): RIR ${formatPct(auxRir)}${w >= 4 ? " · LP на последнем сете" : ""}`,
      restSummary: isDeload ? "Отдых: 1,5–2 мин (лёгкие веса)" : LAID_V3_REST_SUMMARY,
      isDeloadWindow: isDeload,
    };
  }

  if (options.deload || position.finished) {
    const displayWeek = Math.max(1, position.raw + 1);
    return {
      weekNumber: displayWeek,
      totalWeeks,
      wave: position.wave,
      waveTitle: "Разгрузка",
      badge: options.deload
        ? `Неделя ${displayWeek} из ${totalWeeks} · Разгрузка`
        : position.finished
          ? `Неделя ${displayWeek} · Разгрузка`
          : "Разгрузочная неделя",
      focusTitle: options.deload
        ? isV2
          ? "Активная разгрузка DUP v2 (75 % ТМ · половина подходов)"
          : "Разгрузочная неделя цикла (55–65 % · половина подходов)"
        : position.finished
          ? "Цикл завершён — время разгрузки"
          : "Плановая разгрузка",
      summary: options.deload
        ? isV2
          ? "Активная разгрузка цикла 7: база 2×5 (трэп-тяга 2×3) на 75 % ТМ, подсобка и тренажёры — половина подходов и −15 % веса, RIR 4–5. Сбрасывает усталость перед пиковой волной 3."
          : "База идёт на 55–60 % (половина откатных подходов), подсобка и тренажёры — на 65 % и половине подходов с RIR 3–4. После разгрузки волны продолжаются без потери прогресса."
        : position.finished
          ? "Проведи 1 разгрузочную неделю (50–60 % от 1ПМ, половина подходов, без отказа), затем проверь или обнови максимумы и запусти новый цикл."
          : "Снизь веса до 60–85 % (включая тренажёры), сократи подходы вдвое и держи большой запас — задача сбросить накопленную усталость, не гнаться за весом.",
      baseRir: isV2 ? "База: RIR 4–5 (без отказа)" : "База: RIR 3–4 (без отказа)",
      auxRir: isV2 ? "Подсобка и тренажёры: RIR 4–5" : "Подсобка и тренажёры: RIR 3–4",
      restSummary: "Отдых: 1,5–2 мин (веса лёгкие)",
      isDeloadWindow: true,
    };
  }

  const waveMeta = LAID_WAVE_META[position.wave];
  const weekNumber = position.week + 1;
  const focusByWeek: Record<number, { title: string; summary: string }> = {
    1: {
      title: "Вход в 6-дневный ритм и техника",
      summary:
        "Стартовые проценты волны 1 (85 / 90 / 95 % на топ-сетах). Задача недели — войти в частоту 6 дней, настроить рабочие веса подсобки и держать чистую технику без отказа.",
    },
    2: {
      title: "Смена акцентов первого круга",
      summary:
        "Тяжёлые синглы переходят на присед (Ноги 1) и тягу 1; объёмные 4×12 — на Ноги 2. Не ломай технику ради веса, держи контролируемый темп.",
    },
    3: {
      title: "Завершение волны 1 (база)",
      summary:
        "Закрываешь первый 3-недельный круг DUP. Оцени восстановление: со следующей недели (волна 2) все проценты вырастут на +1–1,5 %.",
    },
    4: {
      title: "Рост процентов · старт волны 2",
      summary:
        "Проценты поднялись до 86 / 91 / 96,5 % на топ-сетах и +1 % на откатных. Схема повторений как в неделе 1, но веса тяжелее — строго отдыхай 3–5 мин на базе.",
    },
    5: {
      title: "Пик объёма середины цикла",
      summary:
        "Накопленная усталость растёт. Следи за сном и поясницей; в подсобке и тренажёрах не ходи в отказ (держи RIR 1–2).",
    },
    6: {
      title: "Финал интенсификации (волна 2)",
      summary:
        "Последняя неделя второй волны. Если чувствуешь сильное утомление или просадку повторений — допустимо вставить разгрузочную неделю перед волной 3.",
    },
    7: {
      title: "Выход на пиковые веса · волна 3",
      summary:
        "Максимальные проценты цикла (88 / 92,5 / 97,5 % на топ-сетах). Главный приоритет — базовые движения; в подсобке не перегружай ЦНС.",
    },
    8: {
      title: "Тяжёлая предпиковая неделя",
      summary:
        "Высокая силовая нагрузка на синглы и двойки. Отдыхай полные 4–5 мин перед тяжёлыми подходами базы и не добирай лишнего объёма.",
    },
    9: {
      title: "Финальная неделя цикла",
      summary:
        "Завершение 9-недельного блока. После этой недели обязательно сделай 1 разгрузочную неделю (50–60 % веса, половина подходов, RIR 4), затем обнови 1ПМ.",
    },
  };
  const baseRirByWave: Record<1 | 2 | 3, string> = isV2
    ? {
        1: "База: топ RIR 2–3 · откатные RIR 2,5–3",
        2: "База: топ RIR 1,5–2 · откатные RIR 2–2,5",
        3: "База: топ RIR 1–1,5 · откатные RIR 1,5–2",
      }
    : {
        1: options.light ? "База: топ RIR 2 · откатные RIR 2–3" : "База: топ RIR 1–2 · откатные RIR 2–3",
        2: options.light ? "База: топ RIR 1–2 · откатные RIR 2–3" : "База: топ RIR 1 · откатные RIR 2–3",
        3: options.light ? "База: топ RIR 1 · откатные RIR 2" : "База: топ RIR 0,5–1 · откатные RIR 2",
      };
  const info = focusByWeek[weekNumber] ?? focusByWeek[1];
  return {
    weekNumber: totalWeeks > LAID_WEEKS ? Math.max(1, position.raw + 1) : weekNumber,
    totalWeeks,
    wave: position.wave,
    waveTitle: waveMeta.title,
    badge: isV2 ? `DUP v2 · Волна ${position.wave}` : `Волна ${position.wave} · ${waveMeta.title}`,
    focusTitle: info.title,
    summary: isV2
      ? `Умный DUP v2 (ТМ = 90 % 1ПМ, без синглов 1ПМ). Эксцентрика 2–3 с и пауза 0,5 с в растяжении; тяжёлые S-сессии разнесены по разным неделям волны.`
      : info.summary,
    baseRir: baseRirByWave[position.wave],
    auxRir: isV2
      ? position.wave === 3
        ? "Подсобка: RIR 1–1,5 · изоляция RIR 0–1"
        : "Подсобка: RIR 1,5–2 · изоляция RIR 1"
      : "Подсобка и тренажёры: RIR 1–2 (RPE 8–9)",
    restSummary: isV2 ? LAID_V2_REST_SUMMARY : LAID_REST_SUMMARY,
    isDeloadWindow: false,
  };
}

export function buildExerciseGuidance(
  day: LaidDay,
  exerciseId: string,
  plan: LaidDayPlan,
  substitutions?: LaidSubstitutions,
  options: { deload?: boolean } = {},
): LaidExerciseGuidance {
  const isLift = exerciseId === plan.liftExerciseId;
  if (plan.version === "v3") {
    const v3Week = plan.v3Week ?? 1;
    const isDeload = Boolean(options.deload || plan.isDeload || v3Week === 6);
    let origId = exerciseId;
    if (substitutions) {
      for (const [orig, repl] of Object.entries(substitutions)) {
        if (repl === exerciseId) {
          origId = orig;
          break;
        }
      }
    }
    const slot = getV3ExerciseSlot(day, exerciseId) ?? getV3ExerciseSlot(day, origId);
    const supersetTag =
      slot?.supersetGroup && slot.supersetOrder
        ? `SS ${slot.supersetGroup}${slot.supersetOrder}`
        : undefined;
    const lpActive =
      !isDeload && Boolean(slot?.isIsolation && slot.lengthenedPartialsEligible && (v3Week === 4 || v3Week === 5));
    const auxRir = plan.v3AccessoryRir ?? ACCESSORY_RIR_RAMP_V3[isDeload ? 6 : v3Week];

    if (isDeload) {
      return {
        role: isLift ? "lift" : isHeavyCompoundAux(exerciseId) ? "compound-aux" : "isolation-aux",
        roleLabel: isLift ? "DUP v3 · Разгрузка" : "Разгрузка (−50 % сетов)",
        rirLabel: "Цель: RIR 4,0 (без отказа)",
        rirPlaceholder: "4",
        restSeconds: isLift ? 120 : 75,
        restLabel: isLift ? "2 мин" : "1–1,5 мин",
        detail:
          "Активная разгрузка (неделя 6): удерживай технику на 80–82,5 % ТМ (подсобка −50 % сетов, −10 % веса), LP отключены.",
      };
    }

    if (isLift) {
      const stim = plan.stimulus ?? "H";
      const topRir = plan.v3TargetTopRir ?? 2;
      const dropPct = plan.v3LoadDropPct ?? 14;
      const repOutText = plan.v3RepOutCap
        ? ` На топ-сете открыт rep-out до +${plan.v3RepOutCap} повт. (при RIR ≥ 1,0).`
        : "";
      return {
        role: "lift",
        roleLabel: `DUP v3 · Стимул ${stim} (нед. ${v3Week}/6)`,
        rirLabel: `Топ RIR ${formatPct(topRir)} · откат −${dropPct} %`,
        rirPlaceholder: formatPct(topRir),
        restSeconds: stim === "S" ? 210 : 180,
        restLabel: stim === "S" ? "3–3,5 мин" : "2,5–3 мин",
        detail: `1 авторегулируемый топ-сет (${plan.heavy.reps} повт. @ RIR ${formatPct(topRir)}), затем ${plan.work.sets} откатных по ${plan.work.reps} (−${dropPct} % от фактического топ-сета).${repOutText}`,
      };
    }

    const isCompound = !slot?.isIsolation || isHeavyCompoundAux(exerciseId);
    const restSeconds = supersetTag ? 75 : isCompound ? 120 : 75;
    const restLabel = supersetTag ? "60–75 с (SS)" : isCompound ? "2 мин" : "75–90 с";
    return {
      role: isCompound ? "compound-aux" : "isolation-aux",
      roleLabel: supersetTag ? `DDP · ${supersetTag}` : isCompound ? "DDP · Базовая подсобка" : "DDP · Изоляция",
      rirLabel: `RIR ${formatPct(auxRir)}${lpActive ? " + LP (посл. сет)" : ""}`,
      rirPlaceholder: formatPct(auxRir),
      restSeconds,
      restLabel,
      detail: `${slot?.note ? `${slot.note}. ` : ""}Прогрессия DDP (каждый сет до верха диапазона → шаг +${slot?.plateStepKg ?? 2.5} кг).${lpActive ? " После технического отказа на последнем сете добавь 3–5 удлинённых частичных (LP)." : ""}`,
      ...(supersetTag ? { supersetTag } : {}),
      ...(lpActive ? { lengthenedPartials: true } : {}),
    };
  }

  if (options.deload) {
    return {
      role: isLift ? "lift" : isHeavyCompoundAux(exerciseId) ? "compound-aux" : "isolation-aux",
      roleLabel: isLift ? "База · разгрузка" : "Разгрузка",
      rirLabel: "Цель: RIR 3–4 (без отказа)",
      rirPlaceholder: "3–4",
      restSeconds: isLift ? 120 : 75,
      restLabel: isLift ? "2 мин" : "1–1,5 мин",
      detail: "Разгрузочная неделя: держи сниженный вес (включая тренажёры), половину подходов и большой запас.",
    };
  }

  if (isLift) {
    if (plan.prescriptionMode === "calibration") {
      return {
        role: "lift",
        roleLabel: "База · калибровка",
        rirLabel: "Топ RIR 2–3 · раб. RIR 2",
        rirPlaceholder: "2–3",
        restSeconds: 180,
        restLabel: "3 мин",
        detail: "Калибровка без 1ПМ: подбери вес с запасом 2–3 повт., чтобы безопасно освоить движение и набрать историю.",
      };
    }
    if (plan.prescriptionMode === "rir_range") {
      return {
        role: "lift",
        roleLabel: plan.painFlag ? "База · щадяще" : "База · по RIR",
        rirLabel: plan.painFlag ? "Цель: RIR 2–3 (без боли)" : "Топ RIR 1–2 · раб. RIR 2",
        rirPlaceholder: plan.painFlag ? "2–3" : "1–2",
        restSeconds: 150,
        restLabel: "2–3 мин",
        detail: plan.painFlag
          ? "Щадящий режим: без тяжёлых синглов и боли, ориентируйся на переносимый вес и запас 2–3 повт."
          : "Прогрессируй по повторениям и запасу RIR 1–2 без привязки к процентам 1ПМ.",
      };
    }
    const waveRir =
      plan.position.wave === 1
        ? "Топ RIR 1–2 · раб. RIR 2–3"
        : plan.position.wave === 2
          ? "Топ RIR 1 · раб. RIR 2–3"
          : "Топ RIR 0,5–1 · раб. RIR 2";
    const heavyDay = plan.work.reps <= 6;
    return {
      role: "lift",
      roleLabel: `База DUP · Волна ${plan.position.wave}`,
      rirLabel: waveRir,
      rirPlaceholder: plan.position.wave === 3 ? "1" : "1–2",
      restSeconds: heavyDay ? 240 : 180,
      restLabel: heavyDay ? "3–5 мин" : "3–4 мин",
      detail: `Неделя ${plan.position.week + 1}: сначала 1 тяжёлый подход (${plan.heavy.reps} повт.), затем ${plan.work.sets} откатных по ${plan.work.reps}.`,
    };
  }

  const waveReps = laidAuxReps(day, exerciseId, plan.position.inWave, substitutions, plan.version);
  if (waveReps !== null) {
    const heavyWave = waveReps <= 4;
    return {
      role: "wave-aux",
      roleLabel: "Волновая подсобка",
      rirLabel: "Цель: RIR 1–2 (RPE 8–9)",
      rirPlaceholder: "1–2",
      restSeconds: heavyWave ? 180 : 120,
      restLabel: heavyWave ? "2,5–3 мин" : "2–3 мин",
      detail: `Повторения меняются по волне (сейчас ${waveReps} повт.). Подбери вес так, чтобы оставалось 1–2 повторения в запасе.`,
    };
  }

  const added = !laidOriginalIds(day, substitutions, plan.version).includes(exerciseId);
  const compound = isHeavyCompoundAux(exerciseId);
  if (compound) {
    return {
      role: added ? "added" : "compound-aux",
      roleLabel: added ? "Добавлено · база" : "Тяжёлая подсобка",
      rirLabel: "Цель: RIR 1–2 (RPE 8–9)",
      rirPlaceholder: "1–2",
      restSeconds: 120,
      restLabel: "2–3 мин",
      detail: "Многосуставная подсобка: не доводи до отказа, оставляй 1–2 чистых повтора в запасе, чтобы не забить ЦНС и поясницу.",
    };
  }
  return {
    role: added ? "added" : "isolation-aux",
    roleLabel: added ? "Добавлено · изоляция" : "Тренажёр / изоляция",
    rirLabel: "Цель: RIR 1–2 (посл. 0–1)",
    rirPlaceholder: "1–2",
    restSeconds: 90,
    restLabel: "1–1,5 мин",
    detail: added
      ? "Добавлено к оригиналу Лейда для баланса (задняя/средняя дельта, икры, пресс). Вес — под чистые повторения с RIR 1–2."
      : "Изоляция и тренажёры: работай с контролем в RIR 1–2 (в последнем подходе можно до RIR 0–1), отдых 60–90 с.",
  };
}

export function calcRestSecondsForSet(
  day: LaidDay,
  exerciseId: string,
  plan: LaidDayPlan,
  options: { isTopSet?: boolean; reps?: number; substitutions?: LaidSubstitutions; deload?: boolean } = {},
): number {
  const isDeload = Boolean(options.deload || plan.isDeload);
  if (isDeload) return exerciseId === plan.liftExerciseId ? 120 : 75;
  if (exerciseId === plan.liftExerciseId) {
    if (plan.prescriptionMode === "calibration") return 180;
    if (plan.prescriptionMode === "rir_range") return 150;
    if (plan.version === "v3") return plan.stimulus === "S" ? 210 : 180;
    if (options.isTopSet) return plan.heavy.reps <= 3 ? 240 : 210;
    const reps = options.reps ?? plan.work.reps;
    return reps <= 4 ? 240 : reps <= 6 ? 210 : 180;
  }
  return buildExerciseGuidance(day, exerciseId, plan, options.substitutions, { deload: isDeload }).restSeconds;
}

export function buildExerciseSpec(
  day: LaidDay,
  exerciseId: string,
  substitutions?: LaidSubstitutions,
  version?: LaidVersion,
): LaidExerciseSpec {
  const originalLiftId = liftExerciseForDay(day, version);
  const resolvedLiftId = resolveLaidExerciseId(originalLiftId, substitutions);
  if (exerciseId === resolvedLiftId) {
    if (version === "v3") {
      return {
        exerciseId,
        role: "lift",
        setsLabel: "1 топ-сет (3–6) + 2 откат. (4–8)",
        intensityLabel: "82,5–97,5 % от ТМ (90 % 1ПМ) · откат −12–15 % от факта · RIR 2,5 → 1,0",
        rirLabel: "Топ RIR 2,5 → 1,0 · W5 rep-out (+3)",
        restLabel: "2,5–3,5 мин",
        restSeconds: 180,
        note: "Dynamic Wave DUP v3: еженедельная смена H/S, авторегуляция TM по perfDelta и EnergyStatus",
        added: false,
        ...(resolvedLiftId !== originalLiftId ? { replacedFrom: originalLiftId } : {}),
      };
    }
    if (version === "v2") {
      if (day === "pull2") {
        return {
          exerciseId,
          role: "lift",
          setsLabel: "1 × (10/8/6) + 3 × (12/10/8)",
          intensityLabel: "Двойная прогрессия · топ RIR 1–2, раб. −10 % · отдых 2–2,5 мин",
          rirLabel: "Топ RIR 1–2 · раб. RIR 1,5–2",
          restLabel: "2–2,5 мин",
          restSeconds: 135,
          note: "Замена 2-й становой с пола: базовая DUP-тяга с упором грудью без нагрузки на поясницу",
          added: false,
          ...(resolvedLiftId !== originalLiftId ? { replacedFrom: originalLiftId } : {}),
        };
      }
      if (day === "pull1") {
        return {
          exerciseId,
          role: "lift",
          setsLabel: "1 × (5/4/3) + 2 × (6/5/4)",
          intensityLabel: "87,5–97,5 % от ТМ (90 % 1ПМ) · топ RIR 1,5–3 · отдых 3–3,5 мин",
          rirLabel: "Топ RIR 1,5–3 · раб. RIR 2–3",
          restLabel: "3–3,5 мин",
          restSeconds: 195,
          note: "Центрированная тяга с трэп-грифом снижает момент на L5/S1 и разгружает поясницу",
          added: false,
          ...(resolvedLiftId !== originalLiftId ? { replacedFrom: originalLiftId } : {}),
        };
      }
      const workSets = day === "legs2" ? 2 : 3;
      return {
        exerciseId,
        role: "lift",
        setsLabel: `1 × (6/5–4/3) + ${workSets} × (10–8/8–6/5–4)`,
        intensityLabel: "85–100 % от ТМ (90 % 1ПМ) · без синглов 1ПМ · отдых 2,5–3 мин",
        rirLabel: "Топ RIR 1–3 · раб. RIR 1,5–3",
        restLabel: "2,5–3 мин",
        restSeconds: 180,
        note: "Волновая схема DUP v2: H / M / S разнесены в шахматном порядке без перегрузки ЦНС",
        added: false,
        ...(resolvedLiftId !== originalLiftId ? { replacedFrom: originalLiftId } : {}),
      };
    }
    const s = LAID_SCHEME[day];
    return {
      exerciseId,
      role: "lift",
      setsLabel: `1 × (${s.heavy.join("/")}) + 4 × (${s.work.join("/")})`,
      intensityLabel: "85–97,5 % от 1ПМ · топ RIR 1–2, раб. RIR 2–3 · отдых 3–5 мин",
      rirLabel: "Топ RIR 1–2 · раб. RIR 2–3",
      restLabel: "3–5 мин",
      restSeconds: 210,
      note: "Вес и повторения меняются каждую неделю по волне DUP",
      added: false,
      ...(resolvedLiftId !== originalLiftId ? { replacedFrom: originalLiftId } : {}),
    };
  }
  const layout = layoutForVersion(version)[day];
  const aux = layout.aux.find((x) => resolveLaidExerciseId(x.exerciseId, substitutions) === exerciseId);
  if (aux) {
    const repsText = aux.byWave
      ? `${aux.byWave.join(" / ")} по неделе волны`
      : aux.repMin === aux.repMax
        ? String(aux.repMin)
        : `${aux.repMin}–${aux.repMax}`;
    const compound = !!aux.byWave || isHeavyCompoundAux(exerciseId);
    const restLabel = compound ? "2–3 мин" : "1–1,5 мин";
    const restSeconds = compound ? 120 : 90;
    const rirLabel = compound ? "RIR 1–2 (RPE 8–9)" : "RIR 1–2 (посл. 0–1)";
    return {
      exerciseId,
      role: aux.byWave ? "wave-aux" : "aux",
      setsLabel: `${aux.sets} × ${repsText}`,
      intensityLabel: `${rirLabel} · отдых ${restLabel}`,
      rirLabel,
      restLabel,
      restSeconds,
      note: aux.exerciseId === exerciseId ? aux.note : undefined,
      added: false,
      ...(aux.exerciseId !== exerciseId ? { replacedFrom: aux.exerciseId } : {}),
    };
  }
  const extra = layout.extras.find((x) => resolveLaidExerciseId(x.exerciseId, substitutions) === exerciseId);
  const repsText = extra ? (extra.repMin === extra.repMax ? String(extra.repMin) : `${extra.repMin}–${extra.repMax}`) : "12–15";
  return {
    exerciseId,
    role: "added",
    setsLabel: `${extra?.sets ?? 3} × ${repsText}`,
    intensityLabel: "RIR 1–2 (RPE 8–9) · отдых 1–1,5 мин",
    rirLabel: "RIR 1–2 (посл. 0–1)",
    restLabel: "1–1,5 мин",
    restSeconds: 90,
    note: extra && extra.exerciseId === exerciseId ? extra.note : undefined,
    added: true,
    ...(extra && extra.exerciseId !== exerciseId ? { replacedFrom: extra.exerciseId } : {}),
  };
}

export function buildAuxProgressionHint(
  entry: Pick<WorkoutExercise, "exerciseId" | "repMin" | "repMax" | "sets">,
  previousWorkingSets: readonly SetEntry[],
): LaidAuxProgressionHint | null {
  const done = previousWorkingSets.filter((s) => s.done && !s.warmup && s.reps > 0);
  if (!done.length) return null;
  const def = exerciseById(entry.exerciseId);
  if (def?.recording.type === "duration") return null;
  const targetMin = entry.repMin ?? done[0].reps;
  const targetMax = entry.repMax ?? targetMin;
  const plannedCount = entry.sets.filter((s) => !s.warmup).length || done.length;
  const anyFailure = done.some((s) => s.rir === 0);
  const anyMissed = done.some((s) => s.reps < targetMin);
  if (anyFailure || anyMissed) {
    return {
      kind: "consolidate",
      title: "Закрепи вес с запасом RIR 1–2",
      detail: anyFailure
        ? "В прошлый раз были подходы в отказ (RIR 0) — повтори тот же вес с чистой техникой и запасом 1–2 повт."
        : `В прошлый раз не добрался до ${targetMin} повт. — оставь текущий вес и добери повторения.`,
    };
  }
  const allHitMax = done.length >= plannedCount && done.every((s) => s.reps >= targetMax);
  const allHaveReserve = done.every((s) => s.rir !== null && s.rir >= 2);
  const topWeight = done[0].weight;
  const sameWeight = done.every((s) => s.weight === topWeight);
  if (allHitMax && allHaveReserve) {
    const canAddWeight =
      topWeight > 0 &&
      sameWeight &&
      def?.recording.loadMode !== "bodyweight" &&
      def?.recording.loadMode !== "assisted_bodyweight";
    const relativeJump = canAddWeight ? 2.5 / topWeight : 1;
    if (canAddWeight && relativeJump <= 0.12) {
      const nextKg = Math.round((topWeight + 2.5) * 10) / 10;
      return {
        kind: "raise_weight",
        title: `Готово к шагу +2,5 кг → ${formatKg(nextKg)} кг`,
        detail: `Все подходы прошлого раза дошли до ${targetMax} повт. с запасом RIR ≥ 2 — можно поднять рабочий вес.`,
        suggestedWeightKg: nextKg,
      };
    }
    return {
      kind: "add_reps",
      title: "Добавь +1–2 повторения (или малый шаг веса)",
      detail: `Все подходы сделаны на ${targetMax} повт. с RIR ≥ 2 — шаг +2,5 кг великоват (>12 %), поэтому добавь 1–2 повт. или возьми шаг +1 кг.`,
    };
  }
  return null;
}

export function formatDayLine(plan: LaidDayPlan): string {
  if (plan.isDeload) {
    if (plan.prescriptionMode !== "percent_1rm") {
      return `Разгрузка · 1 × ${plan.heavy.reps} · ${plan.work.sets} × ${plan.work.reps} (RIR 3–4)`;
    }
    return `Разгрузка · 1 × ${plan.heavy.reps} × ${formatKg(plan.heavy.weightKg)} кг · ${plan.work.sets} × ${plan.work.reps} × ${formatKg(plan.work.weightKg)} кг (RIR 3–4)`;
  }
  if (plan.prescriptionMode === "calibration") {
    return `Калибровка · 1 × ${plan.heavy.reps} (RIR 2–3) · ${plan.work.sets} × ${plan.work.reps} (RIR 2)`;
  }
  if (plan.prescriptionMode === "rir_range") {
    const rirText = plan.painFlag ? "RIR 2–3 · щадяще" : "RIR 1–2";
    return `По RIR · 1 × ${plan.heavy.reps} (${rirText}) · ${plan.work.sets} × ${plan.work.reps} (RIR 2)`;
  }
  return `1 × ${plan.heavy.reps} × ${formatKg(plan.heavy.weightKg)} кг · ${plan.work.sets} × ${plan.work.reps} × ${formatKg(plan.work.weightKg)} кг`;
}

export function formatCompactDayLine(plan: LaidDayPlan): string {
  if (plan.isDeload) {
    if (plan.prescriptionMode !== "percent_1rm") {
      return `Разгрузка · 1×${plan.heavy.reps} · ${plan.work.sets}×${plan.work.reps} (RIR 3–4)`;
    }
    return `Разгрузка · 1×${plan.heavy.reps} ${formatKg(plan.heavy.weightKg)} кг · ${plan.work.sets}×${plan.work.reps} ${formatKg(plan.work.weightKg)} кг`;
  }
  if (plan.prescriptionMode === "calibration") {
    return `Калибровка · 1×${plan.heavy.reps} · ${plan.work.sets}×${plan.work.reps} (RIR 2–3)`;
  }
  if (plan.prescriptionMode === "rir_range") {
    return `По RIR · 1×${plan.heavy.reps} · ${plan.work.sets}×${plan.work.reps}`;
  }
  return `1×${plan.heavy.reps} ${formatKg(plan.heavy.weightKg)} кг · ${plan.work.sets}×${plan.work.reps} ${formatKg(plan.work.weightKg)} кг`;
}

export function formatDayDescription(plan: LaidDayPlan): string {
  const { heavy, work } = plan;
  const labelOpts = { version: plan.version };
  const maxRef = plan.version === "v2" || plan.version === "v3" ? "ТМ" : "1ПМ";
  if (plan.isDeload) {
    const label = buildWeekLabel(plan.position, { ...labelOpts, isDeload: true });
    if (plan.prescriptionMode !== "percent_1rm") {
      return [
        `${label}.`,
        `${LAID_PLAN_MARK} разгрузка 1 × ${heavy.reps} ${repsWord(heavy.reps)} и ${work.sets} × ${work.reps} ${repsWord(work.reps)} (${plan.version === "v2" ? "RIR 4–5" : plan.version === "v3" ? "RIR 4" : "RIR 3–4"}).`,
        "Снизь рабочий вес до комфортного лёгкого и не ходи в отказ — задача недели восстановить ЦНС и суставы.",
      ].join(" ");
    }
    const deloadRir = plan.version === "v2" ? "RIR 4–5" : plan.version === "v3" ? "RIR 4" : "RIR 3–4";
    return [
      `${label}.`,
      `${LAID_PLAN_MARK} разгрузка 1 × ${heavy.reps} ${repsWord(heavy.reps)} · ${formatPct(heavy.percent)} % = ${formatKg(heavy.weightKg)} кг (${deloadRir}).`,
      `Затем ${work.sets} × ${work.reps} ${repsWord(work.reps)} · ${formatPct(work.percent)} % = ${formatKg(work.weightKg)} кг (${deloadRir}).`,
    ].join(" ");
  }
  if (plan.prescriptionMode === "calibration") {
    return [
      `${buildWeekLabel(plan.position, labelOpts)}.`,
      `${LAID_PLAN_MARK} калибровка 1 × ${heavy.reps} ${repsWord(heavy.reps)} с запасом 2–3 повторения (RIR 2–3), затем ${work.sets} × ${work.reps} ${repsWord(work.reps)} (RIR 2).`,
      "Подбери комфортный рабочий вес без привязки к старому 1ПМ — после 2 тренировок сможешь задать собственный максимум.",
    ].join(" ");
  }
  if (plan.prescriptionMode === "rir_range") {
    return [
      `${buildWeekLabel(plan.position, labelOpts)}.`,
      `${LAID_PLAN_MARK} ${plan.painFlag ? "щадящий режим (пометка боли)" : "работа по RIR (класс C)"}: 1 × ${heavy.reps} ${repsWord(heavy.reps)} и ${work.sets} × ${work.reps} ${repsWord(work.reps)} с запасом ${plan.painFlag ? "2–3" : "1–2"} повт.`,
      plan.painFlag
        ? "Тяжёлые синглы 95 % и автоповышение веса отключены — ориентируйся на переносимый вес без усиления симптомов."
        : "Для этого типа движения проценты от 1ПМ неточны — прогрессируй по повторениям и RIR.",
    ].join(" ");
  }
  const replacedNote =
    plan.liftExerciseId !== plan.originalLiftExerciseId
      ? `Замена вместо «${exerciseById(plan.originalLiftExerciseId)?.name ?? LAID_LIFT_LABEL[plan.lift]}»: волновая периодизация и проценты сохранены.`
      : "";
  return [
    `${buildWeekLabel(plan.position, labelOpts)}.`,
    `${LAID_PLAN_MARK} 1 × ${heavy.reps} ${repsWord(heavy.reps)} · ${formatPct(heavy.percent)} % от ${maxRef} (${formatKg(plan.maxKg)} кг) = ${formatKg(heavy.weightKg)} кг${heavy.light ? " (облегчённо, не по оригиналу)" : ""}.`,
    `Затем ${work.sets} × ${work.reps} ${repsWord(work.reps)} · ${formatPct(work.percent)} % = ${formatKg(work.weightKg)} кг${work.light ? " (облегчённо)" : ""}.`,
    ...(replacedNote ? [replacedNote] : []),
  ].join(" ");
}
