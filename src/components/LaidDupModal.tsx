import { useMemo, useState } from "react";
import { DAY_NAMES } from "../domain/TrainingProgram";
import { LaidDupPlan, type LaidLift } from "../domain/LaidDupPlan";
import { addCalendarDays, dateLabel } from "../lib/calendar";
import { setsWord } from "../lib/quantity";
import type { LaidMaxes, Routine, Workout } from "../lib/types";
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
const LABEL: Record<LaidLift, string> = { squat: "1ПМ: присед", bench: "1ПМ: жим лёжа", deadlift: "1ПМ: становая", ohp: "1ПМ: армейский жим" };

/** Окно «Дэвид Лейд · DUP»: четыре максимума, старт, добавки; то же окно обновляет максимумы и начинает новый цикл. */
export default function LaidDupModal(props: Props) {
  const { mode, cycle, today } = props;
  const base = cycle?.[0]?.periodization;
  const sets = useMemo(() => LaidDupPlan.weeklySets(), []);
  const estimates = useMemo(() => LaidDupPlan.estimates(props.workouts, today), [props.workouts, today]);
  const [ask, setAsk] = useState(mode === "create" && !!props.existing);
  const [values, setValues] = useState<Record<LaidLift, string>>(() =>
    Object.fromEntries(LIFTS.map((l) => [l, base ? LaidDupPlan.kg(base.maxes[l]) : ""])) as Record<LaidLift, string>,
  );
  const [shown, setShown] = useState(false);
  const [start, setStart] = useState<"this" | "next">(() => LaidDupPlan.defaultStart(today));
  const [extras, setExtras] = useState(true);
  const [light, setLight] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const checks = LIFTS.map((l) => ({ lift: l, ...LaidDupPlan.checkMax(values[l]) }));
  const valid = checks.every((c) => c.error === null);
  const maxes = valid ? (Object.fromEntries(checks.map((c) => [c.lift, c.value!])) as LaidMaxes) : null;
  const startMonday = LaidDupPlan.startMonday(today, start);
  const position = base ? LaidDupPlan.position(LaidDupPlan.weekOf(base.startMonday, today)) : null;

  const taken = useMemo(() => {
    if (mode !== "create") return [] as string[];
    return LaidDupPlan.DAYS.flatMap((day) => {
      const weekday = LaidDupPlan.WEEKDAY[day];
      const names = props.routines.filter((r) => r.days.includes(weekday)).map((r) => `«${r.name}»`);
      return names.length ? [`${DAY_NAMES[weekday]} уже занят программой ${names.join(", ")}: обе будут в плане недели.`] : [];
    });
  }, [mode, props.routines]);

  async function submit() {
    setShown(true);
    if (!maxes) return;
    setBusy(true);
    setError("");
    let saved = 0;
    try {
      if (mode === "create") {
        for (const r of LaidDupPlan.routines({ maxes, extras, light, startMonday })) {
          await props.onSave(r);
          saved++;
        }
        props.onDone("Программа Лейда создана: шесть дней, Пн–Сб. Расписание — в «Программах».");
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
        <div className="laid-modal">
          <p className="laid-lead">Программа Лейда уже есть. Повторное создание добавит ещё шесть программ.</p>
          <div className="laid-actions">
            <button type="button" className="button primary" onClick={() => props.onSwitch?.("update")}>
              Обновить максимумы
            </button>
            <button type="button" className="button secondary" onClick={() => setAsk(false)}>
              Создать ещё раз
            </button>
          </div>
        </div>
      </Modal>
    );

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
          <p className="laid-lead">
            1ПМ — максимум на одно повторение; вводи осторожное число. {LaidDupPlan.LOAD_NOTICE}
          </p>
          <div className="laid-fields">
            {LIFTS.map((lift, i) => {
              const c = checks[i];
              const estimate = estimates[lift];
              const message = shown && c.error ? c.error : "";
              return (
                <div className="laid-field" key={lift}>
                  <label>
                    {LABEL[lift]}
                    <span className="laid-input">
                      <input
                        inputMode="decimal"
                        autoComplete="off"
                        aria-invalid={message ? true : undefined}
                        aria-describedby={`laid-${lift}-note`}
                        data-autofocus={i === 0 ? "" : undefined}
                        placeholder="кг"
                        value={values[lift]}
                        onChange={(e) => setValues({ ...values, [lift]: e.target.value })}
                      />
                    </span>
                  </label>
                  <div id={`laid-${lift}-note`} className="laid-field-note">
                    {message ? (
                      <p className="laid-error" role="alert">
                        {message}
                      </p>
                    ) : null}
                    {estimate !== null ? (
                      <button
                        type="button"
                        className="laid-estimate"
                        onClick={() => setValues({ ...values, [lift]: LaidDupPlan.kg(estimate) })}
                      >
                        по истории ≈ {LaidDupPlan.kg(estimate)} кг (Эпли)
                      </button>
                    ) : null}
                    {estimate !== null ? (
                      <small className="laid-estimate-window">по подходам {LaidDupPlan.windowText(LaidDupPlan.ESTIMATE_DAYS)}</small>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {mode !== "update" ? (
            <div className="laid-group" role="group" aria-label="Неделя 1 начинается">
              <p className="field-caption">Неделя 1 начинается</p>
              <div className="laid-choice">
                {(["this", "next"] as const).map((which) => (
                  <button
                    type="button"
                    key={which}
                    aria-pressed={start === which}
                    className={start === which ? "active" : ""}
                    onClick={() => setStart(which)}
                  >
                    {which === "this" ? "с понедельника этой недели" : "со следующего понедельника"}
                    <small>{dateLabel(LaidDupPlan.startMonday(today, which))}</small>
                  </button>
                ))}
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
              <button type="button" role="switch" aria-checked={extras} className="laid-switch" onClick={() => setExtras(!extras)}>
                <span className="laid-switch-text">
                  Добавить к оригиналу: задняя и средняя дельта, пресс
                  <small>В таблице Лейда этого нет: добавленное помечено «добавлено».</small>
                  <small className="laid-switch-count">
                    {extras ? `+${sets.added} ${setsWord(sets.added)} в неделю` : `без добавок: ${sets.base} ${setsWord(sets.base)} в неделю`}
                  </small>
                </span>
                <span className="laid-switch-state" aria-hidden="true">
                  {extras ? "Вкл" : "Выкл"}
                </span>
              </button>
              <button type="button" role="switch" aria-checked={light} className="laid-switch" onClick={() => setLight(!light)}>
                <span className="laid-switch-text">
                  Облегчённо: вместо одного повторения — три
                  <small>Не по оригиналу. Подход на одно повторение заменяется подходом на три повторения.</small>
                </span>
                <span className="laid-switch-state" aria-hidden="true">
                  {light ? "Вкл" : "Выкл"}
                </span>
              </button>
              {taken.length ? (
                <ul className="laid-taken" aria-label="Занятые дни">
                  {taken.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}

          {maxes ? (
            <div className="laid-preview" aria-label="Неделя 1 по этим максимумам">
              <p className="field-caption">Неделя 1 по этим максимумам</p>
              <ul>
                {LaidDupPlan.DAYS.map((day) => (
                  <li key={day}>
                    <b>{LaidDupPlan.SHORT[day]}</b>
                    <span>{LaidDupPlan.line(LaidDupPlan.day(day, 0, maxes, { light: mode === "create" ? light : (base?.light ?? false) }))}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
