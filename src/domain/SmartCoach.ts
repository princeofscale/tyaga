import { addCalendarDays } from "../lib/calendar";
import type { Muscle, Routine, Workout } from "../lib/types";
import { AnalyticsFacts } from "./AnalyticsFacts";
import { BiomechanicsEngine, type LaidCycleAudit, type WeeklyBiomechanicsReport } from "./BiomechanicsEngine";
import { BiomechanicsProfileStore } from "./BiomechanicsProfile";
import { BodyweightTracker } from "./BodyweightTracker";
import {
  DeloadEngine,
  type DeloadEvaluationV2,
  type EnergyStatus,
} from "./DeloadEngine";
import type { DeloadPlanRecord } from "./DeloadPlan";
import { GymInventoryStore } from "./GymInventory";
import { LaidDupPlan } from "./LaidDupPlan";
import {
  MuscleReadiness,
  type MuscleReadinessItem,
  type MuscleReadinessV2Item,
} from "./MuscleReadiness";
import { OneRepMaxFormulas } from "./OneRepMaxFormulas";
import { PersonalRecordsCalculator, type BalanceRatios } from "./PersonalRecords";
import {
  ProgressionEngine,
  toProgressionInventory,
  type DetrainingPlan,
} from "./ProgressionEngine";
import { ExerciseAvoidStore } from "./SubstitutionPolicy";
import { TrainingCalendar } from "./TrainingCalendar";
import { TrainingProgram } from "./TrainingProgram";
import { VolumeLandmarksCalculator } from "./VolumeLandmarks";
import { exerciseById, exerciseForEntry } from "../lib/model";

export type CoachLoadStatus = "no_data" | "optimal" | "overloaded" | "underloaded" | "attention";
export type CoachInsightCategory = "overload" | "underload" | "progress" | "balance";
export type CoachSeverity = "critical" | "warn" | "good" | "info";

export type CoachStateV2 =
  | "PEAK_PROGRESSIVE"
  | "MANAGE_FATIGUE"
  | "DELOAD_ACTIVE"
  | "OVERLOAD_WARNING";

export interface CoachActionV2 {
  id: string;
  priority: 1 | 2 | 3;
  kind: "deload" | "detraining" | "tm_update" | "plateau" | "readiness" | "progression";
  title: string;
  detail: string;
  metric?: string;
}

export interface WeightIncreaseRecommendationV2 {
  exerciseId: string;
  name: string;
  fromKg: number;
  toKg: number;
  targetReps: number;
  label: string;
}

export interface SmartCoachV2Summary {
  state: CoachStateV2;
  stateLabel: string;
  verdict: string;
  deload: DeloadEvaluationV2;
  readiness: MuscleReadinessV2Item[];
  detraining: DetrainingPlan;
  /** Строго максимум 3 приоритизированных действия с правилами подавления шума. */
  actions: CoachActionV2[];
  /** Рекомендации повышения веса (гарантированно пусто при DELOAD_ACTIVE, OVERLOAD_WARNING и Detraining). */
  weightIncreaseRecommendations: WeightIncreaseRecommendationV2[];
  silenceActive: boolean;
}

export interface SmartCoachAnalyzeOptions {
  isLongLimbed?: boolean;
  energyStatus?: EnergyStatus;
  currentBodyweightKg?: number;
}

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
  confidence: "high" | "moderate" | "low";
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
  /** Выполнение запланированных тренировок по программам за последние 14 дней. */
  planAdherence: { planned: number; done: number; pct: number } | null;
  /** Сдвиг среднего RIR за последние 14 дн. vs предыдущие 15–42 дн. (отрицательный = те же веса даются тяжелее). */
  rirDrift: number | null;
  /** Упражнения, скрытые по причине дискомфорта/боли (до пересмотра) или помеченные painFlags. */
  painFlagsSummary: { count: number; names: string[] };
  /** Активна ли сейчас разгрузочная неделя (ручная разгрузка, периодическая 5-я неделя или неделя 10 после Лейда). */
  activeDeload: { active: boolean; reason: string } | null;
  biomechanics: WeeklyBiomechanicsReport;
  readiness: MuscleReadinessItem[];
  ratios: BalanceRatios;
  laidAudit: LaidCycleAudit | null;
  /** Модуль 6: Единое ядро SmartCoach v2 (EWMA-делoуд, 12-групповая готовность, DDP/Detraining, правила тишины). */
  v2: SmartCoachV2Summary;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function daysDiff(fromIso: string, toIso: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86_400_000),
  );
}

function inferEnergyAndBodyweight(
  accountId: string | undefined,
  today: string,
  timeZone: string | undefined,
  opts?: SmartCoachAnalyzeOptions,
): { energyStatus: EnergyStatus; currentBodyweightKg: number } {
  let energyStatus: EnergyStatus = opts?.energyStatus ?? "unknown";
  let currentBodyweightKg = opts?.currentBodyweightKg ?? 75;
  if (accountId && (opts?.energyStatus === undefined || opts?.currentBodyweightKg === undefined)) {
    try {
      const tracker = new BodyweightTracker(accountId, timeZone);
      const stats = tracker.getStats();
      if (opts?.currentBodyweightKg === undefined && stats?.currentKg) {
        currentBodyweightKg = stats.currentKg;
      }
      if (opts?.energyStatus === undefined) {
        const verdict = tracker.getNeatVerdict(today);
        if (verdict.status === "loss_optimal" || verdict.status === "loss_fast" || verdict.status === "loss_slow") {
          energyStatus = "deficit";
        } else if (verdict.status === "neat_plateau") {
          energyStatus = "maintenance";
        } else if (verdict.status === "optimal_gain") {
          energyStatus = "optimal_surplus";
        } else if (verdict.status === "too_fast") {
          energyStatus = "high_surplus";
        }
      }
    } catch {
      // Ignore storage errors in non-browser/test environments
    }
  }
  return { energyStatus, currentBodyweightKg };
}

/**
 * Детерминированный спортивно-аналитический «умный ИИ-тренер».
 * Анализирует реальный журнал: EWMA-усталость (v2) и ACWR (v1), качество стимула (RIR, SFR),
 * осевую нагрузку, плато по e1RM, баланс жимов/тяг и 12-групповую готовность.
 */
export class SmartCoach {
  static analyze(
    workouts: Workout[],
    routines: Routine[],
    today: string,
    timeZone?: string,
    now = new Date(),
    accountId?: string,
    deload?: DeloadPlanRecord | null,
    options?: SmartCoachAnalyzeOptions,
  ): SmartCoachReport {
    const bio = BiomechanicsEngine.analyzeWeek(workouts, today, { timeZone, now });
    const readiness = MuscleReadiness.fromWorkouts(workouts, today, timeZone);
    const volumeWeek = VolumeLandmarksCalculator.assessWeek(workouts, today, { timeZone, now });
    const deloadAssessment = DeloadEngine.assessFatigue(workouts, now, timeZone);
    const rirDrift = deloadAssessment.rirDrift ?? null;

    // Выполнение плана за последние 14 дней (decision metric #1)
    let planned14 = 0;
    let done14 = 0;
    if (routines.length > 0) {
      for (let d = 13; d >= 0; d--) {
        const dayIso = addCalendarDays(today, -d);
        const slots = TrainingCalendar.onDate(routines, dayIso);
        for (const slot of slots) {
          planned14++;
          if (TrainingCalendar.completed(slot, workouts)) done14++;
        }
      }
    }
    const planAdherence =
      planned14 > 0
        ? { planned: planned14, done: done14, pct: Math.round((done14 / planned14) * 100) }
        : null;

    // Сводка ограничений по боли (avoid list + painFlags в циклах Лейда)
    const painNameSet = new Set<string>();
    if (accountId) {
      for (const item of new ExerciseAvoidStore(accountId).read()) {
        if (item.reason === "pain") painNameSet.add(exerciseById(item.exerciseId)?.name ?? item.exerciseId);
      }
    }
    for (const r of routines) {
      const p = LaidDupPlan.periodizationOf(r);
      if (p?.painFlags?.length) {
        for (const lift of p.painFlags) {
          painNameSet.add(LaidDupPlan.liftLabel(lift, p.substitutions));
        }
      }
    }
    const painFlagsSummary = { count: painNameSet.size, names: [...painNameSet] };

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

    // Перегруженные (выше MRV своей зоны) и недогруженные (<6 экв. подх./нед) мышцы
    const overloadedMuscles = volumeWeek.assessments
      .filter((a) => a.actualSets > a.bracket.mrv)
      .sort((a, b) => (b.actualSets - b.bracket.mrv) - (a.actualSets - a.bracket.mrv))
      .map((a) => ({ muscle: a.muscle, name: a.muscleName, sets: round1(a.actualSets), mrv: a.bracket.mrv }));

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
      const confidence: LiftTrend["confidence"] =
        sessionsCount >= 6 && pr.bestE1rm.reps <= 5
          ? "high"
          : sessionsCount >= 4 && pr.bestE1rm.reps <= 10
            ? "moderate"
            : "low";
      liftTrends.push({
        exerciseId: pr.exerciseId,
        name: pr.name,
        recentE1rm: pr.bestE1rm.e1rm,
        priorE1rm: prior.bestE1rm.e1rm,
        changePct,
        sessionsCount,
        confidence,
        status,
      });
    }
    liftTrends.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

    // Аудит цикла Дэвида Лейда и проверка активной разгрузочной недели
    const laidCycles = LaidDupPlan.cycles(routines);
    const laidAudit = laidCycles.length > 0 ? BiomechanicsEngine.auditLaidCycle(laidCycles[0], workouts, today) : null;
    const isManualDeload = !!deload && deload.until >= today;
    const periodicDeloadRoutine = routines.find(
      (r) => !LaidDupPlan.periodizationOf(r) && new TrainingProgram(r).isDeload(workouts, today),
    );
    const laidStates = laidCycles.map((c) => ({ cycle: c, state: LaidDupPlan.cycleState(c, workouts, today) }));
    const laidDeloadEntry = laidStates.find((x) => x.state.isCurrentDeload);
    const laidFinishedEntry = laidStates.find((x) => !x.state.isCurrentDeload && x.state.position.finished);
    const activeDeload: SmartCoachReport["activeDeload"] = isManualDeload
      ? { active: true, reason: `Включена разгрузка до ${deload!.until}` }
      : laidDeloadEntry
        ? {
            active: true,
            reason: `Разгрузочная неделя цикла Дэвида Лейда (неделя ${laidDeloadEntry.state.rawWeek + 1})`,
          }
        : periodicDeloadRoutine
          ? { active: true, reason: `Плановая разгрузочная неделя программы «${periodicDeloadRoutine.name}»` }
          : laidFinishedEntry
            ? { active: true, reason: "Цикл Дэвида Лейда (9 нед.) завершён — рекомендована разгрузочная неделя (неделя 10)" }
            : null;
    const isDeloadWeek = !!activeDeload?.active;

    // Генерация приоритетных инсайтов
    const insights: CoachInsight[] = [];

    if (isDeloadWeek && activeDeload) {
      insights.push({
        id: "active-deload",
        category: "balance",
        severity: "info",
        title: "Разгрузочная неделя по плану",
        detail: `${activeDeload.reason}. Рабочие веса снижаются (включая тренажёры — 60–85 %), подходы режутся примерно вдвое, целевой запас RIR 3–4.`,
        action: "Не гонись за прошлым весом и не ходи в отказ — задача недели сбросить усталость перед следующей волной.",
        metric: "RIR 3–4",
      });
    }

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

    // 2. Перегруженные мышечные группы (выше индивидуального MRV зоны)
    if (overloadedMuscles.length > 0) {
      const list = overloadedMuscles.slice(0, 3).map((m) => `${m.name} (${m.sets} при потолке ${m.mrv})`).join(", ");
      const maxExcess = Math.max(...overloadedMuscles.map((m) => m.sets - m.mrv));
      insights.push({
        id: "muscle-overload",
        category: "overload",
        severity: maxExcess >= 4 ? "critical" : "warn",
        title: "Превышен недельный объём по мышцам",
        detail: `${list} экв. подх./нед — выше максимального восстанавливаемого объёма (MRV). Отдача от дополнительных подходов падает, а локальная усталость копится.`,
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

    // 4. Недогруженность по ACWR или отстающим группам (в разгрузочную неделю спад объёма — норма, не предупреждаем)
    if (!isDeloadWeek && acwr !== null && acwr < 0.7 && acuteSets < 18) {
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

    if (!isDeloadWeek && underloadedMuscles.length > 0 && acuteSets >= 10) {
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

    if (isDeloadWeek) {
      status = "optimal";
      statusLabel = "Разгрузочная неделя";
      headline = "Идёт разгрузка по плану — держи 60–85 % веса (включая тренажёры), половину подходов и RIR 3–4.";
    } else if (!hasData) {
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
    const nextSession: NextSessionSuggestion = isDeloadWeek
      ? {
          focusLabels: focusLabels.length ? focusLabels : ["Разгрузка"],
          recommendedRir: "RIR 3–4",
          headline: laidFinishedEntry
            ? "Разгрузка после 9 недель Лейда"
            : "Разгрузочная тренировка по плану",
          reason:
            "Снизь рабочие веса до 60–85 % (включая тренажёры), сократи подходы вдвое и не ходи в отказ — прошлый рабочий вес сейчас не цель.",
        }
      : !hasData
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

    // === Модуль 6: SmartCoach v2 (интеграция модулей 1–5 с жёстким UX-бюджетом и Silence Rules) ===
    const { energyStatus, currentBodyweightKg } = inferEnergyAndBodyweight(
      accountId,
      today,
      timeZone,
      options,
    );
    const isLongLimbed = options?.isLongLimbed ?? BiomechanicsProfileStore.read().longLevers;
    const deloadV2 = DeloadEngine.evaluateV2(workouts, {
      now,
      today,
      timeZone,
      isLongLimbed,
      energyStatus,
      currentBodyweightKg,
      painFlagsCount: painFlagsSummary.count,
      corePainRepeated: routines.some((r) => (LaidDupPlan.periodizationOf(r)?.painFlags?.length ?? 0) > 0),
    });
    const readinessV2 = MuscleReadiness.fromWorkoutsV2(workouts, today, timeZone, now);

    // Определяем перерыв с последней завершённой тренировки (Detraining)
    const pastCompletedDates = workouts
      .filter((w) => w.date <= today && w.exercises.some((e) => e.sets.some((s) => s.done && !s.warmup)))
      .map((w) => w.date)
      .sort();
    const lastWorkoutDate = pastCompletedDates[pastCompletedDates.length - 1] ?? null;
    const gapDays = lastWorkoutDate ? daysDiff(lastWorkoutDate, today) : 0;
    const detraining = ProgressionEngine.evaluateDetraining(gapDays);

    // Определяем интегральный статус SmartCoach v2 (без бессмысленных произвольных баллов)
    const baseGroups = new Set(["erectors", "hamstrings", "quads", "chest", "lats_upper_back"]);
    const recoveringBase = readinessV2.filter((g) => baseGroups.has(g.id) && g.readinessPct < 75);

    let coachStateV2: CoachStateV2 = "PEAK_PROGRESSIVE";
    let stateLabelV2 = "Готов к прогрессу";
    let verdictV2 = "Нагрузка в продуктивном коридоре, базовые группы готовы к росту весов.";

    if (isDeloadWeek) {
      coachStateV2 = "DELOAD_ACTIVE";
      stateLabelV2 = "Режим разгрузки";
      verdictV2 = activeDeload?.reason
        ? `${activeDeload.reason} — держи целевой RIR 3–4 без гонки за весами.`
        : "Идёт плановая разгрузка — сбрось усталость перед следующей волной.";
    } else if (deloadV2.status === "deload_recommended") {
      coachStateV2 = "OVERLOAD_WARNING";
      stateLabelV2 = "Нужна разгрузка";
      verdictV2 = deloadV2.summary;
    } else if (detraining.active) {
      coachStateV2 = "MANAGE_FATIGUE";
      stateLabelV2 = "Возврат после паузы";
      verdictV2 = `Перерыв ${detraining.gapDays} дн. — начни с ${Math.round(detraining.weightMultiplier * 100)} % веса и ${Math.round(detraining.volumeMultiplier * 100)} % объёма (RIR ${detraining.rirFloor}+).`;
    } else if (!hasData) {
      coachStateV2 = "PEAK_PROGRESSIVE";
      stateLabelV2 = "Ожидаю данные";
      verdictV2 = "Запиши 1–2 тренировки с весом и RIR — здесь появятся EWMA-усталость и готовность 12 групп.";
    } else if (recoveringBase.length > 0 || deloadV2.status === "productive_overreach") {
      coachStateV2 = "MANAGE_FATIGUE";
      stateLabelV2 = "Контроль усталости";
      verdictV2 =
        recoveringBase.length > 0
          ? `Недовосстановлены: ${recoveringBase.slice(0, 2).map((g) => `${g.label.toLowerCase()} (${g.readinessPct}%)`).join(", ")} — работай по свежим зонам или держи RIR 2.`
          : deloadV2.summary;
    }

    // Правила тишины (Silence Rules): при DELOAD_ACTIVE / OVERLOAD_WARNING / Detraining подавляем повышения и плато
    const silenceActive =
      coachStateV2 === "DELOAD_ACTIVE" ||
      coachStateV2 === "OVERLOAD_WARNING" ||
      detraining.active;

    // Расчёт рекомендаций повышения веса DDP (строго подавляется при silenceActive)
    const weightIncreaseRecommendations: WeightIncreaseRecommendationV2[] = [];
    if (!silenceActive && hasData) {
      const inv = toProgressionInventory(GymInventoryStore.read());
      const seenEx = new Set<string>();
      for (const r of routines) {
        if (r.progression !== "double" || LaidDupPlan.periodizationOf(r)) continue;
        for (const plan of r.exercises) {
          if (seenEx.has(plan.exerciseId)) continue;
          const def = exerciseForEntry(plan);
          if (!def || !def.recording.e1rmEligible) continue;
          // Ищем последнюю неразгрузочную сессию этого упражнения
          const lastW = workouts
            .filter(
              (w) =>
                w.date <= today &&
                !DeloadEngine.isDeloadName(w.name) &&
                w.exercises.some(
                  (e) =>
                    e.exerciseId === plan.exerciseId &&
                    e.sets.some((s) => s.done && !s.warmup && s.weight > 0),
                ),
            )
            .sort((a, b) => b.date.localeCompare(a.date))[0];
          if (!lastW) continue;
          const entry = lastW.exercises.find((e) => e.exerciseId === plan.exerciseId);
          if (!entry) continue;
          const prevSets = entry.sets
            .filter((s) => s.done && !s.warmup && s.weight > 0)
            .map((s) => ({ weight: s.weight, reps: s.reps, rir: s.rir }));
          if (!prevSets.length) continue;

          const recs = ProgressionEngine.recommendDdpSets({
            previousSets: prevSets,
            repMin: plan.repMin ?? r.repMin,
            repMax: plan.repMax ?? r.repMax,
            loadMode: def.recording.loadMode,
            inventory: inv,
          });
          const firstUpgrade = recs.find((rec) => rec.action === "increase_weight");
          if (firstUpgrade) {
            seenEx.add(plan.exerciseId);
            const prevW = prevSets[firstUpgrade.setIndex].weight;
            weightIncreaseRecommendations.push({
              exerciseId: plan.exerciseId,
              name: def.name,
              fromKg: prevW,
              toKg: firstUpgrade.recommendedWeight,
              targetReps: firstUpgrade.recommendedReps,
              label: `${def.name}: ${prevW} → ${firstUpgrade.recommendedWeight} кг × ${firstUpgrade.recommendedReps}`,
            });
          }
        }
      }
    }

    // Детектор плато по RIR-нормализованному e1RM (подавляется при silenceActive)
    const plateauActions: CoachActionV2[] = [];
    if (!silenceActive && hasData) {
      const p35Start = addCalendarDays(today, -35);
      const recent35 = new AnalyticsFacts(workouts, {
        from: p35Start,
        through: today,
        timeZone,
        now,
      }).workouts();
      const sessionsByEx = new Map<
        string,
        Array<{ date: string; bestE1rm: number; confidence: number; avgRir: number | null }>
      >();
      for (const w of recent35) {
        if (DeloadEngine.isDeloadName(w.name)) continue;
        for (const e of w.exercises) {
          const def = exerciseForEntry(e);
          if (!def?.recording.e1rmEligible) continue;
          let best = 0;
          let bestConf = 0;
          let rirSum = 0;
          let rirN = 0;
          for (const s of e.sets) {
            if (!s.done || s.warmup) continue;
            if (s.rir !== null) {
              rirSum += s.rir;
              rirN++;
            }
            const est = OneRepMaxFormulas.estimateV2({
              weight: s.weight,
              reps: s.reps,
              rir: s.rir,
              loadMode: def.recording.loadMode,
              currentBodyweightKg: e.bodyMassKg ?? currentBodyweightKg,
              isWarmup: s.warmup,
              e1rmEligible: def.recording.e1rmEligible,
            });
            if (!est.isExcludedFromTrend && est.e1rm > best) {
              best = est.e1rm;
              bestConf = est.confidence;
            }
          }
          if (best > 0) {
            const arr = sessionsByEx.get(e.exerciseId) ?? [];
            arr.push({
              date: w.date,
              bestE1rm: best,
              confidence: bestConf,
              avgRir: rirN > 0 ? rirSum / rirN : null,
            });
            sessionsByEx.set(e.exerciseId, arr);
          }
        }
      }
      const inv = toProgressionInventory(GymInventoryStore.read());
      for (const [exId, pts] of sessionsByEx) {
        const def = exerciseById(exId);
        if (!def || pts.length < 4) continue;
        const pDec = ProgressionEngine.detectPlateau({
          sessions: pts,
          isCoreOrDupFixed: ["squat", "bench", "deadlift-bar", "trap-bar-deadlift", "ohp-bar"].includes(exId),
          weeksInCurrentVariant: 6,
          currentRepRange: [6, 10],
          loadMode: def.recording.loadMode,
          globalDeloadRecommended: deloadV2.status === "deload_recommended",
          inventory: inv,
        });
        if (pDec.isPlateau) {
          plateauActions.push({
            id: `v2-plateau-${exId}`,
            priority: 3,
            kind: "plateau",
            title: `Плато: ${def.name}`,
            detail: pDec.reason,
            metric: `${pDec.growthPct > 0 ? "+" : ""}${pDec.growthPct}%`,
          });
          break;
        }
      }
    }

    // Собираем строго максимум 3 приоритизированных действия (бюджет UX)
    const actionsV2: CoachActionV2[] = [];
    if (coachStateV2 === "OVERLOAD_WARNING" && deloadV2.protocolParams) {
      const modeName: Record<typeof deloadV2.recommendedMode, string> = {
        none: "Без разгрузки",
        local_micro_deload: "Локальная микро-разгрузка",
        volume_deload: "Объёмная разгрузка",
        intensity_taper: "Тапер-разгрузка",
        pivot_recovery: "Восстановительный Pivot-блок",
      };
      actionsV2.push({
        id: "v2-deload-action",
        priority: 1,
        kind: "deload",
        title: `${modeName[deloadV2.recommendedMode]} на ${deloadV2.protocolParams.durationDays} дн.`,
        detail: `Вес ${Math.round(deloadV2.protocolParams.weightMultiplier * 100)} %, подходы ${Math.round(deloadV2.protocolParams.volumeMultiplier * 100)} %, запас не ниже RIR ${deloadV2.protocolParams.targetRIRFloor}.`,
        metric: `RIR ${deloadV2.protocolParams.targetRIRFloor}+`,
      });
    } else if (coachStateV2 === "DELOAD_ACTIVE") {
      actionsV2.push({
        id: "v2-deload-active",
        priority: 1,
        kind: "deload",
        title: "Разгрузка по плану активна",
        detail: "Повышения весов и алерты плато временно скрыты — фокусируйся на технике и восстановлении.",
        metric: "RIR 3–4",
      });
    } else if (detraining.active) {
      actionsV2.push({
        id: "v2-detraining",
        priority: 1,
        kind: "detraining",
        title: detraining.label,
        detail: `Стартуй с ${Math.round(detraining.weightMultiplier * 100)} % веса и ${Math.round(detraining.volumeMultiplier * 100)} % подходов; возврат за ${detraining.rampSessions} тр.`,
        metric: `−${Math.round((1 - detraining.weightMultiplier) * 100)}%`,
      });
    }

    if (!silenceActive && weightIncreaseRecommendations.length > 0 && actionsV2.length < 3) {
      const first = weightIncreaseRecommendations[0];
      actionsV2.push({
        id: `v2-ddp-${first.exerciseId}`,
        priority: 2,
        kind: "progression",
        title: `Готово к росту веса: ${first.name}`,
        detail: `DDP: цель взята чисто — поднимай до ${first.toKg} кг × ${first.targetReps} в первом подходе.`,
        metric: `+${Math.round((first.toKg - first.fromKg) * 10) / 10} кг`,
      });
    }

    if (!silenceActive && plateauActions.length > 0 && actionsV2.length < 3) {
      actionsV2.push(plateauActions[0]);
    }

    if (!detraining.active && recoveringBase.length > 0 && actionsV2.length < 3) {
      const worst = [...recoveringBase].sort((a, b) => a.readinessPct - b.readinessPct)[0];
      actionsV2.push({
        id: `v2-readiness-${worst.id}`,
        priority: 3,
        kind: "readiness",
        title: `${worst.label}: восстановление ${worst.readinessPct}%`,
        detail: "Ниже порога 75 % — лучше отдать приоритет свежим группам или снизить объём на эту зону.",
        metric: `${worst.readinessPct}%`,
      });
    }

    const v2: SmartCoachV2Summary = {
      state: coachStateV2,
      stateLabel: stateLabelV2,
      verdict: verdictV2,
      deload: deloadV2,
      readiness: readinessV2,
      detraining,
      actions: actionsV2.slice(0, 3),
      weightIncreaseRecommendations,
      silenceActive,
    };

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
      planAdherence,
      rirDrift,
      painFlagsSummary,
      activeDeload,
      biomechanics: bio,
      readiness,
      ratios,
      laidAudit,
      v2,
    };
  }
}
