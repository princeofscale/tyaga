import { useMemo, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { Check, Sparkles } from "lucide-react";
import { DAY_NAMES } from "../domain/TrainingProgram";
import { LaidDupPlan, type LaidLift, type LaidWeekSlot } from "../domain/LaidDupPlan";
import { addCalendarDays, dateLabel } from "../lib/calendar";
import { setsWord } from "../lib/quantity";
import type { LaidMaxes, Routine, Workout } from "../lib/types";
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
  today: string;
  onSave: (routine: Routine) => Promise<Routine>;
  onClose: () => void;
  /** Сообщение после успешного сохранения. */
  onDone: (message: string) => void;
  /** «Обновить максимумы» из окна «Создать ещё раз». */
  onSwitch?: (mode: Mode) => void;
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

/** Окно «Дэвид Лейд · DUP»: четыре максимума, старт, ритм недели, добавки; то же окно обновляет максимумы и начинает новый цикл. */
export default function LaidDupModal(props: Props) {
  const { mode, cycle, today } = props;
  const reduced = useReducedMotion();
  const base = cycle?.[0]?.periodization;
  const sets = useMemo(() => LaidDupPlan.weeklySets(), []);
  const estimates = useMemo(() => LaidDupPlan.estimates(props.workouts, today), [props.workouts, today]);
  const [ask, setAsk] = useState(mode === "create" && !!props.existing);
  const [values, setValues] = useState<Record<LaidLift, string>>(() =>
    Object.fromEntries(LIFTS.map((l) => [l, base ? LaidDupPlan.kg(base.maxes[l]) : ""])) as Record<LaidLift, string>,
  );
  const [appliedLift, setAppliedLift] = useState<LaidLift | null>(null);
  const [shown, setShown] = useState(false);
  const [start, setStart] = useState<"this" | "next">(() => LaidDupPlan.defaultStart(today));
  const [slots, setSlots] = useState<LaidWeekSlot[]>(() => LaidDupPlan.slotsForRhythm("6x1"));
  const [customOpen, setCustomOpen] = useState(false);
  const [extras, setExtras] = useState(true);
  const [light, setLight] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rhythm = useMemo(() => LaidDupPlan.matchingRhythm(slots), [slots]);
  const weekdays = useMemo(() => LaidDupPlan.weekdaysFromSlots(slots), [slots]);
  const cycleWeekdays = useMemo(
    () => (cycle?.length ? LaidDupPlan.weekdaysFromSlots(LaidDupPlan.slotsFromCycle(cycle)) : LaidDupPlan.WEEKDAY),
    [cycle],
  );
  const checks = LIFTS.map((l) => ({ lift: l, ...LaidDupPlan.checkMax(values[l]) }));
  const valid = checks.every((c) => c.error === null);
  const maxes = valid ? (Object.fromEntries(checks.map((c) => [c.lift, c.value!])) as LaidMaxes) : null;
  const startMonday = LaidDupPlan.startMonday(today, start);
  const position = base ? LaidDupPlan.position(LaidDupPlan.weekOf(base.startMonday, today)) : null;

  const taken = useMemo(() => {
    if (mode !== "create") return [] as string[];
    return [...LaidDupPlan.DAYS]
      .sort((a, b) => weekdays[a] - weekdays[b])
      .flatMap((day) => {
        const weekday = weekdays[day];
        const names = props.routines.filter((r) => r.days.includes(weekday)).map((r) => `«${r.name}»`);
        return names.length ? [`${DAY_NAMES[weekday]} уже занят программой ${names.join(", ")}: обе будут в плане недели.`] : [];
      });
  }, [mode, props.routines, weekdays]);

  async function submit() {
    setShown(true);
    if (!maxes) return;
    setBusy(true);
    setError("");
    let saved = 0;
    try {
      if (mode === "create") {
        for (const r of LaidDupPlan.routines({ maxes, extras, light, startMonday, weekdays })) {
          await props.onSave(r);
          saved++;
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
        props.onDone(`Программа Лейда создана: шесть дней, ${daysLabel}. Расписание — в «Программах».`);
      } else {
        const week = position ? position.week : 0;
        for (const r of cycle ?? []) {
          const p = r.periodization!;
          const next =
            mode === "restart"
              ? { ...p, startMonday, maxes, maxesFromWeek: 0, earlier: undefined }
              : LaidDupPlan.withMaxes(p, maxes, position && !position.beforeStart ? week : 0);
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
          <p className="laid-lead">Программа Лейда уже есть. Повторное создание добавит ещё шесть программ.</p>
          <div className="laid-actions">
            <button type="button" className="button primary" onClick={() => props.onSwitch?.("update")}>
              Обновить максимумы
            </button>
            <button type="button" className="button secondary" onClick={() => setAsk(false)}>
              Создать ещё раз
            </button>
          </div>
        </m.div>
      </Modal>
    );

  const previewWeek = mode === "update" && position && !position.beforeStart ? position.week : 0;
  const previewWave = Math.floor(previewWeek / 3) + 1;

  return (
    <Modal title={title} wide onClose={() => (busy ? false : props.onClose())}>
      <form
        className="product-form laid-modal"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy}>
          <div className="laid-lead-box">
            <p className="laid-lead">
              1ПМ — максимум на одно повторение; вводи осторожное число. {LaidDupPlan.LOAD_NOTICE}
            </p>
            {mode === "restart" ? <p className="tiny laid-deload-hint">{LaidDupPlan.DELOAD_NOTICE}</p> : null}
          </div>

          <div className="laid-fields">
            {LIFTS.map((lift, i) => {
              const c = checks[i];
              const estimate = estimates[lift];
              const message = shown && c.error ? c.error : "";
              const isApplied = appliedLift === lift && values[lift] === (estimate !== null ? LaidDupPlan.kg(estimate) : "");
              return (
                <m.div
                  className={`laid-field${message ? " has-error" : ""}${c.value ? " is-valid" : ""}`}
                  key={lift}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: reduced ? 0 : i * 0.035 }}
                >
                  <label>
                    <span className="laid-field-head">
                      <span>{LABEL[lift]}</span>
                      <small className="laid-field-tag">{LIFT_DAYS[lift]}</small>
                    </span>
                    <span className="laid-input">
                      <input
                        inputMode="decimal"
                        autoComplete="off"
                        aria-invalid={message ? true : undefined}
                        aria-describedby={`laid-${lift}-note`}
                        data-autofocus={i === 0 ? "" : undefined}
                        placeholder="0"
                        value={values[lift]}
                        onChange={(e) => setValues({ ...values, [lift]: e.target.value })}
                      />
                      <span className="laid-unit" aria-hidden="true">
                        кг
                      </span>
                    </span>
                  </label>
                  <div id={`laid-${lift}-note`} className="laid-field-note">
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
                    {estimate !== null ? (
                      <m.button
                        type="button"
                        className={`laid-estimate${isApplied ? " applied" : ""}`}
                        whileTap={reduced ? undefined : { scale: 0.97 }}
                        onClick={() => {
                          setValues({ ...values, [lift]: LaidDupPlan.kg(estimate) });
                          setAppliedLift(lift);
                        }}
                      >
                        {isApplied ? <Check size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
                        <span>по истории ≈ {LaidDupPlan.kg(estimate)} кг (Эпли)</span>
                      </m.button>
                    ) : null}
                    {estimate !== null ? (
                      <small className="laid-estimate-window">по подходам {LaidDupPlan.windowText(LaidDupPlan.ESTIMATE_DAYS)}</small>
                    ) : null}
                  </div>
                </m.div>
              );
            })}
          </div>

          {mode !== "update" ? (
            <div className="laid-group" role="group" aria-label="Неделя 1 начинается">
              <p className="field-caption">Неделя 1 начинается</p>
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
              <p className="tiny">Недели считаются от понедельника; дни до старта пропущенными не считаются.</p>
            </div>
          ) : (
            <p className="tiny">
              {position && !position.beforeStart
                ? `Новые максимумы действуют с недели ${position.week + 1} (текущей); пройденные недели остаются на прежних числах.`
                : "Цикл ещё не начался: новые максимумы действуют с первой недели."}
            </p>
          )}

          {mode === "create" ? (
            <>
              <div className="laid-group" role="group" aria-label="Ритм недели">
                <p className="field-caption">Распределение дней отдыха</p>
                <div className="laid-choice">
                  {(
                    [
                      {
                        id: "6x1" as const,
                        label: "Пн–Сб подряд · выходной Вс",
                        sub: "Дни в порядке таблицы, без паузы внутри недели",
                      },
                      {
                        id: "3x1x3" as const,
                        label: "3 + 1 + 3 · выходной Чт",
                        sub: "Отдых между Тягой 1 и приседом Ног 2",
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
                  className="laid-custom-order"
                  open={customOpen}
                  onToggle={(e) => setCustomOpen(e.currentTarget.open)}
                >
                  <summary>
                    <span>Настроить порядок дней по неделе</span>
                    {rhythm === "custom" ? <span className="laid-custom-badge">Свой порядок</span> : null}
                  </summary>
                  {customOpen ? (
                    <div className="laid-custom-order-body">
                      <LaidWeekOrderEditor slots={slots} onChange={setSlots} showPresets={false} disabled={busy} />
                    </div>
                  ) : null}
                </details>
              </div>

              <div className="laid-switches">
                <button type="button" role="switch" aria-checked={extras} className="laid-switch" onClick={() => setExtras(!extras)}>
                  <span className="laid-switch-text">
                    Добавить к оригиналу: задняя дельта, отведения, икры, пресс
                    <small>У Лейда нет задней дельты, икр и пресса, а махов в стороны — 6 подходов в неделю; добавленное помечено.</small>
                    <small className="laid-switch-count">
                      {extras ? `+${sets.added} ${setsWord(sets.added)} в неделю (${sets.base + sets.added} всего)` : `без добавок: ${sets.base} ${setsWord(sets.base)} в неделю`}
                    </small>
                  </span>
                  <span className="laid-switch-control" aria-hidden="true">
                    <span className="laid-switch-state">{extras ? "Вкл" : "Выкл"}</span>
                    <span className="laid-switch-track">
                      <m.span className="laid-switch-thumb" layout transition={reduced ? { duration: 0 } : SPRING_THUMB} />
                    </span>
                  </span>
                </button>

                <button type="button" role="switch" aria-checked={light} className="laid-switch" onClick={() => setLight(!light)}>
                  <span className="laid-switch-text">
                    Облегчённо: вместо одного повторения — три
                    <small>Не по оригиналу. Синглы (95–97,5 %) заменяются тройками (90–92,5 %), двойки становой — на 4 × 4.</small>
                  </span>
                  <span className="laid-switch-control" aria-hidden="true">
                    <span className="laid-switch-state">{light ? "Вкл" : "Выкл"}</span>
                    <span className="laid-switch-track">
                      <m.span className="laid-switch-thumb" layout transition={reduced ? { duration: 0 } : SPRING_THUMB} />
                    </span>
                  </span>
                </button>
              </div>

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
          ) : null}

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
                  <span className="laid-preview-meta">отдых 3:00</span>
                </div>
                <ul>
                  {[...LaidDupPlan.DAYS]
                    .sort((a, b) => (mode === "create" ? weekdays[a] - weekdays[b] : cycleWeekdays[a] - cycleWeekdays[b]))
                    .map((day) => {
                      const plan = LaidDupPlan.day(day, previewWeek, maxes, { light: mode === "create" ? light : (base?.light ?? false) });
                      const weekday = mode === "create" ? weekdays[day] : cycleWeekdays[day];
                      return (
                        <li key={day}>
                          <span className="laid-preview-day">
                            <b>{LaidDupPlan.SHORT[day]}</b>
                            <small>{DAY_NAMES[weekday]}</small>
                          </span>
                          <span className="laid-preview-line">{LaidDupPlan.line(plan)}</span>
                        </li>
                      );
                    })}
                </ul>
              </m.div>
            ) : null}
          </AnimatePresence>

          <p className="tiny">{LaidDupPlan.NOTICE}</p>
          {error ? (
            <p className="error-banner" role="alert">
              {error}
            </p>
          ) : null}
          <div className="laid-actions">
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
  );
}

/** Понедельник недели `week` (0-based) от старта — для подписей. */
export const laidWeekMonday = (startMonday: string, week: number) => addCalendarDays(startMonday, week * 7);
