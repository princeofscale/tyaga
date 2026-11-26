import { exerciseById } from "../lib/model";
import type { SetEntry, WorkoutExercise } from "../lib/types";
import {
  LAID_LAYOUT,
  LAID_LIFT_EXERCISE,
  LAID_LIFT_LABEL,
  LAID_LIFT_OF,
  LAID_PLAN_MARK,
  LAID_REST_SUMMARY,
  LAID_SCHEME,
  LAID_WAVE_META,
  LAID_WEEKS,
  isHeavyCompoundAux,
  laidAuxReps,
  laidOriginalIds,
  resolveLaidExerciseId,
  type LaidAuxProgressionHint,
  type LaidDay,
  type LaidDayPlan,
  type LaidExerciseGuidance,
  type LaidExerciseSpec,
  type LaidPosition,
  type LaidSubstitutions,
  type LaidWeekGuide,
} from "./laidDupData";

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
  options: { isDeload?: boolean; totalWeeks?: number } = {},
): string {
  const total = options.totalWeeks ?? LAID_WEEKS;
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
  options: { light?: boolean; deload?: boolean; totalWeeks?: number } = {},
): LaidWeekGuide {
  const totalWeeks = options.totalWeeks ?? LAID_WEEKS;
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
        ? "Разгрузочная неделя цикла (55–65 % · половина подходов)"
        : position.finished
          ? "Цикл 9 недель завершён — время разгрузки"
          : "Плановая разгрузка",
      summary: options.deload
        ? "База идёт на 55–60 % (половина откатных подходов), подсобка и тренажёры — на 65 % и половине подходов с RIR 3–4. После разгрузки волны продолжаются без потери прогресса."
        : position.finished
          ? "Проведи 1 разгрузочную неделю (50–60 % от 1ПМ, половина подходов, без отказа), затем проверь или обнови максимумы и запусти новый цикл."
          : "Снизь веса до 60–85 % (включая тренажёры), сократи подходы вдвое и держи большой запас — задача сбросить накопленную усталость, не гнаться за весом.",
      baseRir: "База: RIR 3–4 (без отказа)",
      auxRir: "Подсобка и тренажёры: RIR 3–4",
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
  const baseRirByWave: Record<1 | 2 | 3, string> = {
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
    badge: `Волна ${position.wave} · ${waveMeta.title}`,
    focusTitle: info.title,
    summary: info.summary,
    baseRir: baseRirByWave[position.wave],
    auxRir: "Подсобка и тренажёры: RIR 1–2 (RPE 8–9)",
    restSummary: LAID_REST_SUMMARY,
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

  const waveReps = laidAuxReps(day, exerciseId, plan.position.inWave, substitutions);
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

  const added = !laidOriginalIds(day, substitutions).includes(exerciseId);
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
  if (options.deload) return exerciseId === plan.liftExerciseId ? 120 : 75;
  if (exerciseId === plan.liftExerciseId) {
    if (plan.prescriptionMode === "calibration") return 180;
    if (plan.prescriptionMode === "rir_range") return 150;
    if (options.isTopSet) return plan.heavy.reps <= 3 ? 240 : 210;
    const reps = options.reps ?? plan.work.reps;
    return reps <= 4 ? 240 : reps <= 6 ? 210 : 180;
  }
  return buildExerciseGuidance(day, exerciseId, plan, options.substitutions).restSeconds;
}

export function buildExerciseSpec(
  day: LaidDay,
  exerciseId: string,
  substitutions?: LaidSubstitutions,
): LaidExerciseSpec {
  const originalLiftId = LAID_LIFT_EXERCISE[LAID_LIFT_OF[day]];
  const resolvedLiftId = resolveLaidExerciseId(originalLiftId, substitutions);
  if (exerciseId === resolvedLiftId) {
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
  const layout = LAID_LAYOUT[day];
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
  if (plan.isDeload) {
    const label = buildWeekLabel(plan.position, { isDeload: true });
    if (plan.prescriptionMode !== "percent_1rm") {
      return [
        `${label}.`,
        `${LAID_PLAN_MARK} разгрузка 1 × ${heavy.reps} ${repsWord(heavy.reps)} и ${work.sets} × ${work.reps} ${repsWord(work.reps)} (RIR 3–4).`,
        "Снизь рабочий вес до комфортного лёгкого и не ходи в отказ — задача недели восстановить ЦНС и суставы.",
      ].join(" ");
    }
    return [
      `${label}.`,
      `${LAID_PLAN_MARK} разгрузка 1 × ${heavy.reps} ${repsWord(heavy.reps)} · 60 % = ${formatKg(heavy.weightKg)} кг (RIR 3–4).`,
      `Затем ${work.sets} × ${work.reps} ${repsWord(work.reps)} · 55 % = ${formatKg(work.weightKg)} кг (RIR 3–4).`,
    ].join(" ");
  }
  if (plan.prescriptionMode === "calibration") {
    return [
      `${buildWeekLabel(plan.position)}.`,
      `${LAID_PLAN_MARK} калибровка 1 × ${heavy.reps} ${repsWord(heavy.reps)} с запасом 2–3 повторения (RIR 2–3), затем ${work.sets} × ${work.reps} ${repsWord(work.reps)} (RIR 2).`,
      "Подбери комфортный рабочий вес без привязки к старому 1ПМ — после 2 тренировок сможешь задать собственный максимум.",
    ].join(" ");
  }
  if (plan.prescriptionMode === "rir_range") {
    return [
      `${buildWeekLabel(plan.position)}.`,
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
    `${buildWeekLabel(plan.position)}.`,
    `${LAID_PLAN_MARK} 1 × ${heavy.reps} ${repsWord(heavy.reps)} · ${formatPct(heavy.percent)} % от 1ПМ (${formatKg(plan.maxKg)} кг) = ${formatKg(heavy.weightKg)} кг${heavy.light ? " (облегчённо, не по оригиналу)" : ""}.`,
    `Затем ${work.sets} × ${work.reps} ${repsWord(work.reps)} · ${formatPct(work.percent)} % = ${formatKg(work.weightKg)} кг${work.light ? " (облегчённо)" : ""}.`,
    ...(replacedNote ? [replacedNote] : []),
  ].join(" ");
}
