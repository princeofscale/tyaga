import { addCalendarDays } from "../lib/calendar";
import type { Muscle, Routine, Workout } from "../lib/types";
import { AnalyticsFacts } from "./AnalyticsFacts";
import { BiomechanicsEngine, type LaidCycleAudit, type WeeklyBiomechanicsReport } from "./BiomechanicsEngine";
import { LaidDupPlan } from "./LaidDupPlan";
import { MuscleReadiness, type MuscleReadinessItem } from "./MuscleReadiness";
import { PersonalRecordsCalculator, type BalanceRatios } from "./PersonalRecords";
import { VolumeLandmarksCalculator } from "./VolumeLandmarks";

export type CoachLoadStatus = "no_data" | "optimal" | "overloaded" | "underloaded" | "attention";
export type CoachInsightCategory = "overload" | "underload" | "progress" | "balance";
export type CoachSeverity = "critical" | "warn" | "good" | "info";

export interface CoachInsight {
  id: string;
  category: CoachInsightCategory;
  severity: CoachSeverity;
  title: string;
  detail: string;
  action: string;
  metric?: string;
}

export interface LiftTrend {
  exerciseId: string;
  name: string;
  recentE1rm: number;
  priorE1rm: number;
  changePct: number;
  sessionsCount: number;
  status: "rising" | "plateau" | "dip";
}

export interface NextSessionSuggestion {
  focusLabels: string[];
  recommendedRir: string;
  headline: string;
  reason: string;
}

export interface SmartCoachReport {
  score: number;
  status: CoachLoadStatus;
  statusLabel: string;
  headline: string;
  /** Acute (7д) : Chronic (28д среднее/нед) коэффициент нагрузки (ACWR). */
  acwr: number | null;
  acwrLabel: string;
  acuteSets: number;
  chronicWeeklyAvg: number;
  workouts7d: number;
  workouts28d: number;
  overloadedMuscles: Array<{ muscle: Muscle; name: string; sets: number }>;
  underloadedMuscles: Array<{ muscle: Muscle; name: string; sets: number }>;
  liftTrends: LiftTrend[];
  insights: CoachInsight[];
  nextSession: NextSessionSuggestion;
  biomechanics: WeeklyBiomechanicsReport;
  readiness: MuscleReadinessItem[];
  ratios: BalanceRatios;
  laidAudit: LaidCycleAudit | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Детерминированный спортивно-аналитический «умный ИИ-тренер».
 * Анализирует реальный журнал: ACWR (перегруз / недогруз), качество стимула (RIR, SFR),
 * осевую нагрузку, плато по e1RM, баланс жимов/тяг и пучков мышц, готовность групп и цикл Дэвида Лейда.
 */
export class SmartCoach {
  static analyze(
    workouts: Workout[],
    routines: Routine[],
    today: string,
    timeZone?: string,
    now = new Date(),
  ): SmartCoachReport {
    const bio = BiomechanicsEngine.analyzeWeek(workouts, today, { timeZone, now });
    const readiness = MuscleReadiness.fromWorkouts(workouts, today, timeZone);
    const volumeWeek = VolumeLandmarksCalculator.assessWeek(workouts, today, { timeZone, now });

    const start7 = addCalendarDays(today, -6);
    const start28 = addCalendarDays(today, -27);
    const start56 = addCalendarDays(today, -55);
    const recent7 = new AnalyticsFacts(workouts, { from: start7, through: today, timeZone, now }).workouts();
    const recent28 = new AnalyticsFacts(workouts, { from: start28, through: today, timeZone, now }).workouts();
    const acuteSets = bio.workingSets;
    const total28Sets = new AnalyticsFacts(workouts, { from: start28, through: today, timeZone, now }).sets().length;
    const chronicWeeklyAvg = round1(total28Sets / 4);

    // ACWR (Acute:Chronic Workload Ratio): острый 7д объём / хроническая 4-недельная база
    const acwr = chronicWeeklyAvg >= 6 ? round2(acuteSets / chronicWeeklyAvg) : null;
    const acwrLabel =
      acwr === null
        ? "Набираем базу"
        : acwr > 1.45
          ? "Резкий скачок"
          : acwr >= 0.8
            ? "Оптимальная зона"
            : "Спад объёма";

    const ratios = new PersonalRecordsCalculator(recent28, now).calculateRatios(timeZone);

    // Перегруженные (>20 экв. подх./нед) и недогруженные (<6 экв. подх./нед) мышцы
    const overloadedMuscles = volumeWeek.assessments
      .filter((a) => a.actualSets > 20)
      .sort((a, b) => b.actualSets - a.actualSets)
      .map((a) => ({ muscle: a.muscle, name: a.muscleName, sets: round1(a.actualSets) }));

    const coreGroups: Muscle[] = ["chest", "back", "shoulders", "quads", "hamstrings", "glutes"];
    const underloadedMuscles =
      recent28.length >= 2
        ? volumeWeek.assessments
            .filter((a) => coreGroups.includes(a.muscle) && a.actualSets < 6)
            .sort((a, b) => a.actualSets - b.actualSets)
            .map((a) => ({ muscle: a.muscle, name: a.muscleName, sets: round1(a.actualSets) }))
        : [];

    // Детектор прогресса и плато по e1RM (последние 21 день против 22–56 дней назад)
    const splitDate = addCalendarDays(today, -21);
    const recentPrs = new PersonalRecordsCalculator(
      new AnalyticsFacts(workouts, { from: splitDate, through: today, timeZone, now }).workouts(),
      now,
    ).calculateRecords(timeZone);
    const priorPrs = new Map(
      new PersonalRecordsCalculator(
        new AnalyticsFacts(workouts, { from: start56, through: addCalendarDays(splitDate, -1), timeZone, now }).workouts(),
        now,
      )
        .calculateRecords(timeZone)
        .map((p) => [p.key, p]),
    );

    const liftTrends: LiftTrend[] = [];
    for (const pr of recentPrs) {
      const prior = priorPrs.get(pr.key);
      if (!pr.bestE1rm || !prior?.bestE1rm) continue;
      const sessionsCount = pr.workoutCount + prior.workoutCount;
      if (sessionsCount < 3) continue;
      const changePct = round1(((pr.bestE1rm.e1rm - prior.bestE1rm.e1rm) / prior.bestE1rm.e1rm) * 100);
      const status: LiftTrend["status"] =
        changePct >= 2 ? "rising" : changePct <= -2.5 ? "dip" : "plateau";
      liftTrends.push({
        exerciseId: pr.exerciseId,
        name: pr.name,
        recentE1rm: pr.bestE1rm.e1rm,
        priorE1rm: prior.bestE1rm.e1rm,
        changePct,
        sessionsCount,
        status,
      });
    }
    liftTrends.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

    // Аудит цикла Дэвида Лейда, если активен
    const laidCycles = LaidDupPlan.cycles(routines);
    const laidAudit = laidCycles.length > 0 ? BiomechanicsEngine.auditLaidCycle(laidCycles[0], workouts, today) : null;

    // Генерация приоритетных инсайтов
    const insights: CoachInsight[] = [];

    // 1. Перегрузка по ACWR
    if (acwr !== null && acwr > 1.45) {
      insights.push({
        id: "acwr-overload",
        category: "overload",
        severity: acwr > 1.7 ? "critical" : "warn",
        title: "Скачок нагрузки выше привычной базы",
        detail: `За последние 7 дней сделано ${acuteSets} рабочих подходов против среднего ${chronicWeeklyAvg}/нед (коэффициент ACWR ${acwr}). Резкий рост объёма выше 1,45 повышает риск переутомления.`,
        action: "На ближайших 2–3 тренировках оставь RIR 2–3 и не добавляй подходы сверх плана.",
        metric: `ACWR ${acwr}`,
      });
    }

    // 2. Перегруженные мышечные группы (>20 экв. подх./нед)
    if (overloadedMuscles.length > 0) {
      const list = overloadedMuscles.slice(0, 3).map((m) => `${m.name} (${m.sets})`).join(", ");
      insights.push({
        id: "muscle-overload",
        category: "overload",
        severity: overloadedMuscles[0].sets >= 26 ? "critical" : "warn",
        title: "Превышен недельный объём по мышцам",
        detail: `${list} экв. подх./нед — выше общего потолка 20 подх. Отдача от дополнительных подходов падает, а локальная усталость копится.`,
        action: "Срежь 2–4 лишних подхода в этих зонах или проведи объёмную разгрузку на неделю.",
        metric: `${overloadedMuscles[0].sets} подх.`,
      });
    }

    // 3. Слишком много отказов (RIR 0) или осевой нагрузки
    for (const sig of bio.signals) {
      if (sig.id === "high-failure-ratio") {
        insights.push({
          id: "coach-failure",
          category: "overload",
          severity: "warn",
          title: sig.title,
          detail: sig.detail,
          action: "Оставляй 1–2 повторения в запасе (RIR 1–2) на базовых подходах; в отказ иди только в последнем изолирующем подходе.",
          metric: `${bio.failureSets} в отказ`,
        });
      } else if (sig.id === "axial-load") {
        insights.push({
          id: "coach-axial",
          category: "overload",
          severity: "warn",
          title: sig.title,
          detail: sig.detail,
          action: "Замени часть подсобки на варианты без осевой нагрузки (жим ногами, сгибания ног, тяга с упором грудью).",
          metric: `${bio.axialHardSets} осевых`,
        });
      } else if (sig.id === "junk-volume") {
        insights.push({
          id: "coach-junk",
          category: "underload",
          severity: "info",
          title: sig.title,
          detail: sig.detail,
          action: "Подними рабочий вес на 2,5–5 кг или добавь повторений до RIR 1–3.",
          metric: `${bio.junkSets} лёгких`,
        });
      } else if (sig.id === "delt-imbalance" || sig.id === "chest-upper-gap" || sig.id === "calves-straight-knee-gap") {
        insights.push({
          id: `coach-${sig.id}`,
          category: "balance",
          severity: "info",
          title: sig.title,
          detail: sig.detail,
          action: "Добавь 2–3 целенаправленных подхода на отстающий пучок в ближайший тренировочный день.",
        });
      }
    }

    // 4. Недогруженность по ACWR или отстающим группам
    if (acwr !== null && acwr < 0.7 && acuteSets < 18) {
      insights.push({
        id: "acwr-underload",
        category: "underload",
        severity: "info",
        title: "Снижение недельного объёма",
        detail: `За 7 дней выполнено ${acuteSets} подходов против привычных ${chronicWeeklyAvg}/нед (ACWR ${acwr}). Если это не плановая разгрузка — стимула может не хватать для роста.`,
        action: "Вернись к привычной частоте тренировок и добери рабочий объём в RIR 1–2.",
        metric: `ACWR ${acwr}`,
      });
    }

    if (underloadedMuscles.length > 0 && acuteSets >= 10) {
      const list = underloadedMuscles.slice(0, 3).map((m) => `${m.name} (${m.sets})`).join(", ");
      insights.push({
        id: "muscle-underload",
        category: "underload",
        severity: "info",
        title: "Отстающие мышечные группы за 7 дней",
        detail: `Мало прямой нагрузки: ${list} экв. подх./нед.`,
        action: "Сделай эти группы приоритетом на ближайшей тренировке, пока они полностью свежие.",
        metric: `${underloadedMuscles.length} зон`,
      });
    }

    // 5. Дисбаланс Жимы/Тяги или Верх/Низ за 28 дней
    if (ratios.pushPullStatus === "push-dominant" && ratios.pushSets >= 12) {
      insights.push({
        id: "ratio-push-dominant",
        category: "balance",
        severity: "warn",
        title: "Перекос в жимы относительно тяг",
        detail: `За 4 недели: ${ratios.pushSets} жимовых подходов против ${ratios.pullSets} тяговых (${ratios.pushPullRatio ?? "∞"}:1). Избыток жимов перегружает переднюю дельту и плечевой сустав.`,
        action: "Держи баланс жим:тяга ближе к 1:1 — добавь горизонтальные тяги и работу на заднюю дельту.",
        metric: `${ratios.pushSets}:${ratios.pullSets}`,
      });
    } else if (ratios.upperLowerStatus === "upper-dominant" && ratios.upperSets >= 18) {
      insights.push({
        id: "ratio-upper-dominant",
        category: "balance",
        severity: "info",
        title: "Сильный перекос в верх тела",
        detail: `За 4 недели верх тела получил ${ratios.upperSets} подходов, низ — ${ratios.lowerSets}.`,
        action: "Добавь 1 полноценный день ног или 2 базовых движения на низ тела в неделю.",
        metric: `${ratios.upperSets}:${ratios.lowerSets}`,
      });
    }

    // 6. Силовой прогресс / Плато / Спад по e1RM
    const rising = liftTrends.filter((t) => t.status === "rising");
    const dips = liftTrends.filter((t) => t.status === "dip");
    const plateaus = liftTrends.filter((t) => t.status === "plateau");

    if (dips.length > 0) {
      const top = dips[0];
      insights.push({
        id: "strength-dip",
        category: "overload",
        severity: "warn",
        title: `Спад силы в «${top.name}»`,
        detail: `Расчётный 1ПМ снизился с ${top.priorE1rm} до ${top.recentE1rm} кг (${top.changePct}%) — частый маркер накопленной усталости или недосыпа.`,
        action: "Проверь восстановление и при повторении спада проведи разгрузочную неделю.",
        metric: `${top.changePct}%`,
      });
    }
    if (plateaus.length > 0 && dips.length === 0) {
      const top = plateaus[0];
      insights.push({
        id: "strength-plateau",
        category: "progress",
        severity: "info",
        title: `Плато в «${top.name}»`,
        detail: `За ${top.sessionsCount} тренировок e1RM держится на уровне ~${top.recentE1rm} кг (${top.changePct > 0 ? "+" : ""}${top.changePct}%).`,
        action: "Смени диапазон повторений (например, с 8–10 на 5–6) или добавь 1–2 качественных подхода в неделю.",
        metric: `${top.recentE1rm} кг`,
      });
    }
    if (rising.length > 0) {
      const best = rising.sort((a, b) => b.changePct - a.changePct)[0];
      insights.push({
        id: "strength-rising",
        category: "progress",
        severity: "good",
        title: `Уверенный рост: «${best.name}»`,
        detail: `Расчётный 1ПМ вырос с ${best.priorE1rm} до ${best.recentE1rm} кг (+${best.changePct}%) за последние недели.`,
        action: "Текущая схема работает — сохраняй этот объём и шаг прогрессии.",
        metric: `+${best.changePct}%`,
      });
    }

    // 7. Фидбек по Дэвиду Лейду (если есть цикл)
    if (laidAudit) {
      for (const sig of laidAudit.topSetFeedback) {
        insights.push({
          id: `coach-${sig.id}`,
          category: sig.id === "laid-missed-reps" ? "overload" : "balance",
          severity: sig.severity === "warn" ? "warn" : "info",
          title: `Дэвид Лейд · ${sig.title}`,
          detail: sig.detail,
          action:
            sig.id === "laid-missed-reps"
              ? "Открой карточку Лейда → «Обновить максимумы» и снизь рабочий 1ПМ на 5 %."
              : sig.id === "laid-easy-topsets"
                ? "Подними рабочий максимум на 2,5–5 кг со следующей недели."
                : "Открой «Дни недели» в карточке Лейда и поставь отдых перед днём ног.",
        });
      }
    }

    // Расчёт интегрального балла готовности/баланса (0–100)
    const hasData = recent28.length > 0;
    let score = hasData ? 86 : 0;
    const overloadFlags = insights.filter((i) => i.category === "overload" && (i.severity === "warn" || i.severity === "critical"));
    const underloadFlags = insights.filter((i) => i.category === "underload");
    const balanceFlags = insights.filter((i) => i.category === "balance" && i.severity === "warn");

    if (hasData) {
      for (const flag of overloadFlags) score -= flag.severity === "critical" ? 22 : 13;
      score -= underloadFlags.length * 9;
      score -= balanceFlags.length * 8;
      if (rising.length > 0) score += 8;
      if (bio.avgRir !== null && bio.avgRir >= 1 && bio.avgRir <= 2.5) score += 6;
      if (recent7.length >= 2 && recent7.length <= 6) score += 4;
      score = Math.max(15, Math.min(100, Math.round(score)));
    }

    let status: CoachLoadStatus = "optimal";
    let statusLabel = "Оптимальный режим";
    let headline = "Нагрузка и восстановление в балансе — можно спокойно прогрессировать.";

    if (!hasData) {
      status = "no_data";
      statusLabel = "Жду тренировки";
      headline = "Запиши 1–2 тренировки с весом и RIR — здесь появится разбор нагрузки, перегруза и прогресса.";
    } else if (overloadFlags.length >= 2 || overloadFlags.some((f) => f.severity === "critical")) {
      status = "overloaded";
      statusLabel = "Риск перегрузки";
      headline = "Накоплена высокая нагрузка — лучше сбавить объём или держать RIR 2–3.";
    } else if (underloadFlags.length >= 1 && overloadFlags.length === 0 && acuteSets < 12) {
      status = "underloaded";
      statusLabel = "Недогруз";
      headline = "Объём ниже твоей нормы — есть запас, чтобы добавить подходы или интенсивность.";
    } else if (overloadFlags.length === 1 || balanceFlags.length >= 1) {
      status = "attention";
      statusLabel = "Есть перекос";
      headline = "В целом идёшь хорошо, но есть 1–2 точки, которые стоит подправить.";
    }

    // Рекомендация следующей тренировки
    const freshGroups = readiness.filter((r) => r.state === "ready");
    const focusLabels = (freshGroups.length ? freshGroups : readiness.slice().sort((a, b) => b.ratio - a.ratio))
      .slice(0, 2)
      .map((g) => g.label);
    const nextSession: NextSessionSuggestion = !hasData
      ? {
          focusLabels: ["Всё тело"],
          recommendedRir: "RIR 2–3",
          headline: "Начни с базовой тренировки",
          reason: "Отметь веса и RIR — со второй сессии алгоритм подстроится под твой темп.",
        }
      : status === "overloaded"
        ? {
            focusLabels: focusLabels.length ? focusLabels : ["Лёгкое восстановление"],
            recommendedRir: "RIR 3–4",
            headline: `Разгрузочный акцент: ${focusLabels.join(" + ")}`,
            reason: "Сократи рабочие подходы на 30–50 % и не ходи в отказ, чтобы сбросить накопленную усталость.",
          }
        : {
            focusLabels,
            recommendedRir: "RIR 1–2",
            headline: `Свежие зоны: ${focusLabels.join(" + ")}`,
            reason:
              underloadedMuscles.length > 0
                ? `Группы готовы к работе; дополнительно стоит добрать объём на ${underloadedMuscles[0].name.toLowerCase()}.`
                : "Эти мышечные группы полностью восстановились и готовы к прогрессии веса.",
          };

    // Сортируем инсайты по важности
    const sevRank: Record<CoachSeverity, number> = { critical: 0, warn: 1, good: 2, info: 3 };
    insights.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

    return {
      score,
      status,
      statusLabel,
      headline,
      acwr,
      acwrLabel,
      acuteSets,
      chronicWeeklyAvg,
      workouts7d: recent7.length,
      workouts28d: recent28.length,
      overloadedMuscles,
      underloadedMuscles,
      liftTrends,
      insights,
      nextSession,
      biomechanics: bio,
      readiness,
      ratios,
      laidAudit,
    };
  }
}
