import { useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { ArrowLeftRight, Check, RotateCcw, Sparkles } from "lucide-react";
import { DAY_NAMES } from "../domain/TrainingProgram";
import {
  LaidDupPlan,
  type LaidLift,
  type LaidSlotInfo,
  type LaidSubstitutions,
  type LaidVersion,
  type LaidWeekSlot,
} from "../domain/LaidDupPlan";
import { ExerciseAvoidStore, SubstitutionPolicy } from "../domain/SubstitutionPolicy";
import { dateLabel } from "../lib/calendar";
import { exerciseById } from "../lib/model";
import { setsWord } from "../lib/quantity";
import type { Exercise, LaidMaxes, Routine, Workout } from "../lib/types";
import ExerciseSwapModal from "./ExerciseSwapModal";
import LaidWeekOrderEditor from "./LaidWeekOrderEditor";
import Modal from "./Modal";

type Mode = "create" | "update" | "restart";
type Props = {
  mode: Mode;
  /** Все программы: нужны, чтобы честно сказать, какие дни уже заняты. */
  routines: Routine[];
  /** Шесть программ действующего цикла (для «Обновить максимумы» и «Новый цикл»). */
  cycle?: Routine[];
  /** Лейд уже есть: окно создания сначала спрашивает, что делать. */
  existing?: boolean;
  workouts: Workout[];
  personal?: Exercise[];
  accountId?: string;
  minorMode?: boolean;
  today: string;
  onSave: (routine: Routine) => Promise<Routine>;
  onClose: () => void;
  /** Сообщение после успешного сохранения. */
  onDone: (message: string) => void;
  /** «Обновить максимумы» из окна «Создать ещё раз». */
  onSwitch?: (mode: Mode) => void;
  /** Заменить выбранные старые программы новыми (удаление старых разом после создания новых). */
  onReplaceRoutines?: (toDelete: Routine[], toCreate: Routine[]) => Promise<void>;
  /** Улучшить действующий цикл до «Умного DUP v2» (одна кнопка на весь цикл). */
  onUpgradeToV2?: () => Promise<void> | void;
};

const LIFTS: LaidLift[] = ["squat", "bench", "deadlift", "ohp"];
const LABEL: Record<LaidLift, string> = {
  squat: "1ПМ: присед",
  bench: "1ПМ: жим лёжа",
  deadlift: "1ПМ: становая",
  ohp: "1ПМ: армейский жим",
};
const LIFT_DAYS: Record<LaidLift, string> = {
  squat: "Ноги 1 · 2",
  bench: "Жим 1",
  deadlift: "Тяга 1 · 2",
  ohp: "Жим 2",
};

const SPRING_PILL = { type: "spring" as const, stiffness: 460, damping: 35 };
const SPRING_THUMB = { type: "spring" as const, stiffness: 520, damping: 32 };

/** Окно «Дэвид Лейд · DUP»: четыре максимума с заменами упражнений, компактное расписание, параметры и живой расчёт объёма. */
export default function LaidDupModal(props: Props) {
  const { mode, cycle, today } = props;
  const reduced = useReducedMotion();
  const uid = useId();
  const base = cycle?.[0]?.periodization;
  const sets = useMemo(() => LaidDupPlan.weeklySets(), []);
  const [ask, setAsk] = useState(mode === "create" && !!props.existing);
  const [replaceExisting, setReplaceExisting] = useState<boolean>(
    () => mode === "create" && !!props.existing,
  );
  const [values, setValues] = useState<Record<LaidLift, string>>(() =>
    Object.fromEntries(
      LIFTS.map((l) => [
        l,
        base && !base.calibrationLifts?.includes(l) && !base.painFlags?.includes(l)
          ? LaidDupPlan.kg(base.maxes[l])
          : "",
      ]),
    ) as Record<LaidLift, string>,
  );
  const [substitutions, setSubstitutions] = useState<LaidSubstitutions>(() =>
    base?.substitutions ? { ...base.substitutions } : {},
  );
  const [calibrationLifts, setCalibrationLifts] = useState<LaidLift[]>(() =>
    base?.calibrationLifts ? [...base.calibrationLifts] : [],
  );
  const [painFlags, setPainFlags] = useState<LaidLift[]>(() =>
    base?.painFlags ? [...base.painFlags] : [],
  );
  const [swapSlot, setSwapSlot] = useState<LaidSlotInfo | null>(null);
  const [appliedLift, setAppliedLift] = useState<LaidLift | null>(null);
  const [shown, setShown] = useState(false);
  const [start, setStart] = useState<"this" | "next">(() => LaidDupPlan.defaultStart(today));
  const [slots, setSlots] = useState<LaidWeekSlot[]>(() => LaidDupPlan.slotsForRhythm("3x1x3"));
  const [customOpen, setCustomOpen] = useState(false);
  const [subsOpen, setSubsOpen] = useState(false);
  const [extras, setExtras] = useState(true);
  const [light, setLight] = useState(() => !!props.minorMode);
  const [version, setVersion] = useState<LaidVersion>(() => base?.version ?? "v1");
  const isV2 = version === "v2";
  /** Действующий цикл уже на v2: в режимах «Обновить максимумы»/«Новый цикл» переключатели больше не нужны. */
  const cycleIsV2 = base?.version === "v2";
  const [useTrainingMax, setUseTrainingMax] = useState(() => mode === "create");
  const [midDeload, setMidDeload] = useState(() => !!base?.deloadWeeks?.includes(6));
  const [rollingWeek, setRollingWeek] = useState(() => base?.weekMode === "rolling");
  const [autoEscalate, setAutoEscalate] = useState(() => !props.minorMode && !!base?.autoEscalate);
  const avoidedIds = useMemo(
    () => (props.accountId ? new ExerciseAvoidStore(props.accountId).ids() : undefined),
    [props.accountId],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRefs = useRef<Partial<Record<LaidLift, HTMLInputElement | null>>>({});

  const activeSubs = useMemo(
    () => LaidDupPlan.normalizeSubstitutions(substitutions),
    [substitutions],
  );
  const subCount = activeSubs ? Object.keys(activeSubs).length : 0;

  const estimates = useMemo(
    () => LaidDupPlan.estimates(props.workouts, today, activeSubs),
    [props.workouts, today, activeSubs],
  );
  const estimateCount = useMemo(
    () => LIFTS.filter((l) => estimates[l] !== null).length,
    [estimates],
  );
  const tmFactor = isV2 ? LaidDupPlan.V2_TM_FACTOR : LaidDupPlan.TRAINING_MAX_FACTOR;
  const tmPctLabel = isV2 ? "90 %" : "92,5 %";
  const suggestedEstimate = (est: number) =>
    useTrainingMax ? LaidDupPlan.trainingMaxFrom1Rm(est, tmFactor) : est;
  const allEstimatesApplied = useMemo(
    () =>
      estimateCount > 0 &&
      LIFTS.every((l) => {
        const est = estimates[l];
        if (est === null) return true;
        const target = useTrainingMax ? LaidDupPlan.trainingMaxFrom1Rm(est, tmFactor) : est;
        return values[l] === LaidDupPlan.kg(target);
      }),
    [estimateCount, estimates, values, useTrainingMax, tmFactor],
  );

  const catalogSlots = useMemo(
    () => LaidDupPlan.catalogSlots(isV2 ? true : extras, activeSubs, version),
    [isV2, extras, activeSubs, version],
  );
  const liftSlots = useMemo(() => catalogSlots.filter((s) => s.role === "lift"), [catalogSlots]);
  const auxSlots = useMemo(() => catalogSlots.filter((s) => s.role !== "lift"), [catalogSlots]);

  const volumeSummary = useMemo(
    () => LaidDupPlan.weeklyMuscleVolume({ version, extras: isV2 ? true : extras, substitutions: activeSubs }),
    [version, isV2, extras, activeSubs],
  );
  const baselineVolume = useMemo(
    () => LaidDupPlan.weeklyMuscleVolume({ version: "v1", extras: true }),
    [],
  );

  const rhythm = useMemo(() => LaidDupPlan.matchingRhythm(slots), [slots]);
  const weekdays = useMemo(() => LaidDupPlan.weekdaysFromSlots(slots), [slots]);
  const cycleWeekdays = useMemo(
    () => (cycle?.length ? LaidDupPlan.weekdaysFromSlots(LaidDupPlan.slotsFromCycle(cycle)) : LaidDupPlan.WEEKDAY),
    [cycle],
  );
  const checks = LIFTS.map((l) => {
    if (calibrationLifts.includes(l) || painFlags.includes(l)) {
      const parsed = LaidDupPlan.checkMax(values[l]);
      return { lift: l, value: parsed.value ?? 100, error: null };
    }
    return { lift: l, ...LaidDupPlan.checkMax(values[l]) };
  });
  const valid = checks.every((c) => c.error === null);
  const filledCount = checks.filter((c) => c.error === null).length;
  const maxes = valid ? (Object.fromEntries(checks.map((c) => [c.lift, c.value!])) as LaidMaxes) : null;
  const startMonday = LaidDupPlan.startMonday(today, start);
  const cycleState = useMemo(
    () => (cycle?.length ? LaidDupPlan.cycleState(cycle, props.workouts, today) : null),
    [cycle, props.workouts, today],
  );
  const position = cycleState?.position ?? null;

  const taken = useMemo(() => {
    if (mode !== "create" || replaceExisting) return [] as string[];
    return [...LaidDupPlan.DAYS]
      .sort((a, b) => weekdays[a] - weekdays[b])
      .flatMap((day) => {
        const weekday = weekdays[day];
        const names = props.routines.filter((r) => r.days.includes(weekday)).map((r) => `«${r.name}»`);
        return names.length ? [`${DAY_NAMES[weekday]} уже занят программой ${names.join(", ")}: обе будут в плане недели.`] : [];
      });
  }, [mode, props.routines, weekdays, replaceExisting]);

  function applySubstitution(originalId: string, nextId: string | null) {
    setSubstitutions((prev) => {
      const next = { ...prev };
      if (!nextId || nextId === originalId) {
        delete next[originalId];
      } else {
        next[originalId] = nextId;
      }
      return next;
    });
    const lift = LIFTS.find((l) => LaidDupPlan.LIFT_EXERCISE[l] === originalId);
    if (lift) {
      if (!nextId || nextId === originalId) {
        setCalibrationLifts((prev) => prev.filter((l) => l !== lift));
      } else {
        const ownSessions = LaidDupPlan.sessionsForExercise(props.workouts, nextId);
        const compat = SubstitutionPolicy.classify(exerciseById(originalId), exerciseById(nextId), {
          hasOwnHistory: ownSessions >= 2,
          painFlag: painFlags.includes(lift),
        });
        if (compat.prescriptionMode !== "percent_1rm") {
          setCalibrationLifts((prev) => (prev.includes(lift) ? prev : [...prev, lift]));
        }
      }
    }
  }

  function toggleCalibration(lift: LaidLift) {
    setCalibrationLifts((prev) =>
      prev.includes(lift) ? prev.filter((l) => l !== lift) : [...prev, lift],
    );
  }

  function togglePainFlag(lift: LaidLift) {
    setPainFlags((prev) =>
      prev.includes(lift) ? prev.filter((l) => l !== lift) : [...prev, lift],
    );
  }

  function applyAllEstimates() {
    setValues((prev) => {
      const next = { ...prev };
      for (const lift of LIFTS) {
        if (estimates[lift] !== null) next[lift] = LaidDupPlan.kg(suggestedEstimate(estimates[lift]!));
      }
      return next;
    });
  }

  async function submit() {
    setShown(true);
    if (!maxes) {
      const firstInvalid = checks.find((c) => c.error !== null);
      if (firstInvalid) inputRefs.current[firstInvalid.lift]?.focus();
      return;
    }
    setBusy(true);
    setError("");
    let saved = 0;
    try {
      if (mode === "create") {
        const createdRoutines = LaidDupPlan.routines({
          version,
          maxes,
          extras: isV2 ? true : extras,
          light: isV2 ? true : light,
          startMonday,
          weekdays,
          substitutions: activeSubs,
          calibrationLifts,
          painFlags,
          autoEscalate: !props.minorMode && autoEscalate,
          weekMode: isV2 ? "rolling" : rollingWeek ? "rolling" : "calendar",
          deloadWeeks: isV2 ? [LaidDupPlan.V2_DELOAD_WEEK] : midDeload ? [6] : undefined,
        });
        if (replaceExisting && props.routines.length > 0 && props.onReplaceRoutines) {
          await props.onReplaceRoutines(props.routines, createdRoutines);
          saved = createdRoutines.length;
        } else {
          for (const r of createdRoutines) {
            await props.onSave(r);
            saved++;
          }
        }
        const restDay = LaidDupPlan.restWeekday(slots);
        const daysLabel =
          rhythm === "6x1"
            ? "Пн–Сб"
            : rhythm === "3x1x3"
              ? "Пн–Ср и Пт–Вс (отдых Чт)"
              : restDay !== null
                ? `свой порядок (выходной ${DAY_NAMES[restDay]})`
                : "свой порядок";
        const subText = subCount > 0 ? ` Замен упражнений: ${subCount}.` : "";
        const replaceText =
          replaceExisting && props.routines.length > 0 ? " Прежние программы заменены." : "";
        props.onDone(
          isV2
            ? `Умный DUP v2 создан: 6 дней (${daysLabel}), 10 недель с разгрузкой на 7-й и −68 % на поясницу.${subText}${replaceText}`
            : `Программа Лейда создана: шесть дней, ${daysLabel}.${subText}${replaceText} Расписание — в «Программах».`,
        );
      } else {
        const week = position ? position.week : 0;
        const nextCal = calibrationLifts.length ? [...new Set(calibrationLifts)] : undefined;
        const nextPain = painFlags.length ? [...new Set(painFlags)] : undefined;
        for (const r of cycle ?? []) {
          const p = r.periodization!;
          const baseNext =
            mode === "restart"
              ? { ...p, startMonday, maxes, maxesFromWeek: 0, earlier: undefined }
              : LaidDupPlan.withMaxes(p, maxes, position && !position.beforeStart ? week : 0);
          const next = {
            ...baseNext,
            ...(nextCal ? { calibrationLifts: nextCal } : {}),
            ...(nextPain ? { painFlags: nextPain } : {}),
          };
          if (mode === "restart") {
            if (midDeload) next.deloadWeeks = [6];
            else delete next.deloadWeeks;
          }
          if (rollingWeek) next.weekMode = "rolling";
          else delete next.weekMode;
          if (!props.minorMode && autoEscalate) next.autoEscalate = true;
          else delete next.autoEscalate;
          if (!nextCal) delete next.calibrationLifts;
          if (!nextPain) delete next.painFlags;
          await props.onSave({ ...r, periodization: next });
          saved++;
        }
        props.onDone(
          mode === "restart"
            ? `Новый цикл начинается ${dateLabel(startMonday)}: максимумы обновлены.`
            : position && !position.beforeStart
              ? `Максимумы обновлены: новые веса — с недели ${week + 1}, прошлые недели не меняются.`
              : "Максимумы обновлены.",
        );
      }
      props.onClose();
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "Не удалось сохранить") +
          (saved ? ` Уже сохранено программ: ${saved} из 6 — проверь список и повтори.` : ""),
      );
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "create" ? "Дэвид Лейд · DUP" : mode === "restart" ? "Новый цикл Лейда" : "Обновить максимумы";

  if (ask)
    return (
      <Modal title={title} onClose={props.onClose}>
        <m.div
          className="laid-modal"
          initial={reduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <p className="laid-lead">
            Программа Лейда уже есть. Можно обновить её максимумы, заменить текущий цикл новым (все 6 дней разом) или добавить ещё один цикл.
          </p>
          <div className="laid-actions">
            <button type="button" className="button primary" onClick={() => props.onSwitch?.("update")}>
              Обновить максимумы
            </button>
            {props.onReplaceRoutines ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setReplaceExisting(true);
                  setAsk(false);
                }}
              >
                Заменить текущий цикл
              </button>
            ) : null}
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setReplaceExisting(false);
                setAsk(false);
              }}
            >
              Добавить ещё один
            </button>
          </div>
        </m.div>
      </Modal>
    );

  const previewWeek = mode === "update" && position && !position.beforeStart ? position.week : 0;
  const previewWave = Math.floor(previewWeek / 3) + 1;
  const swapCurrentEx = swapSlot ? exerciseById(swapSlot.resolvedId) ?? exerciseById(swapSlot.originalId) : null;
  const swapOriginalEx = swapSlot ? exerciseById(swapSlot.originalId) : undefined;
  const swapExcludeIds = swapSlot
    ? LaidDupPlan.conflictingIdsForSubstitution(swapSlot.originalId, extras, activeSubs)
    : [];

  return (
    <>
      <Modal title={title} wide onClose={() => (busy ? false : props.onClose())}>
        <form
          className="product-form laid-modal laid-modal-v2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy}>
            {/* Compact program summary header */}
            <div className="laid-hero-strip">
              <div className="laid-hero-pills" aria-label="Параметры цикла">
                <span className="laid-pill">{midDeload && mode === "create" ? "10 недель (с разгрузкой)" : "9 недель"}</span>
                <span className="laid-pill">6 дней/нед</span>
                <span className="laid-pill">3 волны DUP</span>
                {mode === "create" && rollingWeek ? (
                  <span className="laid-pill is-accent">Плавающая неделя</span>
                ) : null}
                {mode === "create" ? (
                  <span className="laid-pill">{volumeSummary.totalSets} подх./нед</span>
                ) : null}
                {subCount > 0 ? (
                  <span className="laid-pill is-accent">Замен: {subCount}</span>
                ) : null}
              </div>
              <p className="laid-lead">
                {isV2
                  ? "Умный DUP v2: веса считаются от 90 % тренировочного максимума (ТМ), без опасных синглов 1ПМ и с разгрузкой на 7-й неделе."
                  : `1ПМ — максимум на одно повторение; вводи осторожный тренировочный максимум (92,5 % от 1ПМ). ${LaidDupPlan.LOAD_NOTICE}`}
              </p>
              {(() => {
                // В режимах «Обновить максимумы»/«Новый цикл» версия цикла не правится этим окном:
                // действующий цикл улучшается целиком через onUpgradeToV2 (одна кнопка на весь цикл).
                const v2On = mode === "create" ? isV2 : cycleIsV2;
                const canToggle = mode === "create";
                const canUpgrade = mode !== "create" && !cycleIsV2;
                return (
                  <div className={`laid-v2-banner${v2On ? " is-active" : ""}`}>
                    <div className="laid-v2-banner-head">
                      <div className="laid-v2-banner-copy">
                        <span className="laid-v2-eyebrow">
                          <Sparkles size={13} aria-hidden="true" />
                          {v2On ? "Умный DUP v2 · Баланс и защита" : "Рекомендуемое улучшение (1 кнопка)"}
                        </span>
                        <strong>
                          {v2On
                            ? "Программа улучшена под длинные рычаги и восстановление"
                            : "Умный DUP v2: Баланс и защита"}
                        </strong>
                        <small>
                          {v2On
                            ? "Включены ритм 3+1+3, плавающая неделя, ТМ 90 %, −68 % нагрузки на поясницу, икры/пресс/задняя дельта и разгрузка на 7-й нед."
                            : "В один клик заменяет все настройки: −68 % на поясницу, закрытые икры/пресс/задняя дельта, без синглов 1ПМ, 57–65 мин."}
                        </small>
                      </div>
                      {canToggle || canUpgrade ? (
                        <button
                          type="button"
                          className={`button ${v2On ? "secondary" : "primary"} laid-v2-toggle-btn`}
                          aria-pressed={canToggle ? isV2 : v2On}
                          disabled={busy}
                          onClick={() => {
                            if (!canToggle) {
                              void (async () => {
                                setBusy(true);
                                try {
                                  await props.onUpgradeToV2?.();
                                  props.onClose();
                                } finally {
                                  setBusy(false);
                                }
                              })();
                              return;
                            }
                            const next: LaidVersion = isV2 ? "v1" : "v2";
                            setVersion(next);
                            setSubstitutions({});
                            if (next === "v2") {
                              setSlots(LaidDupPlan.slotsForRhythm("3x1x3"));
                              setExtras(true);
                              setLight(true);
                              setMidDeload(true);
                              setRollingWeek(true);
                            } else {
                              setLight(!!props.minorMode);
                              setMidDeload(false);
                              setRollingWeek(false);
                            }
                          }}
                        >
                          {canToggle ? (isV2 ? "Вернуться к оригиналу" : "Улучшить программу") : "Улучшить программу"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })()}
              {props.minorMode ? (
                <p className="tiny laid-deload-hint">
                  Включён безопасный режим (до 18 лет): облегчённый формат без синглов 95–97,5 % включён по умолчанию, автоэскалация 1ПМ отключена. Рекомендуется контроль техники с тренером.
                </p>
              ) : null}
              {mode === "restart" ? <p className="tiny laid-deload-hint">{LaidDupPlan.DELOAD_NOTICE}</p> : null}
            </div>

            {/* Section 1: 1RM Inputs with inline lift replacement */}
            <section className="laid-section" aria-labelledby={`${uid}-maxes-title`}>
              <div className="laid-section-head">
                <div className="laid-section-title-group">
                  <h3 id={`${uid}-maxes-title`} className="laid-section-title">
                    {useTrainingMax ? "Тренировочные максимумы (ТМ)" : "Рабочие максимумы (1ПМ)"}
                  </h3>
                  <span className="laid-section-counter" aria-live="polite">
                    {filledCount}/4
                  </span>
                </div>
                <div className="laid-section-head-actions">
                  {estimateCount > 0 ? (
                    <button
                      type="button"
                      aria-pressed={useTrainingMax}
                      className={`laid-mode-chip${useTrainingMax ? " active" : ""}`}
                      title={`Считать по ${tmPctLabel} от расчётного 1ПМ, чтобы не словить перетрен в волнах 2–3`}
                      onClick={() => setUseTrainingMax((v) => !v)}
                    >
                      {useTrainingMax ? `ТМ ${tmPctLabel} · вкл` : "100 % от 1ПМ"}
                    </button>
                  ) : null}
                  {estimateCount >= 2 && !allEstimatesApplied ? (
                    <button type="button" className="laid-fill-all-btn" onClick={applyAllEstimates}>
                      <Sparkles size={13} aria-hidden="true" />
                      <span>{useTrainingMax ? `Заполнить ТМ (${tmPctLabel})` : "Заполнить из истории"}</span>
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="laid-fields">
                {LIFTS.map((lift, i) => {
                  const c = checks[i];
                  const estimate = estimates[lift];
                  const targetEst = estimate !== null ? suggestedEstimate(estimate) : null;
                  const message = shown && c.error ? c.error : "";
                  const isApplied = appliedLift === lift && targetEst !== null && values[lift] === LaidDupPlan.kg(targetEst);
                  const origId = LaidDupPlan.LIFT_EXERCISE[lift];
                  const resolvedId = LaidDupPlan.liftExerciseId(lift, activeSubs);
                  const isReplaced = resolvedId !== origId;
                  const resolvedDef = exerciseById(resolvedId);
                  const origDef = exerciseById(origId);
                  const isCalibrating = calibrationLifts.includes(lift);
                  const isPain = painFlags.includes(lift);
                  const ownSessions = isReplaced ? LaidDupPlan.sessionsForExercise(props.workouts, resolvedId) : 2;
                  const compat = isReplaced
                    ? SubstitutionPolicy.classify(origDef, resolvedDef, { hasOwnHistory: ownSessions >= 2, painFlag: isPain })
                    : null;
                  const inputId = `${uid}-lift-${lift}`;
                  const noteId = `${uid}-note-${lift}`;
                  const unitText = resolvedDef?.recording.loadMode === "per_implement" ? "кг · 1 гант." : "кг";
                  const matchingSlot = liftSlots.find((s) => s.lift === lift);

                  return (
                    <div
                      className={`laid-field${message ? " has-error" : ""}${c.value ? " is-valid" : ""}${isReplaced ? " is-replaced" : ""}`}
                      key={lift}
                    >
                      <div className="laid-field-top">
                        <label htmlFor={inputId} className="laid-field-label">
                          <span className="laid-field-name">{LABEL[lift]}</span>
                          <small className="laid-field-tag">{LIFT_DAYS[lift]}</small>
                        </label>
                        {mode === "create" && matchingSlot ? (
                          <button
                            type="button"
                            className={`laid-lift-swap-btn${isReplaced ? " active" : ""}`}
                            aria-label={`Заменить упражнение: ${resolvedDef?.name ?? LaidDupPlan.LIFT_LABEL[lift]}`}
                            title={isReplaced ? "Изменить замену" : "Заменить упражнение (например, при травме)"}
                            onClick={() => setSwapSlot(matchingSlot)}
                          >
                            <ArrowLeftRight size={14} aria-hidden="true" />
                            <span>{isReplaced ? "Замена" : "Заменить"}</span>
                          </button>
                        ) : null}
                      </div>

                      {isReplaced ? (
                        <div className="laid-replaced-banner">
                          <div className="laid-replaced-copy">
                            <span className="laid-replaced-name">{resolvedDef?.name ?? resolvedId}</span>
                            {compat ? (
                              <small className={`laid-compat-tag class-${compat.subClass.toLowerCase()}`}>
                                {compat.badge}
                              </small>
                            ) : null}
                          </div>
                          {mode === "create" ? (
                            <button
                              type="button"
                              className="laid-inline-reset"
                              aria-label={`Вернуть ${LaidDupPlan.LIFT_LABEL[lift]}`}
                              onClick={() => applySubstitution(origId, null)}
                            >
                              <RotateCcw size={12} aria-hidden="true" />
                              <span>Вернуть</span>
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      <span className="laid-input">
                        <input
                          id={inputId}
                          ref={(node) => {
                            inputRefs.current[lift] = node;
                          }}
                          inputMode="decimal"
                          enterKeyHint={i < LIFTS.length - 1 ? "next" : "done"}
                          autoComplete="off"
                          aria-invalid={message ? true : undefined}
                          aria-describedby={noteId}
                          data-autofocus={i === 0 ? "" : undefined}
                          placeholder={isCalibrating || isPain ? "Калибровка по RIR" : "0"}
                          disabled={isCalibrating || isPain}
                          value={isCalibrating || isPain ? "" : values[lift]}
                          onChange={(e) => setValues({ ...values, [lift]: e.target.value })}
                        />
                        <span className="laid-unit" aria-hidden="true">
                          {isCalibrating || isPain ? "RIR" : unitText}
                        </span>
                      </span>

                      <div id={noteId} className="laid-field-note">
                        <AnimatePresence initial={false}>
                          {message ? (
                            <m.p
                              key="err"
                              className="laid-error"
                              role="alert"
                              initial={reduced ? false : { opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.16 }}
                            >
                              {message}
                            </m.p>
                          ) : null}
                        </AnimatePresence>
                        {estimate !== null && targetEst !== null && !isCalibrating && !isPain ? (
                          <div className="laid-estimate-row">
                            <m.button
                              type="button"
                              className={`laid-estimate${isApplied ? " applied" : ""}`}
                              whileTap={reduced ? undefined : { scale: 0.97 }}
                              onClick={() => {
                                setValues({ ...values, [lift]: LaidDupPlan.kg(targetEst) });
                                setAppliedLift(lift);
                              }}
                            >
                              {isApplied ? <Check size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
                              <span>
                                {useTrainingMax
                                  ? `ТМ 92,5 % ≈ ${LaidDupPlan.kg(targetEst)} кг (1ПМ ${LaidDupPlan.kg(estimate)})`
                                  : `по истории ≈ ${LaidDupPlan.kg(estimate)} кг (Эпли)`}
                              </span>
                            </m.button>
                            <small className="laid-estimate-window">
                              {LaidDupPlan.windowText(LaidDupPlan.ESTIMATE_DAYS)}
                            </small>
                          </div>
                        ) : null}
                        <div className="laid-lift-mode-row">
                          <button
                            type="button"
                            aria-pressed={isCalibrating}
                            className={`laid-mode-chip${isCalibrating ? " active" : ""}`}
                            onClick={() => toggleCalibration(lift)}
                          >
                            {isCalibrating ? "Калибровка по RIR: вкл" : "Не знаю 1ПМ"}
                          </button>
                          {isReplaced || isPain || mode !== "create" ? (
                            <button
                              type="button"
                              aria-pressed={isPain}
                              className={`laid-mode-chip is-pain${isPain ? " active" : ""}`}
                              onClick={() => togglePainFlag(lift)}
                            >
                              {isPain ? "Щадяще (боль)" : "Травма / боль"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Section 2: Unified Schedule Card */}
            {mode !== "update" ? (
              <section className="laid-section laid-card-surface" aria-labelledby={`${uid}-schedule-title`}>
                <h3 id={`${uid}-schedule-title`} className="laid-section-title">
                  Расписание
                </h3>

                <div className="laid-group" role="group" aria-label="Неделя 1 начинается">
                  <p className="laid-subcaption">Неделя 1 начинается</p>
                  <div className="laid-choice">
                    {(["this", "next"] as const).map((which) => {
                      const active = start === which;
                      return (
                        <button
                          type="button"
                          key={which}
                          aria-pressed={active}
                          className={active ? "active" : ""}
                          onClick={() => setStart(which)}
                        >
                          {active ? (
                            <m.span
                              layoutId="laid-start-pill"
                              className="laid-choice-pill"
                              aria-hidden="true"
                              transition={reduced ? { duration: 0 } : SPRING_PILL}
                            />
                          ) : null}
                          <span className="laid-choice-body">
                            <span>{which === "this" ? "с понедельника этой недели" : "со следующего понедельника"}</span>
                            <small>{dateLabel(LaidDupPlan.startMonday(today, which))}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {mode === "create" ? (
                  <div className="laid-group" role="group" aria-label="Ритм недели">
                    <p className="laid-subcaption">Распределение дней отдыха</p>
                    <div className="laid-choice">
                      {(
                        [
                          {
                            id: "3x1x3" as const,
                            label: "3 + 1 + 3 · выходной Чт (рекомендуется)",
                            sub: "Разгружает поясницу перед Ногами 2",
                          },
                          {
                            id: "6x1" as const,
                            label: "Пн–Сб подряд · выходной Вс",
                            sub: "Классика без паузы внутри недели",
                          },
                        ] as const
                      ).map((opt) => {
                        const active = rhythm === opt.id;
                        return (
                          <button
                            type="button"
                            key={opt.id}
                            aria-pressed={active}
                            className={active ? "active" : ""}
                            onClick={() => setSlots(LaidDupPlan.slotsForRhythm(opt.id))}
                          >
                            {active ? (
                              <m.span
                                layoutId="laid-rhythm-pill"
                                className="laid-choice-pill"
                                aria-hidden="true"
                                transition={reduced ? { duration: 0 } : SPRING_PILL}
                              />
                            ) : null}
                            <span className="laid-choice-body">
                              <span>{opt.label}</span>
                              <small>{opt.sub}</small>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <details
                      className="laid-disclosure laid-custom-order"
                      open={customOpen}
                      onToggle={(e) => setCustomOpen(e.currentTarget.open)}
                    >
                      <summary>
                        <span>Настроить порядок дней по неделе</span>
                        {rhythm === "custom" ? <span className="laid-custom-badge">Свой порядок</span> : null}
                      </summary>
                      <div className="laid-custom-order-body">
                        {customOpen ? (
                          <LaidWeekOrderEditor slots={slots} onChange={setSlots} showPresets={false} disabled={busy} />
                        ) : null}
                      </div>
                    </details>
                  </div>
                ) : null}

                <p className="tiny laid-quiet-note">
                  Недели считаются от понедельника; дни до старта пропущенными не считаются.
                </p>
              </section>
            ) : (
              <p className="tiny laid-quiet-note">
                {position && !position.beforeStart
                  ? `Новые максимумы действуют с недели ${position.week + 1} (текущей); пройденные недели остаются на прежних числах.`
                  : "Цикл ещё не начался: новые максимумы действуют с первой недели."}
              </p>
            )}

            {/* Section 3: Program Options (clean 1-button DUP v2 summary or minimal original toggles) */}
            {mode === "create" ? (
              <>
                {isV2 ? (
                  <section className="laid-section laid-settings-card laid-v2-summary-card" aria-labelledby={`${uid}-opts-title`}>
                    <div className="laid-v2-summary-head">
                      <h3 id={`${uid}-opts-title`} className="laid-section-title">
                        Что улучшено в «Умном DUP v2»
                      </h3>
                      <span className="laid-v2-pill">124 подх. · 14 осевых</span>
                    </div>
                    <ul className="laid-v2-bullets">
                      {LaidDupPlan.V2_SUMMARY_BULLETS.map((item) => (
                        <li key={item.title}>
                          <Check size={14} aria-hidden="true" />
                          <span>
                            <b>{item.title}:</b> {item.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {props.routines.length > 0 && props.onReplaceRoutines ? (
                      <div className="laid-switches-grouped" style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={replaceExisting}
                          className="laid-switch laid-switch-row"
                          onClick={() => setReplaceExisting(!replaceExisting)}
                        >
                          <span className="laid-switch-text">
                            Заменить текущие программы ({props.routines.length})
                            <small>
                              {replaceExisting
                                ? "Старые программы удалятся разом, история тренировок останется."
                                : "Текущие программы останутся, к ним добавятся 6 дней DUP v2."}
                            </small>
                          </span>
                          <span className="laid-switch-control" aria-hidden="true">
                            <span className="laid-switch-state">{replaceExisting ? "Заменить" : "Добавить"}</span>
                            <span className="laid-switch-track">
                              <m.span className="laid-switch-thumb" layout transition={reduced ? { duration: 0 } : SPRING_THUMB} />
                            </span>
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </section>
                ) : (
                  <section className="laid-section laid-settings-card" aria-labelledby={`${uid}-opts-title`}>
                    <h3 id={`${uid}-opts-title`} className="laid-section-title">
                      Параметры оригинала
                    </h3>
                    <div className="laid-switches-grouped">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={extras}
                        className="laid-switch laid-switch-row"
                        onClick={() => setExtras(!extras)}
                      >
                        <span className="laid-switch-text">
                          Добавить к оригиналу: задняя дельта, отведения, икры, пресс
                          <small>
                            {extras
                              ? `+${sets.added} ${setsWord(sets.added)} в неделю (${sets.base + sets.added} всего); добавленное помечено.`
                              : `Без добавок: ${sets.base} ${setsWord(sets.base)} в неделю.`}
                          </small>
                        </span>
                        <span className="laid-switch-control" aria-hidden="true">
                          <span className="laid-switch-state">{extras ? "Вкл" : "Выкл"}</span>
                          <span className="laid-switch-track">
                            <m.span className="laid-switch-thumb" layout transition={reduced ? { duration: 0 } : SPRING_THUMB} />
                          </span>
                        </span>
                      </button>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={light}
                        className="laid-switch laid-switch-row"
                        onClick={() => setLight(!light)}
                      >
                        <span className="laid-switch-text">
                          Облегчённо: вместо одного повторения — три
                          <small>Синглы (95–97,5 %) → тройки (90–92,5 %), двойки тяги → 4 × 4.</small>
                        </span>
                        <span className="laid-switch-control" aria-hidden="true">
                          <span className="laid-switch-state">{light ? "Вкл" : "Выкл"}</span>
                          <span className="laid-switch-track">
                            <m.span className="laid-switch-thumb" layout transition={reduced ? { duration: 0 } : SPRING_THUMB} />
                          </span>
                        </span>
                      </button>

                      {props.routines.length > 0 && props.onReplaceRoutines ? (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={replaceExisting}
                          className="laid-switch laid-switch-row"
                          onClick={() => setReplaceExisting(!replaceExisting)}
                        >
                          <span className="laid-switch-text">
                            Заменить текущие программы ({props.routines.length})
                            <small>
                              {replaceExisting
                                ? "Старые программы удалятся разом, история тренировок останется."
                                : "Текущие программы останутся, к ним добавятся 6 дней Лейда."}
                            </small>
                          </span>
                          <span className="laid-switch-control" aria-hidden="true">
                            <span className="laid-switch-state">{replaceExisting ? "Заменить" : "Добавить"}</span>
                            <span className="laid-switch-track">
                              <m.span className="laid-switch-thumb" layout transition={reduced ? { duration: 0 } : SPRING_THUMB} />
                            </span>
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </section>
                )}

                {/* Section 4: Exercise Substitutions Disclosure (injuries / gym adaptation) */}
                <details
                  className="laid-disclosure laid-subs-disclosure"
                  open={subsOpen}
                  onToggle={(e) => setSubsOpen(e.currentTarget.open)}
                >
                  <summary>
                    <span className="laid-disclosure-label">
                      <span>Заменить упражнения на весь цикл</span>
                      <small>При травмах или под оборудование — периодизация и объём сохраняются</small>
                    </span>
                    <span className={`laid-custom-badge${subCount > 0 ? " is-filled" : ""}`}>
                      {subCount > 0 ? `Замен: ${subCount}` : "Все 6 дней"}
                    </span>
                  </summary>
                  {subsOpen ? (
                    <div className="laid-subs-body">
                      <div className="laid-volume-strip" aria-label="Плановый объём цикла">
                      <div className="laid-volume-strip-head">
                        <span>Плановый объём в неделю</span>
                        <span className="laid-volume-axial">
                          Осевая нагрузка: <b>{volumeSummary.axialSets}</b> подх.
                          {volumeSummary.axialSets !== baselineVolume.axialSets ? (
                            <small>
                              {" "}
                              ({volumeSummary.axialSets - baselineVolume.axialSets > 0 ? "+" : ""}
                              {volumeSummary.axialSets - baselineVolume.axialSets})
                            </small>
                          ) : null}
                        </span>
                      </div>
                      <div className="laid-volume-chips">
                        {volumeSummary.muscles.map((mItem) => {
                          const baseSets = baselineVolume.muscles.find((b) => b.id === mItem.id)?.sets ?? 0;
                          const delta = Math.round((mItem.sets - baseSets) * 10) / 10;
                          return (
                            <span key={mItem.id} className={`laid-vol-chip${delta !== 0 ? " changed" : ""}`}>
                              <span>{mItem.name}</span>
                              <b>{LaidDupPlan.kg(mItem.sets)}</b>
                              {delta !== 0 ? (
                                <small>{delta > 0 ? `+${LaidDupPlan.kg(delta)}` : LaidDupPlan.kg(delta)}</small>
                              ) : null}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <div className="laid-subs-group">
                      <p className="laid-subcaption">Базовые движения (волновая периодизация DUP)</p>
                      <ul className="laid-subs-list">
                        {liftSlots.map((slot) => {
                          const origName = exerciseById(slot.originalId)?.name ?? slot.originalId;
                          const curName = exerciseById(slot.resolvedId)?.name ?? slot.resolvedId;
                          return (
                            <li key={slot.originalId} className={`laid-subs-item${slot.replaced ? " is-replaced" : ""}`}>
                              <div className="laid-subs-item-info">
                                <b>{curName}</b>
                                <small>
                                  {slot.days.map((d) => LaidDupPlan.SHORT[d]).join(" · ")} · {slot.weeklySets} подх./нед
                                  {slot.replaced ? ` · вместо «${origName}»` : ""}
                                </small>
                              </div>
                              <div className="laid-subs-item-actions">
                                {slot.replaced ? (
                                  <button
                                    type="button"
                                    className="laid-subs-reset-btn"
                                    aria-label={`Вернуть ${origName}`}
                                    onClick={() => applySubstitution(slot.originalId, null)}
                                  >
                                    <RotateCcw size={14} aria-hidden="true" />
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="laid-subs-swap-btn"
                                  onClick={() => setSwapSlot(slot)}
                                >
                                  <ArrowLeftRight size={14} aria-hidden="true" />
                                  <span>Заменить</span>
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    <div className="laid-subs-group">
                      <p className="laid-subcaption">Подсобные упражнения</p>
                      <ul className="laid-subs-list">
                        {auxSlots.map((slot) => {
                          const origName = exerciseById(slot.originalId)?.name ?? slot.originalId;
                          const curName = exerciseById(slot.resolvedId)?.name ?? slot.resolvedId;
                          return (
                            <li key={slot.originalId} className={`laid-subs-item${slot.replaced ? " is-replaced" : ""}`}>
                              <div className="laid-subs-item-info">
                                <b>{curName}</b>
                                <small>
                                  {slot.days.map((d) => LaidDupPlan.SHORT[d]).join(" · ")} · {slot.weeklySets} подх./нед
                                  {slot.role === "wave-aux" ? " · волна повт." : ""}
                                  {slot.replaced ? ` · вместо «${origName}»` : ""}
                                </small>
                              </div>
                              <div className="laid-subs-item-actions">
                                {slot.replaced ? (
                                  <button
                                    type="button"
                                    className="laid-subs-reset-btn"
                                    aria-label={`Вернуть ${origName}`}
                                    onClick={() => applySubstitution(slot.originalId, null)}
                                  >
                                    <RotateCcw size={14} aria-hidden="true" />
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="laid-subs-swap-btn"
                                  onClick={() => setSwapSlot(slot)}
                                >
                                  <ArrowLeftRight size={14} aria-hidden="true" />
                                  <span>Заменить</span>
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                  ) : null}
                </details>

                <AnimatePresence initial={false}>
                  {taken.length ? (
                    <m.ul
                      className="laid-taken"
                      aria-label="Занятые дни"
                      initial={reduced ? false : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18 }}
                    >
                      {taken.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </m.ul>
                  ) : null}
                </AnimatePresence>
              </>
            ) : cycleIsV2 ? null : (
              <details className="laid-disclosure laid-update-opts" open={mode === "restart"}>
                <summary>
                  <span className="laid-disclosure-label">
                    <span>Дополнительные параметры цикла</span>
                    <small>
                      {rollingWeek ? "Плавающая неделя" : "Календарные недели"}
                      {!props.minorMode ? (autoEscalate ? " · авто +5 %" : " · 1ПМ вручную") : ""}
                    </small>
                  </span>
                </summary>
                <div className="laid-switches-grouped laid-update-opts-body">
                  {mode === "restart" ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={midDeload}
                      className="laid-switch laid-switch-row"
                      onClick={() => setMidDeload(!midDeload)}
                    >
                      <span className="laid-switch-text">
                        Разгрузка после волны 2 (неделя 7)
                        <small>Вставляет разгрузочную неделю (55–65 %, половина подходов, RIR 3–4).</small>
                      </span>
                      <span className="laid-switch-control" aria-hidden="true">
                        <span className="laid-switch-state">{midDeload ? "Вкл" : "Выкл"}</span>
                        <span className="laid-switch-track">
                          <m.span className="laid-switch-thumb" layout transition={reduced ? { duration: 0 } : SPRING_THUMB} />
                        </span>
                      </span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={rollingWeek}
                    className="laid-switch laid-switch-row"
                    onClick={() => setRollingWeek(!rollingWeek)}
                  >
                    <span className="laid-switch-text">
                      Плавающая неделя (по факту 6 тренировок)
                      <small>
                        Новая неделя DUP начинается после выполнения 6 тренировок цикла — пропуск дня не «сжигает» волну.
                      </small>
                    </span>
                    <span className="laid-switch-control" aria-hidden="true">
                      <span className="laid-switch-state">{rollingWeek ? "Вкл" : "Выкл"}</span>
                      <span className="laid-switch-track">
                        <m.span className="laid-switch-thumb" layout transition={reduced ? { duration: 0 } : SPRING_THUMB} />
                      </span>
                    </span>
                  </button>
                  {!props.minorMode ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoEscalate}
                      className="laid-switch laid-switch-row"
                      onClick={() => setAutoEscalate(!autoEscalate)}
                    >
                      <span className="laid-switch-text">
                        Автоповышение 1ПМ внутри цикла (+5 %)
                        <small>
                          {autoEscalate
                            ? "Веса волн растут автоматически при росте расчётного 1ПМ на ≥5 %."
                            : "Выкл: при росте 1ПМ появится подсказка с кнопкой, без скрытых изменений."}
                        </small>
                      </span>
                      <span className="laid-switch-control" aria-hidden="true">
                        <span className="laid-switch-state">{autoEscalate ? "Вкл" : "Выкл"}</span>
                        <span className="laid-switch-track">
                          <m.span className="laid-switch-thumb" layout transition={reduced ? { duration: 0 } : SPRING_THUMB} />
                        </span>
                      </span>
                    </button>
                  ) : null}
                </div>
              </details>
            )}

            {/* Section 5: Compact Preview */}
            <AnimatePresence initial={false}>
              {maxes ? (
                <m.div
                  key="preview"
                  className="laid-preview"
                  aria-label={`Неделя ${previewWeek + 1} по этим максимумам`}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.22 }}
                >
                  <div className="laid-preview-head">
                    <p className="field-caption">
                      Неделя {previewWeek + 1} по этим максимумам · волна {previewWave}
                    </p>
                    <span className="laid-preview-meta">отдых: база 3–5 мин · подсобка 1–3 мин</span>
                  </div>
                  <ul className="laid-preview-grid">
                    {[...LaidDupPlan.DAYS]
                      .sort((a, b) => (mode === "create" ? weekdays[a] - weekdays[b] : cycleWeekdays[a] - cycleWeekdays[b]))
                      .map((day) => {
                        const plan = LaidDupPlan.day(day, previewWeek, maxes, {
                          version: mode === "create" ? version : base?.version,
                          light: mode === "create" ? (isV2 ? true : light) : (base?.light ?? false),
                          substitutions: mode === "create" ? activeSubs : base?.substitutions,
                          calibrationLifts: mode === "create" ? calibrationLifts : base?.calibrationLifts,
                          painFlags: mode === "create" ? painFlags : base?.painFlags,
                        });
                        const weekday = mode === "create" ? weekdays[day] : cycleWeekdays[day];
                        const replacedLiftName =
                          plan.liftExerciseId !== plan.originalLiftExerciseId
                            ? exerciseById(plan.liftExerciseId)?.name
                            : null;
                        return (
                          <li key={day}>
                            <span className="laid-preview-day">
                              <b>{LaidDupPlan.SHORT[day]}</b>
                              <small>{DAY_NAMES[weekday]}</small>
                            </span>
                            <span className="laid-preview-detail">
                              {replacedLiftName ? <small className="laid-preview-sub-lift">{replacedLiftName}</small> : null}
                              <span className="laid-preview-line">{LaidDupPlan.line(plan)}</span>
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                </m.div>
              ) : null}
            </AnimatePresence>

            <p className="tiny laid-quiet-note">{LaidDupPlan.NOTICE}</p>
            {error ? (
              <p className="error-banner" role="alert">
                {error}
              </p>
            ) : null}

            <div className="laid-actions laid-sticky-footer">
              <button type="submit" className="button primary" disabled={busy}>
                {busy ? "Сохраняем…" : mode === "create" ? "Создать программу" : mode === "restart" ? "Начать новый цикл" : "Обновить максимумы"}
              </button>
              <button type="button" className="button secondary" onClick={props.onClose} disabled={busy}>
                Отмена
              </button>
            </div>
          </fieldset>
        </form>
      </Modal>

      {swapSlot && swapCurrentEx ? (
        <ExerciseSwapModal
          title={swapSlot.role === "lift" ? "Заменить базовое движение" : "Заменить упражнение в цикле"}
          subtitle={`Замена применится на всех 9 неделях цикла (${swapSlot.days.map((d) => LaidDupPlan.SHORT[d]).join(" · ")}). Объём по мышцам и периодизация пересчитаются автоматически.`}
          currentExercise={swapCurrentEx}
          originalExercise={swapOriginalEx}
          showCompatibilityFor={swapSlot.role === "lift" ? swapOriginalEx : undefined}
          workouts={props.workouts}
          today={today}
          personal={props.personal}
          avoidedIds={avoidedIds}
          excludeIds={swapExcludeIds}
          requireWeighted={swapSlot.role === "lift"}
          onSwap={(nextEx) => applySubstitution(swapSlot.originalId, nextEx.id)}
          onReset={() => applySubstitution(swapSlot.originalId, null)}
          onClose={() => setSwapSlot(null)}
        />
      ) : null}
    </>
  );
}
