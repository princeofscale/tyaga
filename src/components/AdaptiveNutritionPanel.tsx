import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Check,
  Flame,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import {
  AdaptiveNutritionEngine,
  NutritionStore,
  PHASE_CONFIG,
  type BiologicalSex,
  type BodyweightEntry,
  type DupDayType,
  type EnergyStatus,
  type FfmFormula,
  type GoalMode,
  type NeatLevel,
  type NutritionState,
  type TrainingLevel,
} from "../domain/AdaptiveNutritionEngine";
import { BiomechanicsProfileStore } from "../domain/BiomechanicsProfile";
import { DateText } from "../domain/DateText";
import { fmt } from "../lib/model";

const GOAL_META: Array<{ id: GoalMode; label: string; short: string }> = [
  { id: "lean_bulk", label: "Сухой набор", short: "+0,15…0,4%/нед" },
  { id: "recomp", label: "Рекомп", short: "Удержание / −150" },
  { id: "maintenance", label: "Поддержание", short: "0%/нед" },
  { id: "mini_cut", label: "Мини-сушка", short: "до 6 нед" },
  { id: "cut", label: "Сушка", short: "−0,5…0,75%/нед" },
];

const DAY_LABELS: Record<DupDayType, { title: string; offset: string }> = {
  legs: { title: "Ноги", offset: "+12% У" },
  push: { title: "Жим", offset: "база" },
  pull: { title: "Тяга", offset: "+6% У" },
  rest: { title: "Отдых", offset: "−18% У" },
  deload: { title: "Разгрузка", offset: "TDEE" },
};

const ENERGY_STATUS_LABEL: Record<EnergyStatus, string> = {
  deficit: "Дефицит",
  maintenance: "Поддержание",
  optimal_surplus: "Оптим. профицит",
  high_surplus: "Высокий профицит",
  unknown: "Нет данных",
};

const TDEE_STATUS_LABEL: Record<string, string> = {
  cold_start_no_weights: "Ждём замеры",
  cold_start: "Стартовый приор",
  calibrating: "Калибровка Калмана",
  converged: "Откалибровано",
  holding_low_adherence: "Заморожен (<10/14)",
  lite_trend_only: "Lite · тренд веса",
  lite_insufficient_weighins: "Lite · мало замеров",
};

const DIET_BREAK_TEXT: Record<string, string> = {
  mini_cut_max_duration_6w: "Достигнут лимит мини-сушки (6 недель).",
  metabolic_adaptation_gt_12pct: "Расход TDEE снизился более чем на 12 % от базового.",
  prolonged_cut_fatigue_or_strength_drop:
    "Длительная сушка (10+ нед.) с признаками адаптации или усталости.",
};

interface AdaptiveNutritionPanelProps {
  accountId: string;
  today: string;
  entries: readonly BodyweightEntry[];
  currentWeightKg: number | null;
}

export function AdaptiveNutritionPanel({
  accountId,
  today,
  entries,
  currentWeightKg,
}: AdaptiveNutritionPanelProps) {
  const store = useMemo(() => new NutritionStore(accountId), [accountId]);
  const engine = useMemo(() => new AdaptiveNutritionEngine(), []);

  const [state, setState] = useState<NutritionState>(() =>
    store.read(today, currentWeightKg ?? 80, BiomechanicsProfileStore.read().longLevers),
  );
  const [selectedDay, setSelectedDay] = useState<DupDayType>("legs");
  const [logDate, setLogDate] = useState(today);
  const [caloriesInput, setCaloriesInput] = useState("");
  const [proteinInput, setProteinInput] = useState("");
  const [logDayType, setLogDayType] = useState<DupDayType>("push");
  const [partialLog, setPartialLog] = useState(false);
  const [caloriesTouched, setCaloriesTouched] = useState(false);
  const [formNotice, setFormNotice] = useState("");
  const [formError, setFormError] = useState("");

  const idPrefix = useId();
  const caloriesRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setState(store.read(today, currentWeightKg ?? 80, BiomechanicsProfileStore.read().longLevers));
    setLogDate(today);
  }, [store, today, currentWeightKg]);

  const effectiveProfile = useMemo(
    () => ({
      ...state.profile,
      weightKg: currentWeightKg ?? state.profile.weightKg,
    }),
    [state.profile, currentWeightKg],
  );

  const weeksInPhase = useMemo(
    () => NutritionStore.weeksSince(state.phaseStartedDate, today),
    [state.phaseStartedDate, today],
  );

  const cycle = useMemo(
    () =>
      engine.runFullCycle({
        profile: effectiveProfile,
        weighIns: entries,
        nutritionLogs: state.logs,
        goalMode: state.goalMode,
        todayDayType: selectedDay,
        asOfDate: today,
        creatineStartDate: state.creatineStartDate,
        previousStatus: state.lastEnergyStatus,
        checkInOptions: {
          previousTargetKcal: state.currentTargetKcal,
          weeksInPhase,
        },
        enableCarbCycling: state.carbCyclingEnabled,
      }),
    [
      engine,
      effectiveProfile,
      entries,
      state.logs,
      state.goalMode,
      selectedDay,
      today,
      state.creatineStartDate,
      state.lastEnergyStatus,
      state.currentTargetKcal,
      weeksInPhase,
      state.carbCyclingEnabled,
    ],
  );

  // Persist hysteresis energy status when it changes cleanly
  useEffect(() => {
    if (
      cycle.energyBridge.energyStatus !== "unknown" &&
      cycle.energyBridge.energyStatus !== state.lastEnergyStatus
    ) {
      const next = store.save({ ...state, lastEnergyStatus: cycle.energyBridge.energyStatus });
      setState(next);
    }
  }, [cycle.energyBridge.energyStatus, state, store]);

  // Compute all 5 DUP day macro allocations (Pro uses nextTargetKcal; Lite previews prior + phase delta >= safetyFloor)
  const macroBudgetKcal = useMemo(() => {
    if (cycle.checkIn.nextTargetKcal !== null) return cycle.checkIn.nextTargetKcal;
    const cfg = PHASE_CONFIG[state.goalMode];
    const level = effectiveProfile.trainingLevel ?? "intermediate";
    const rate = cfg.ratePctByLevel[level];
    const rawDelta = ((rate / 100) * cycle.tdee.trendWeightKg * cfg.kcalPerKg) / 7;
    const clampedDelta = Math.max(cfg.deltaBounds[0], Math.min(cfg.deltaBounds[1], rawDelta));
    const est = Math.round((cycle.tdee.priorTdeeKcal + clampedDelta) / 10) * 10;
    return Math.max(cycle.checkIn.safetyFloorKcal, est);
  }, [cycle, state.goalMode, effectiveProfile.trainingLevel]);

  const dupPlan = useMemo(() => {
    const days: DupDayType[] = ["legs", "push", "pull", "rest", "deload"];
    return days.map((d) =>
      engine.macroPeriodizer.allocateDailyMacros(
        macroBudgetKcal,
        cycle.tdee.trendWeightKg,
        cycle.tdee.prior.ffmKg,
        effectiveProfile.sex,
        state.goalMode,
        d,
        cycle.tdee.adaptiveTdeeKcal,
        state.carbCyclingEnabled,
      ),
    );
  }, [
    engine,
    macroBudgetKcal,
    cycle.tdee.trendWeightKg,
    cycle.tdee.prior.ffmKg,
    cycle.tdee.adaptiveTdeeKcal,
    effectiveProfile.sex,
    state.goalMode,
    state.carbCyclingEnabled,
  ]);

  const activeMacro = dupPlan.find((m) => m.dayType === selectedDay) ?? dupPlan[0];
  const latestTrendPt = cycle.tdee.trendSeries[cycle.tdee.trendSeries.length - 1];
  const creatineOffsetKg = latestTrendPt?.creatineOffsetKg ?? 0;

  const updateState = (patch: Partial<NutritionState>) => {
    const next = store.save({ ...state, ...patch });
    setState(next);
  };

  const updateProfile = (patch: Partial<NutritionState["profile"]>) => {
    updateState({ profile: { ...state.profile, ...patch } });
  };

  const handleGoalChange = (nextGoal: GoalMode) => {
    if (nextGoal === state.goalMode) return;
    updateState({
      goalMode: nextGoal,
      phaseStartedDate: today,
      currentTargetKcal: null,
    });
    setFormNotice(`Фаза переключена: ${GOAL_META.find((g) => g.id === nextGoal)?.label ?? nextGoal}`);
  };

  const validateCalories = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return "Укажи калории за день (например, 2850).";
    const num = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(num) || num < 0 || num > 15000) {
      return "Введи число от 0 до 15000 ккал.";
    }
    return "";
  };

  const handleLogSubmit = (e: FormEvent) => {
    e.preventDefault();
    setCaloriesTouched(true);
    const err = validateCalories(caloriesInput);
    if (err) {
      setFormError(err);
      setFormNotice("");
      caloriesRef.current?.focus();
      return;
    }
    const kcal = Math.round(Number(caloriesInput.trim().replace(",", ".")));
    const proteinVal = proteinInput.trim()
      ? Math.round(Number(proteinInput.trim().replace(",", ".")))
      : undefined;

    const formEl = e.currentTarget as HTMLFormElement;
    const next = store.upsertLog(state, {
      date: logDate,
      caloriesKcal: kcal,
      proteinG: proteinVal !== undefined && Number.isFinite(proteinVal) ? proteinVal : undefined,
      dayType: logDayType,
      partialLog,
    });
    setState(next);
    setCaloriesInput("");
    setProteinInput("");
    setPartialLog(false);
    setCaloriesTouched(false);
    setFormError("");
    setFormNotice(`День ${DateText.day(logDate)} сохранён (${kcal} ккал)`);
    formEl.reset();
  };

  const caloriesInvalid = caloriesTouched && Boolean(formError);
  const caloriesId = `${idPrefix}-kcal`;
  const caloriesErrId = `${idPrefix}-kcal-err`;
  const proteinId = `${idPrefix}-prot`;
  const dayTypeId = `${idPrefix}-day`;
  const dateId = `${idPrefix}-date`;
  const partialId = `${idPrefix}-partial`;
  const cyclingId = `${idPrefix}-cycling`;
  const logFormHeadingId = `${idPrefix}-log-title`;

  const fourDayMean = Math.round(
    dupPlan
      .filter((d) => d.dayType !== "deload")
      .reduce((acc, d) => acc + d.targetKcal, 0) / 4,
  );

  return (
    <section className="nut-shell" aria-label="Адаптивное питание и TDEE Тяга v5">
      {/* Main Telemetry Card */}
      <article className="nut-card nut-hero-card">
        <header className="nut-card-head">
          <div className="nut-head-left">
            <span className="tel-eyebrow-pill">
              <Flame size={13} aria-hidden="true" />
              Адаптивный TDEE · v5
            </span>
            <span className={`nut-mode-badge mode-${cycle.tdee.mode}`}>
              {cycle.tdee.mode === "pro" ? "PRO · Калман" : "LITE · Тренд"}
            </span>
          </div>
          <span className="nut-status-pill">{TDEE_STATUS_LABEL[cycle.tdee.status] ?? cycle.tdee.status}</span>
        </header>

        <div className="nut-kpi-grid">
          <div className="nut-kpi is-primary">
            <span className="nut-kpi-label">
              {cycle.tdee.mode === "pro" ? "Адаптивный TDEE" : "Расчётный TDEE"}
            </span>
            <strong className="nut-kpi-val">
              {cycle.tdee.adaptiveTdeeKcal} <small>ккал</small>
            </strong>
            <span className="nut-kpi-sub">
              {cycle.tdee.mode === "pro"
                ? `Уверенность ${Math.round(cycle.tdee.confidence * 100)}% · SD ±${cycle.tdee.uncertaintySdKcal ?? 0}`
                : `Приор ${cycle.tdee.prior.bmrMethod === "katch_mcardle" ? "Katch" : "Mifflin"} · FFM ${fmt(cycle.tdee.prior.ffmKg)} кг`}
            </span>
          </div>

          <div className="nut-kpi">
            <span className="nut-kpi-label">
              {cycle.checkIn.mode === "pro" ? "Цель калорий" : "Подсказка темпа"}
            </span>
            <strong className="nut-kpi-val">
              {cycle.checkIn.nextTargetKcal !== null ? (
                <>
                  {cycle.checkIn.nextTargetKcal} <small>ккал</small>
                </>
              ) : cycle.checkIn.kcalDeltaHint ? (
                <>
                  {cycle.checkIn.kcalDeltaHint > 0 ? "+" : ""}
                  {cycle.checkIn.kcalDeltaHint} <small>ккал</small>
                </>
              ) : (
                "В окне"
              )}
            </strong>
            <span className="nut-kpi-sub">
              Пол RED-S: ≥ {cycle.checkIn.safetyFloorKcal} ккал (EA 30+)
            </span>
          </div>

          <div className="nut-kpi">
            <span className="nut-kpi-label">Метаб. тренд</span>
            <strong className="nut-kpi-val">
              {fmt(cycle.tdee.metabolicTrendWeightKg)} <small>кг</small>
            </strong>
            <span className="nut-kpi-sub">
              {cycle.tdee.ratePctPerWeek > 0 ? "+" : ""}
              {fmt(cycle.tdee.ratePctPerWeek)} %/нед · цель{" "}
              {cycle.checkIn.targetRatePctPerWeek > 0 ? "+" : ""}
              {fmt(cycle.checkIn.targetRatePctPerWeek)} %
            </span>
          </div>

          <div className={`nut-kpi nut-bridge-kpi status-${cycle.energyBridge.energyStatus}`}>
            <span className="nut-kpi-label">
              <BatteryCharging size={12} aria-hidden="true" />
              Мост → Deload v2
            </span>
            <strong className="nut-kpi-val">
              {ENERGY_STATUS_LABEL[cycle.energyBridge.energyStatus]}
            </strong>
            <span className="nut-kpi-sub">
              Ёмкость ×{cycle.energyBridge.capacityMultiplier.toFixed(2)}
              {cycle.energyBridge.hysteresisHeld ? " · гистерезис" : ""}
            </span>
          </div>
        </div>

        {/* Creatine water-offset indicator */}
        {creatineOffsetKg >= 0.05 ? (
          <div className="nut-banner is-info" role="status">
            <Sparkles size={15} aria-hidden="true" />
            <span>
              Маска креатина активна: скрыто <b>+{fmt(creatineOffsetKg)} кг</b> внутриклеточной воды
              (весы {fmt(cycle.tdee.trendWeightKg)} кг → метаб. {fmt(cycle.tdee.metabolicTrendWeightKg)} кг).
            </span>
          </div>
        ) : null}

        {/* RED-S / NEAT / Diet Break / Low Adherence Alerts */}
        {cycle.checkIn.safetyFloorHit ? (
          <div className="nut-banner is-warn" role="alert">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              <b>Пол безопасности RED-S (EA ≥ 30):</b> бюджет зафиксирован на{" "}
              {cycle.checkIn.safetyFloorKcal} ккал/сут (EA {cycle.checkIn.achievedEaKcalPerKgFfm} ккал/кг FFM).
            </span>
          </div>
        ) : null}

        {cycle.checkIn.neatPlateauDetected ? (
          <div className="nut-banner is-accent" role="status">
            <Zap size={16} aria-hidden="true" />
            <span>
              <b>NEAT-плато ({effectiveProfile.longLevers ? "длинные рычаги" : "высокий расход"}):</b>{" "}
              TDEE вырос на +{cycle.checkIn.tdeeDriftPct ?? 0} %, добавлен буст +{cycle.checkIn.rateCorrectionKcal} ккал.
            </span>
          </div>
        ) : null}

        {cycle.checkIn.dietBreakRecommended ? (
          <div className="nut-banner is-warn" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
              <b>Рекомендован Diet Break (1–2 нед.):</b>{" "}
              {cycle.checkIn.dietBreakReason ? DIET_BREAK_TEXT[cycle.checkIn.dietBreakReason] : ""}{" "}
              Подними калории до {cycle.checkIn.dietBreakTargetKcal ?? cycle.tdee.adaptiveTdeeKcal} ккал за счёт углеводов.
            </span>
          </div>
        ) : null}

        {cycle.tdee.status === "holding_low_adherence" ? (
          <div className="nut-banner is-info" role="status">
            <Activity size={15} aria-hidden="true" />
            <span>
              TDEE временно заморожен ({Math.round(cycle.tdee.adherence14d * 100)} % дней за 2 недели).
              Для калибровки нужно ≥ 10 полных дней из 14.
            </span>
          </div>
        ) : null}

        {cycle.checkIn.mode === "pro" &&
        cycle.checkIn.nextTargetKcal !== null &&
        cycle.checkIn.nextTargetKcal !== state.currentTargetKcal ? (
          <footer className="nut-checkin-bar">
            <span>
              Недельный чек-ин (нед. {weeksInPhase}): новый бюджет{" "}
              <b>{cycle.checkIn.nextTargetKcal} ккал/сут</b>
            </span>
            <button
              type="button"
              className="button primary"
              onClick={() => {
                updateState({ currentTargetKcal: cycle.checkIn.nextTargetKcal });
                setFormNotice(`Чек-ин применён: ${cycle.checkIn.nextTargetKcal} ккал/сут`);
              }}
            >
              <Check size={15} aria-hidden="true" />
              Принять бюджет
            </button>
          </footer>
        ) : null}
      </article>

      {/* Phase Choice Cards (fieldset + radio, zero layout shift) */}
      <article className="nut-card">
        <fieldset className="nut-phase-fieldset">
          <legend className="nut-legend">Фаза питания · неделя {weeksInPhase}</legend>
          <div className="nut-phase-grid">
            {GOAL_META.map((item) => (
              <label key={item.id} className="nut-phase-card">
                <input
                  type="radio"
                  name={`${idPrefix}-goal`}
                  value={item.id}
                  checked={state.goalMode === item.id}
                  onChange={() => handleGoalChange(item.id)}
                  className="visually-hidden"
                />
                <span className="nut-phase-title">{item.label}</span>
                <span className="nut-phase-sub">{item.short}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </article>

      {/* 4-Day DUP v2 Carb Cycling & Macros */}
      <article className="nut-card">
        <header className="nut-card-head">
          <div>
            <h3 className="nut-section-title">Циклирование БЖУ · David Laid DUP v2</h3>
            <p className="nut-section-sub">
              {cycle.tdee.mode === "pro"
                ? `Среднее за 4 дня: ${fourDayMean} ккал (точно = бюджету)`
                : `Ориентир по приору (${fourDayMean} ккал/сут) · запиши калории для калибровки`}
            </p>
          </div>
          <div className="nut-check-inline">
            <input
              id={cyclingId}
              type="checkbox"
              checked={state.carbCyclingEnabled}
              onChange={(e) => updateState({ carbCyclingEnabled: e.target.checked })}
            />
            <label htmlFor={cyclingId}>Цикл углеводов</label>
          </div>
        </header>

        <div className="nut-day-tabs" role="tablist" aria-label="День сплита DUP v2">
          {dupPlan.map((plan) => {
            const active = plan.dayType === selectedDay;
            return (
              <button
                key={plan.dayType}
                type="button"
                role="tab"
                aria-selected={active}
                className={`nut-day-pill${active ? " is-active" : ""}`}
                onClick={() => setSelectedDay(plan.dayType)}
              >
                <span>{DAY_LABELS[plan.dayType].title}</span>
                <small>{plan.targetKcal}</small>
              </button>
            );
          })}
        </div>

        <div className="nut-macro-showcase">
          <div className="nut-macro-kcal">
            <span className="nut-macro-tag">
              {DAY_LABELS[activeMacro.dayType].title} · {DAY_LABELS[activeMacro.dayType].offset}
            </span>
            <strong>
              {activeMacro.targetKcal} <small>ккал</small>
            </strong>
          </div>
          <div className="nut-macro-pillars">
            <div className="nut-macro-box is-protein">
              <span>Белок</span>
              <b>{activeMacro.proteinG} г</b>
            </div>
            <div className="nut-macro-box is-fat">
              <span>Жиры</span>
              <b>{activeMacro.fatG} г</b>
              <small>{fmt(activeMacro.fatPctWeekly)}%</small>
            </div>
            <div className="nut-macro-box is-carbs">
              <span>Углеводы</span>
              <b>{activeMacro.carbsG} г</b>
            </div>
          </div>
        </div>
      </article>

      {/* Daily Nutrition Log Form (unlocks Pro Kalman TDEE) */}
      <article className="nut-card">
        <header className="nut-card-head">
          <h3 id={logFormHeadingId} className="nut-section-title">
            <Plus size={15} aria-hidden="true" />
            Дневник калорий (Pro-калибровка)
          </h3>
          <span className="nut-status-pill">{state.logs.length} дн. в базе</span>
        </header>

        <form
          className="nut-log-form"
          aria-labelledby={logFormHeadingId}
          onSubmit={handleLogSubmit}
          noValidate
        >
          <div className="nut-form-grid">
            <div className="nut-field">
              <label htmlFor={caloriesId}>Калории, ккал *</label>
              <input
                ref={caloriesRef}
                id={caloriesId}
                name="caloriesKcal"
                type="text"
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                required
                pattern="\d{1,5}"
                placeholder={String(activeMacro.targetKcal)}
                value={caloriesInput}
                aria-invalid={caloriesInvalid ? "true" : "false"}
                aria-describedby={caloriesInvalid ? caloriesErrId : undefined}
                className={caloriesInvalid ? "user-invalid-fallback" : undefined}
                onChange={(e) => {
                  setCaloriesInput(e.target.value);
                  if (formError) setFormError("");
                }}
                onBlur={() => {
                  if (caloriesInput.trim()) {
                    setCaloriesTouched(true);
                    setFormError(validateCalories(caloriesInput));
                  }
                }}
              />
              {caloriesInvalid ? (
                <span id={caloriesErrId} className="nut-field-error">
                  Ошибка: {formError}
                </span>
              ) : null}
            </div>

            <div className="nut-field">
              <label htmlFor={proteinId}>Белок, г (опц.)</label>
              <input
                id={proteinId}
                name="proteinG"
                type="text"
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                placeholder={String(activeMacro.proteinG)}
                value={proteinInput}
                onChange={(e) => setProteinInput(e.target.value)}
              />
            </div>

            <div className="nut-field">
              <label htmlFor={dayTypeId}>Тип дня</label>
              <select
                id={dayTypeId}
                name="dayType"
                value={logDayType}
                onChange={(e) => setLogDayType(e.target.value as DupDayType)}
              >
                <option value="legs">Ноги</option>
                <option value="push">Жим</option>
                <option value="pull">Тяга</option>
                <option value="rest">Отдых</option>
                <option value="deload">Разгрузка</option>
              </select>
            </div>

            <div className="nut-field">
              <label htmlFor={dateId}>Дата</label>
              <input
                id={dateId}
                name="logDate"
                type="date"
                max={today}
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
              />
            </div>
          </div>

          <div className="nut-form-footer">
            <div className="nut-check-inline">
              <input
                id={partialId}
                name="partialLog"
                type="checkbox"
                checked={partialLog}
                onChange={(e) => setPartialLog(e.target.checked)}
              />
              <label htmlFor={partialId}>Неполный день (исключить из TDEE)</label>
            </div>

            <button type="submit" className="button primary">
              <Check size={16} aria-hidden="true" />
              Сохранить день
            </button>
          </div>
        </form>

        {formNotice ? (
          <p className="success-message nut-status-msg" role="status" aria-live="polite">
            {formNotice}
          </p>
        ) : null}

        {state.logs.length > 0 ? (
          <details className="nut-details">
            <summary className="nut-details-summary">
              Последние записи питания ({state.logs.length})
            </summary>
            <div className="nut-logs-list">
              {[...state.logs]
                .reverse()
                .slice(0, 14)
                .map((log) => (
                  <div key={log.date} className="nut-log-row">
                    <div>
                      <b>{log.caloriesKcal} ккал</b>
                      {log.proteinG ? <span> · Б {log.proteinG} г</span> : null}
                      <span>
                        {" "}
                        · {DAY_LABELS[log.dayType ?? "push"].title} · {DateText.day(log.date)}
                      </span>
                      {log.partialLog ? <em className="nut-partial-tag">неполный</em> : null}
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Удалить запись питания за ${DateText.day(log.date)}`}
                      onClick={() => setState(store.removeLog(state, log.date))}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                ))}
            </div>
          </details>
        ) : null}

        {/* Collapsible Profile & Creatine Calibration Settings */}
        <details className="nut-details">
          <summary className="nut-details-summary">
            <SlidersHorizontal size={14} aria-hidden="true" />
            Профиль тела, креатин и калибровка
          </summary>
          <div className="nut-profile-grid">
            <div className="nut-field">
              <label htmlFor={`${idPrefix}-sex`}>Пол</label>
              <select
                id={`${idPrefix}-sex`}
                value={state.profile.sex}
                onChange={(e) => updateProfile({ sex: e.target.value as BiologicalSex })}
              >
                <option value="male">Мужской</option>
                <option value="female">Женский</option>
              </select>
            </div>

            <div className="nut-field">
              <label htmlFor={`${idPrefix}-age`}>Возраст, лет</label>
              <input
                id={`${idPrefix}-age`}
                type="number"
                min={14}
                max={100}
                value={state.profile.ageYears}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 14 && n <= 100) updateProfile({ ageYears: n });
                }}
              />
            </div>

            <div className="nut-field">
              <label htmlFor={`${idPrefix}-height`}>Рост, см</label>
              <input
                id={`${idPrefix}-height`}
                type="number"
                min={120}
                max={240}
                value={state.profile.heightCm}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 120 && n <= 240) updateProfile({ heightCm: n });
                }}
              />
            </div>

            <div className="nut-field">
              <label htmlFor={`${idPrefix}-bf`}>% жира (опц., Katch)</label>
              <input
                id={`${idPrefix}-bf`}
                type="text"
                inputMode="decimal"
                placeholder={`~${fmt(cycle.tdee.prior.estimatedBfPct)}`}
                value={state.profile.bodyFatPct ?? ""}
                onChange={(e) => {
                  const raw = e.target.value.trim().replace(",", ".");
                  if (!raw) {
                    updateProfile({ bodyFatPct: null });
                    return;
                  }
                  const n = Number(raw);
                  if (Number.isFinite(n) && n >= 4 && n <= 55) updateProfile({ bodyFatPct: n });
                }}
              />
            </div>

            <div className="nut-field">
              <label htmlFor={`${idPrefix}-neat`}>Уровень NEAT</label>
              <select
                id={`${idPrefix}-neat`}
                value={state.profile.neatLevel ?? "moderate"}
                onChange={(e) => updateProfile({ neatLevel: e.target.value as NeatLevel })}
              >
                <option value="sedentary">Сидячий (1.20)</option>
                <option value="light">Лёгкий (1.32)</option>
                <option value="moderate">Умеренный (1.45)</option>
                <option value="active">Активный (1.58)</option>
                <option value="very_active">Очень активный (1.72)</option>
              </select>
            </div>

            <div className="nut-field">
              <label htmlFor={`${idPrefix}-level`}>Опыт тренинга</label>
              <select
                id={`${idPrefix}-level`}
                value={state.profile.trainingLevel ?? "intermediate"}
                onChange={(e) => updateProfile({ trainingLevel: e.target.value as TrainingLevel })}
              >
                <option value="novice">Новичок</option>
                <option value="intermediate">Средний</option>
                <option value="advanced">Продвинутый</option>
              </select>
            </div>

            <div className="nut-field">
              <label htmlFor={`${idPrefix}-ffm`}>Формула FFM</label>
              <select
                id={`${idPrefix}-ffm`}
                value={state.profile.ffmFormula ?? "janmahasatian"}
                onChange={(e) => updateProfile({ ffmFormula: e.target.value as FfmFormula })}
              >
                <option value="janmahasatian">Janmahasatian (DXA)</option>
                <option value="boer">Boer (1984)</option>
              </select>
            </div>

            <div className="nut-field">
              <label htmlFor={`${idPrefix}-creatine`}>Старт креатина (маска 21 дн.)</label>
              <input
                id={`${idPrefix}-creatine`}
                type="date"
                max={today}
                value={state.creatineStartDate ?? ""}
                onChange={(e) => updateState({ creatineStartDate: e.target.value || null })}
              />
            </div>
          </div>

          <div className="nut-check-inline nut-profile-check">
            <input
              id={`${idPrefix}-levers`}
              type="checkbox"
              checked={Boolean(state.profile.longLevers)}
              onChange={(e) => updateProfile({ longLevers: e.target.checked })}
            />
            <label htmlFor={`${idPrefix}-levers`}>
              Длинные рычаги (порог NEAT-плато +10 % и буст +200 ккал)
            </label>
          </div>
        </details>
      </article>
    </section>
  );
}
