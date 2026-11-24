import { useBodyweight } from "../state/bodyweightStore";
import { JournalBackup, type ProfileBackup } from "../domain/JournalBackup";
import type { ThemeId } from "../lib/theme";
import { useMemo, useRef, useState } from "react";
import { FileUp, Import, ShieldCheck } from "lucide-react";
import {
  WorkoutImport,
  type ImportFormat,
  type ImportPreview,
  type ImportOptions,
} from "../domain/WorkoutImport";
import { ImportNameMatcher } from "../domain/ImportNameMatcher";
import { DateText } from "../domain/DateText";
import { RestorePlan, type ExistingData } from "../domain/RestorePlan";
import { importService } from "../services/ImportService";
import Select from "./Select";
import { EXERCISES, exerciseById, localDate } from "../lib/model";
import type { Exercise, Settings } from "../lib/types";

type Props = {
  timeZone: string;
  onComplete: (result: {
    imported: number;
    skipped: number;
    replaced?: number;
    kept?: number;
    runId?: string;
    addedIds?: string[];
    settings?: Settings;
    theme?: ThemeId;
    weightCount?: number;
    profile?: ProfileBackup;
  }) => Promise<void>;
  onBusy: (busy: boolean) => void;
  /** «restore» — окно «Восстановление из копии»: только JSON Тяги, итог остаётся на экране до закрытия. */
  mode?: "import" | "restore";
  /** Что уже есть в аккаунте — для строк «Новых · Уже есть · Отличаются». */
  existing?: ExistingData;
  onClose?: () => void;
};
export default function HistoryImporter({
  timeZone,
  onComplete,
  onBusy,
  mode = "import",
  existing,
  onClose,
}: Props) {
  const restoring = mode === "restore";
  const [finished, setFinished] = useState<string[] | null>(null);
  const journal = useBodyweight();
  const [restoreProfile, setRestoreProfile] = useState(false);
  const [restoreWeight, setRestoreWeight] = useState(true),
    [replaceWeight, setReplaceWeight] = useState(false);
  const [text, setText] = useState(""),
    [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<ImportFormat>(restoring ? "tyaga" : "strong");
  const [options, setOptions] = useState<ImportOptions>({
    dateOrder: "dmy",
    weightUnit: "kg",
    distanceUnit: "km",
    timeZone,
  });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [matches, setMatches] = useState<Record<string, Exercise[]>>({});
  // Only what the user changed by hand; everything else follows ImportMapping.
  const [userChoices, setUserChoices] = useState<Record<string, string>>({}),
    [machines, setMachines] = useState<Record<string, string>>({}),
    [sides, setSides] = useState<Record<string, "both" | "left" | "right">>({});
  // «Как моя» by default: a barbell number in a Strong/Hevy/FitNotes file is the
  // total bar weight unless the user says otherwise.
  const [weightTotal, setWeightTotal] = useState<"yes" | "no">("yes"),
    [weightEach, setWeightEach] = useState<"yes" | "no">("yes"),
    [replaceImported, setReplaceImported] = useState(true),
    [restoreExtras, setRestoreExtras] = useState(true),
    [restoreSettings, setRestoreSettings] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [progress, setProgress] = useState<{
    phase: string;
    done: number;
    total: number;
    imported: number;
    skipped: number;
  } | null>(null);
  const markBusy = (value: boolean) => {
    setBusy(value);
    onBusy(value);
  };
  const reset = () => {
    setPreview(null);
    setError("");
    setProgress(null);
  };
  const fileGen = useRef(0);
  async function file(file: File | undefined) {
    const gen = ++fileGen.current;
    reset();
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Выбери файл не больше 10 МБ.");
      return;
    }
    if (restoring && !file.name.toLowerCase().endsWith(".json")) {
      setError("Для восстановления нужен JSON-файл копии Тяги («Скачать полную копию»). CSV из Strong, Hevy и FitNotes — в «История → Импорт истории».");
      return;
    }
    try {
      const content = await file.text();
      if (gen !== fileGen.current) return;
      setText(content);
      setFileName(file.name);
      setFormat(
        file.name.toLowerCase().endsWith(".json")
          ? "tyaga"
          : content.split(/\r?\n/)[0].includes("start_time")
            ? "hevy"
            : /Exercise Name/i.test(content.split(/\r?\n/)[0])
              ? "strong"
              : "fitnotes",
      );
    } catch {
      if (gen !== fileGen.current) return;
      setError("Не удалось прочитать файл.");
    }
  }
  async function review() {
    markBusy(true);
    setError("");
    try {
      const data = new WorkoutImport(options).parse(text, format);
      if (data.workouts.some((w) => w.date > localDate(new Date(), w.timeZone)))
        throw new Error(
          "Файл содержит будущие даты. Проверь порядок дня и месяца.",
        );
      if (
        data.extras?.bodyweight?.entries.some(
          (e) => e.date > localDate(new Date(), timeZone),
        )
      )
        throw new Error("В копии есть взвешивания за будущую дату");
      const resolved =
        format === "tyaga"
          ? {}
          : await importService.resolve(data.exerciseNames);
      setMatches(resolved);
      setUserChoices({});
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать экспорт");
    } finally {
      markBusy(false);
    }
  }
  // Что каталог знает про каждое название: точные, близкие варианты, спорные и совсем свои.
  const verdicts = useMemo(
    () =>
      preview && preview.format !== "tyaga"
        ? ImportNameMatcher.classifyAll(preview.exerciseNames, matches, new Set(ImportNameMatcher.weights(preview).keys()))
        : {},
    [preview, matches],
  );
  const suggestion = (name: string) =>
    verdicts[name]?.exercise ?? verdicts[name]?.candidates[0] ?? null;
  const autoFor = (name: string) => {
    const verdict = verdicts[name];
    if (!verdict?.exercise || !["matched", "variant"].includes(verdict.kind))
      return "";
    const mode = verdict.exercise.recording.loadMode;
    if (mode === "total_external" && weightTotal !== "yes") return "";
    if (mode === "per_implement" && weightEach !== "yes") return "";
    return verdict.exercise.id;
  };
  const names = preview?.exerciseNames ?? [];
  // Тип записи в файле («повторы» или «время») должен совпасть с упражнением: «Планка» на время не примет повторы.
  const types = useMemo(() => (preview ? ImportNameMatcher.types(preview) : new Map<string, "reps" | "duration">()), [preview]);
  const rawChoice = (name: string) => (name in userChoices ? userChoices[name] : autoFor(name));
  const choiceFor = (name: string) => {
    const id = rawChoice(name);
    return id && ImportNameMatcher.usable(exerciseById(id), types.get(name)) ? id : "";
  };
  const mismatch = (name: string) => !!rawChoice(name) && !choiceFor(name);
  const weightPlan = useMemo(() => {
    if (!preview?.extras?.bodyweight) return null;
    const m = JournalBackup.merge(journal.tracker.getEntries(), preview.extras.bodyweight.entries);
    return { added: m.added, same: m.same, differs: m.conflictDates.length };
  }, [preview, journal]);
  const plan = useMemo(() => {
    if (!preview || preview.format !== "tyaga" || !existing) return null;
    const workouts = RestorePlan.workouts(preview.workouts, existing.workouts);
    const routines = RestorePlan.routines(preview.extras?.routines ?? [], existing.routines);
    const customs = RestorePlan.customExercises(preview.extras?.customExercises ?? [], existing.customExercises);
    const favorites = RestorePlan.favorites(preview.extras?.favorites ?? [], existing.favorites);
    return { workouts, routines, customs, favorites, nothing: RestorePlan.nothingNew(workouts, [routines, customs, favorites]) };
  }, [preview, existing]);
  // R11-REQ03: два цикла Лейда после восстановления — предупреждаем заранее; со снятым «Перенести программы» циклов не прибавится.
  const laidNotice =
    preview?.format === "tyaga" && existing && restoreExtras
      ? RestorePlan.laidNotice(preview.extras?.routines ?? [], existing.routines, String(new Date().getFullYear()))
      : "";
  // Счётчик считает ровно то, что случится при импорте: применённое упражнение — «сопоставлено», остальное — «Моё».
  const summary = ImportNameMatcher.summary(
    verdicts,
    Object.fromEntries(
      names
        .filter((n) => n in userChoices || ["matched", "variant"].includes(verdicts[n]?.kind))
        .map((n) => [n, choiceFor(n)]),
    ),
    names,
  );
  const relatedNames = names.filter(
    (n) => verdicts[n]?.related && !(n in userChoices) && ImportNameMatcher.usable(verdicts[n].candidates[0], types.get(n)),
  );
  const dropped = preview
    ? ImportNameMatcher.droppedWeights(preview, choiceFor, exerciseById)
    : [];
  const autoKinds = (kind: "variant" | "ask") =>
    names.filter((n) => verdicts[n]?.kind === kind && !(n in userChoices));
  const needsTotal = names.some(
    (n) => verdicts[n]?.exercise?.recording.loadMode === "total_external" && ["matched", "variant"].includes(verdicts[n].kind),
  );
  const needsEach = names.some(
    (n) => verdicts[n]?.exercise?.recording.loadMode === "per_implement" && ["matched", "variant"].includes(verdicts[n].kind),
  );
  async function run() {
    if (!preview) return;
    markBusy(true);
    setError("");
    setProgress({
      phase: "Подготовка",
      done: 0,
      total: 1,
      imported: 0,
      skipped: 0,
    });
    try {
      const prepared = ImportNameMatcher.prepare(preview, {
        choiceFor,
        find: exerciseById,
        verdicts,
        machines,
        sides,
      });
      const result = await importService.import(prepared, setProgress, {
        replace: replaceImported && prepared.format !== "tyaga",
      });
      if (restoreExtras && prepared.extras)
        await importService.restoreExtras(prepared, result.idMap, (phase) =>
          setProgress((p) => ({ ...p!, phase })),
        );
      const restored =
        restoreWeight && prepared.extras?.bodyweight
          ? await journal.change(() =>
              journal.restore(prepared.extras!.bodyweight!, replaceWeight),
            )
          : null;
      if (restored) void journal.sync();
      await onComplete({
        ...(restoreProfile && prepared.extras?.profile
          ? { profile: prepared.extras.profile }
          : {}),
        ...(restored
          ? {
              weightCount:
                restored.added +
                (replaceWeight ? restored.conflictDates.length : 0),
            }
          : {}),
        ...(restoreSettings && prepared.extras?.theme
          ? { theme: prepared.extras.theme }
          : {}),
        ...result,
        ...(restoreSettings && prepared.extras?.settings
          ? { settings: prepared.extras.settings }
          : {}),
      });
      if (restoring) {
        const added = result.imported - (result.replaced ?? 0);
        // Те же слова и та же арифметика, что в предпросмотре: «Новых · Уже есть · Отличаются».
        const tally = (label: string, added: number, t?: { same: number; differs: number }) =>
          `${label}: добавлено ${added}` + (t ? `, уже есть ${t.same}, отличаются ${t.differs}` : "");
        const lines = [tally("Тренировки", added, plan?.workouts)];
        if (restored) lines.push(`Вес: добавлено ${restored.added}${restored.conflictDates.length ? (replaceWeight ? `, заменено ${restored.conflictDates.length}` : `, отличаются ${restored.conflictDates.length}, остались твои`) : ""}`);
        if (restoreExtras && plan) {
          if (plan.routines.total) lines.push(tally("Программы", plan.routines.added, plan.routines));
          if (plan.customs.total) lines.push(tally("Свои упражнения", plan.customs.added, plan.customs));
          if (plan.favorites.total) lines.push(tally("Избранное", plan.favorites.added, plan.favorites));
        }
        const anything = added > 0 || (restored?.added ?? 0) > 0 || (restoreExtras && plan && (plan.routines.added + plan.customs.added + plan.favorites.added) > 0);
        setFinished([anything ? "Восстановление завершено." : `Ничего не добавлено: ${plan?.nothing ? plan.nothing.replace("Ничего нового: ", "") : "всё из копии уже в аккаунте"}.`, ...lines]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Импорт остановлен");
    } finally {
      markBusy(false);
    }
  }
  if (finished)
    return (
      <div className="history-importer">
        <section className="restore-result" role="status" aria-label="Итог восстановления">
          <h3>{finished[0]}</h3>
          <ul>
            {finished.slice(1).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <button type="button" className="button primary full-width" onClick={onClose}>
            Закрыть
          </button>
        </section>
      </div>
    );
  return (
    <div className="history-importer">
      <p className="modal-intro">
        {restoring
          ? "Восстановление из полной копии Тяги (JSON). Сначала посмотри, что внутри и что изменится; существующие тренировки и записи не перезаписываются."
          : "Перенеси историю из Strong, Hevy, FitNotes или JSON Тяги. Сначала проверь предпросмотр; существующие тренировки останутся."}
      </p>
      <label className="import-file">
        <FileUp size={30} />
        <b>{fileName || (restoring ? "Выбрать файл копии" : "Выбрать файл экспорта")}</b>
        <span>{restoring ? "JSON копии Тяги · до 10 МБ" : "CSV или JSON · до 10 МБ"}</span>
        <input
          aria-label="Файл истории тренировок"
          type="file"
          accept={restoring ? ".json,application/json" : ".csv,.json,text/csv,application/json"}
          disabled={busy}
          onChange={(e) => void file(e.target.files?.[0])}
        />
      </label>
      {restoring ? null : <fieldset disabled={busy} className="import-options">
        <label>
          Формат
          <Select
            value={format}
            onChange={(v) => {
              setFormat(v as ImportFormat);
              reset();
            }}
            options={[
              { value: "strong", label: "Strong CSV" },
              { value: "hevy", label: "Hevy CSV" },
              { value: "fitnotes", label: "FitNotes CSV" },
              { value: "tyaga", label: "Тяга JSON" },
            ]}
          />
        </label>
        {format !== "tyaga" ? (
          <>
            <label>
              Даты с цифрами
              <Select
                value={options.dateOrder}
                onChange={(v) => {
                  setOptions({
                    ...options,
                    dateOrder: v as ImportOptions["dateOrder"],
                  });
                  reset();
                }}
                options={[
                  { value: "dmy", label: "День / месяц / год" },
                  { value: "mdy", label: "Месяц / день / год" },
                ]}
              />
            </label>
            <label>
              Вес без указанной единицы
              <Select
                value={options.weightUnit}
                onChange={(v) => {
                  setOptions({
                    ...options,
                    weightUnit: v as ImportOptions["weightUnit"],
                  });
                  reset();
                }}
                options={[
                  { value: "kg", label: "Килограммы" },
                  { value: "lb", label: "Фунты → килограммы" },
                ]}
              />
            </label>
            <label>
              Дистанция без единицы
              <Select
                value={options.distanceUnit}
                onChange={(v) => {
                  setOptions({
                    ...options,
                    distanceUnit: v as ImportOptions["distanceUnit"],
                  });
                  reset();
                }}
                options={[
                  { value: "km", label: "Километры" },
                  { value: "m", label: "Метры → км" },
                  { value: "mi", label: "Мили → км" },
                ]}
              />
            </label>
          </>
        ) : null}
      </fieldset>}
      {!preview ? (
        <button
          className="button primary full-width"
          disabled={!text || busy}
          onClick={() => void review()}
        >
          {busy ? "Читаем и сопоставляем…" : "Показать предпросмотр"}
        </button>
      ) : null}
      {preview ? (
        <>
          <div className="import-summary">
            <div>
              <b>{preview.workouts.length}</b>
              <span>тренировок</span>
            </div>
            <div>
              <b>{preview.setCount}</b>
              <span>подходов</span>
            </div>
            <div>
              <b>{preview.exerciseNames.length}</b>
              <span>названий</span>
            </div>
          </div>
          {plan ? (
            <section className="restore-plan" aria-label="Что в копии">
              <h3>Что в копии</h3>
              <ul>
                <li>
                  <b>Тренировки: {plan.workouts.total}</b>
                  <span>{RestorePlan.words(plan.workouts)}</span>
                </li>
                {plan.routines.total ? (
                  <li>
                    <b>Программы: {plan.routines.total}</b>
                    <span>{RestorePlan.words(plan.routines)}</span>
                  </li>
                ) : null}
                {plan.customs.total ? (
                  <li>
                    <b>Свои упражнения: {plan.customs.total}</b>
                    <span>{RestorePlan.words(plan.customs)}</span>
                  </li>
                ) : null}
                {plan.favorites.total ? (
                  <li>
                    <b>Избранное: {plan.favorites.total}</b>
                    <span>{RestorePlan.words(plan.favorites)}</span>
                  </li>
                ) : null}
              </ul>
              {plan.nothing ? <p className="restore-nothing" role="status"><b>{plan.nothing}</b></p> : null}
            </section>
          ) : null}
          {preview.extras?.bodyweight && (
            <section
              className="backup-weight-preview"
              aria-label="Вес в резервной копии"
            >
              <h3>Взвешивания: {preview.extras.bodyweight.entries.length}</h3>
              <p className="tiny">
                {RestorePlan.words({ total: preview.extras.bodyweight.entries.length, ...weightPlan! })}
              </p>
              <p className="tiny">
                Цель из файла:{" "}
                {preview.extras.bodyweight.goal.targetWeightKg ?? "не задана"}
                {preview.extras.bodyweight.goal.targetWeightKg !== null
                  ? " кг"
                  : ""}
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={restoreWeight}
                  disabled={busy}
                  onChange={(e) => setRestoreWeight(e.target.checked)}
                />
                Восстановить вес и цель
              </label>
              {restoreWeight && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={replaceWeight}
                    disabled={busy}
                    onChange={(e) => setReplaceWeight(e.target.checked)}
                  />
                  При различиях использовать замеры и цель из файла
                </label>
              )}
              <p className="tiny">
                По умолчанию остаются твои замеры за совпадающие даты и уже
                заданная цель. Восстановленный вес синхронизируется с аккаунтом.
              </p>
              {JournalBackup.merge(
                journal.tracker.getEntries(),
                preview.extras.bodyweight.entries,
              ).conflictDates.length > 0 && (
                <details>
                  <summary>Даты с разными записями</summary>
                  <p className="tiny">
                    {JournalBackup.merge(
                      journal.tracker.getEntries(),
                      preview.extras.bodyweight.entries,
                    )
                      .conflictDates.slice(0, 20)
                      .join(", ")}
                  </p>
                </details>
              )}
            </section>
          )}
          <div className="import-sessions">
            {preview.workouts.slice(0, 5).map((w) => (
              <div key={w.sourceKey}>
                <span>{DateText.day(w.date)}</span>
                <b>{w.name}</b>
                <small>{w.exercises.length} упр.</small>
              </div>
            ))}
            {preview.workouts.length > 5 ? (
              <p className="tiny">И ещё {preview.workouts.length - 5} сессий</p>
            ) : null}
          </div>
          {preview.format !== "tyaga" ? (
            <>
              <p
                className="import-match-summary"
                role="status"
                data-matched={summary.matched}
                data-decide={summary.toDecide}
                data-own={summary.own}
              >
                <b>
                  Сопоставлено {summary.matched} из {summary.total} · нужно
                  решить {summary.toDecide}
                </b>
                {summary.own ? (
                  <small>
                    {" "}
                    Ещё {summary.own} останутся отдельными записями — в
                    каталоге похожего нет.
                  </small>
                ) : null}
              </p>
              {/* R06-REQ06: сколько своих упражнений создастся и «Принять близкие» — в самой сводке, без прокрутки. */}
              <div className="import-own-line" role="status">
                <span>
                  Будет создано своих упражнений: <b data-own-total={summary.toDecide + summary.own}>{summary.toDecide + summary.own}</b>
                </span>
                {relatedNames.length ? (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      setUserChoices({
                        ...userChoices,
                        ...Object.fromEntries(relatedNames.map((n) => [n, verdicts[n].candidates[0].id])),
                      })
                    }
                  >
                    Принять близкие движения ({relatedNames.length})
                  </button>
                ) : null}
              </div>
              {dropped.length ? (
                <p className="import-dropped tiny" role="status">
                  Доп. вес в файле у {dropped.length}{" "}
                  {dropped.length === 1 ? "упражнения" : "упражнений"} с «только
                  весом тела» ({dropped.slice(0, 3).map((d) => `${d.name} до ${d.kg} кг`).join(", ")}
                  {dropped.length > 3 ? "…" : ""}) не записывается; максимум
                  сохранён в заметке к упражнению.
                </p>
              ) : null}
              {needsTotal ? (
                <fieldset className="import-question" disabled={busy}>
                  <legend>Вес в файле — это общий вес штанги с грифом?</legend>
                  <label className="check-label">
                    <input
                      type="radio"
                      name="import-weight-total"
                      checked={weightTotal === "yes"}
                      onChange={() => setWeightTotal("yes")}
                    />
                    <span>
                      Да — записать как мои штанговые упражнения (тоннаж, 1ПМ,
                      общий ряд в «Силе»)
                    </span>
                  </label>
                  <label className="check-label">
                    <input
                      type="radio"
                      name="import-weight-total"
                      checked={weightTotal === "no"}
                      onChange={() => setWeightTotal("no")}
                    />
                    <span>
                      Нет или не знаю — сохранить числа буквально, отдельными
                      записями
                    </span>
                  </label>
                </fieldset>
              ) : null}
              {needsEach ? (
                <fieldset className="import-question" disabled={busy}>
                  <legend>Вес гантелей в файле — это вес одной гантели?</legend>
                  <label className="check-label">
                    <input
                      type="radio"
                      name="import-weight-each"
                      checked={weightEach === "yes"}
                      onChange={() => setWeightEach("yes")}
                    />
                    <span>Да — одной (так считает тоннаж каталог)</span>
                  </label>
                  <label className="check-label">
                    <input
                      type="radio"
                      name="import-weight-each"
                      checked={weightEach === "no"}
                      onChange={() => setWeightEach("no")}
                    />
                    <span>
                      Нет или не знаю — сохранить числа буквально, отдельными
                      записями
                    </span>
                  </label>
                </fieldset>
              ) : null}
              {summary.toDecide > 0 ? (
                <section
                  className="import-decide"
                  aria-label="Нужно решить"
                >
                  <h3>Нужно решить · {summary.toDecide}</h3>
                  <p className="tiny">
                    Точного совпадения в каталоге нет. Выбери похожее
                    упражнение или оставь отдельной записью — иначе оно станет
                    «Моим».
                  </p>
                  {autoKinds("ask").map((name) => (
                    <div className="import-mapping-row" key={name}>
                      <label>
                        <span>{name}</span>
                        <Select
                          searchable
                          value={choiceFor(name)}
                          disabled={busy}
                          onChange={(v) =>
                            setUserChoices({ ...userChoices, [name]: v })
                          }
                          options={[
                            {
                              value: "",
                              label: "Отдельная запись, вес буквально",
                            },
                            ...[
                              ...new Map(
                                [
                                  ...(verdicts[name]?.candidates ?? []),
                                  ...EXERCISES,
                                ].map((e) => [e.id, e]),
                              ).values(),
                            ].map((e) => ({
                              value: e.id,
                              label: e.source ? `${e.name} · база` : e.name,
                              search: [e.nameEn, ...(e.aliases ?? [])].join(
                                " ",
                              ),
                            })),
                          ]}
                        />
                      </label>
                      <small>
                        {verdicts[name]?.related ? "Близкое, но другое движение: " : "Похоже на "}«{verdicts[name]?.candidates[0]?.name}»
                        {verdicts[name]?.candidates.length > 1
                          ? ` и ещё ${verdicts[name].candidates.length - 1}`
                          : ""}
                      </small>
                    </div>
                  ))}
                </section>
              ) : null}
              {autoKinds("variant").length ? (
                <details className="import-variants">
                  <summary>
                    Близкие варианты · {autoKinds("variant").length}
                  </summary>
                  <ul>
                    {autoKinds("variant").map((name) => (
                      <li key={name}>
                        <span>{name}</span>
                        <b>{verdicts[name].exercise?.name}</b>
                      </li>
                    ))}
                  </ul>
                  <p className="tiny">
                    Это тот же вид движения с чуть другой техникой или
                    оборудованием. Если нужна отдельная запись, измени
                    сопоставление ниже.
                  </p>
                </details>
              ) : null}
              <ul className="import-recognized" aria-label="Что распознано">
                {preview.exerciseNames.map((name) => {
                  const chosen = choiceFor(name)
                    ? exerciseById(choiceFor(name))
                    : null;
                  return (
                    <li key={name}>
                      <span>{name}</span>
                      <b>
                        {chosen
                          ? chosen.name
                          : mismatch(name)
                            ? `отдельная запись: в каталоге ${types.get(name) === "reps" ? "упражнение на время, а в файле повторы" : "упражнение с повторами, а в файле время"}`
                            : "отдельная запись, вес буквально"}
                      </b>
                    </li>
                  );
                })}
              </ul>
              <details className="import-mapping">
                <summary>
                  Изменить сопоставления · {preview.exerciseNames.length}
                </summary>
                <div>
                  {preview.exerciseNames.map((name) => {
                    const current = choiceFor(name);
                    const candidate = current ? exerciseById(current) : null;
                    const first = suggestion(name);
                    const options = [
                      ...new Map(
                        [
                          ...(first ? [first] : []),
                          ...(matches[name] ?? []),
                          ...EXERCISES,
                        ].map((e) => [e.id, e]),
                      ).values(),
                    ];
                    return (
                      <div className="import-mapping-row" key={name}>
                        <label>
                          <span>{name}</span>
                          <Select
                            searchable
                            value={current}
                            disabled={busy}
                            onChange={(v) =>
                              setUserChoices({ ...userChoices, [name]: v })
                            }
                            options={[
                              {
                                value: "",
                                label: "Отдельная запись, вес буквально",
                              },
                              ...options.map((e) => ({
                                value: e.id,
                                label: e.source ? `${e.name} · база` : e.name,
                                search: [e.nameEn, ...(e.aliases ?? [])].join(
                                  " ",
                                ),
                              })),
                            ]}
                          />
                        </label>
                        {candidate &&
                        ["machine_stack", "assisted_bodyweight"].includes(
                          candidate.recording.loadMode,
                        ) ? (
                          <label>
                            Метка тренажёра
                            <input
                              disabled={busy}
                              maxLength={120}
                              value={machines[name] ?? ""}
                              onChange={(e) =>
                                setMachines({
                                  ...machines,
                                  [name]: e.target.value,
                                })
                              }
                              placeholder="Например: жим ногами у окна"
                            />
                          </label>
                        ) : null}
                        {candidate?.recording.laterality === "unilateral" ? (
                          <label>
                            Как записаны стороны
                            <Select
                              value={sides[name] ?? "both"}
                              disabled={busy}
                              onChange={(v) =>
                                setSides({
                                  ...sides,
                                  [name]: v as "both" | "left" | "right",
                                })
                              }
                              options={[
                                {
                                  value: "both",
                                  label: "Обе: число повторов на каждую",
                                },
                                { value: "left", label: "Только левая" },
                                { value: "right", label: "Только правая" },
                              ]}
                            />
                          </label>
                        ) : null}
                        <small>
                          {candidate
                            ? candidate.recording.loadMode === "per_implement"
                              ? "Вес — одной гантели. Проверь, что в файле так же."
                              : "Используем правило записи выбранного упражнения"
                            : first && verdicts[name]?.kind === "ask"
                              ? `Похоже на «${first.name}», но вес в файле может значить другое — выбери вручную, если уверен`
                              : "Вес сохранится буквально; в «Силе» это будет отдельный ряд"}
                        </small>
                      </div>
                    );
                  })}
                </div>
              </details>
              <label className="check-label import-rules">
                <input
                  type="checkbox"
                  checked={replaceImported}
                  disabled={busy}
                  onChange={(e) => setReplaceImported(e.target.checked)}
                />
                <span>
                  Заменить тренировки, уже импортированные из этого файла. Те,
                  что ты правил после импорта, не трогаем.
                </span>
              </label>
            </>
          ) : null}
          {preview.extras ? (
            <div className="import-backup-options">
              {preview.extras.profile && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={restoreProfile}
                    onChange={(e) => setRestoreProfile(e.target.checked)}
                  />
                  Восстановить профиль: {preview.extras.profile.displayName},{" "}
                  {preview.extras.profile.timeZone}
                </label>
              )}
              {preview.extras.routines.length +
                preview.extras.customExercises.length +
                preview.extras.favorites.length >
                0 && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={restoreExtras}
                    onChange={(e) => setRestoreExtras(e.target.checked)}
                  />
                  Перенести программы ({preview.extras.routines.length}), свои
                  упражнения ({preview.extras.customExercises.length}) и
                  избранное ({preview.extras.favorites.length})
                </label>
              )}
              {preview.extras.settings || preview.extras.theme ? (
                <label className="check-label">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={restoreSettings}
                    onChange={(e) => setRestoreSettings(e.target.checked)}
                  />
                  Восстановить ориентиры и настройки из файла
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="import-notice">
            <ShieldCheck size={20} />
            <div>
              <p>
                {restoring || preview.format === "tyaga"
                  ? "Повторное восстановление не создаёт дублей: тренировки, которые уже есть, пропускаются. Если соединение прервётся, открой этот файл ещё раз."
                  : "Повторный импорт не создаёт дублей: те же сессии заменяются или пропускаются. Если соединение прервётся, открой этот файл ещё раз."}
              </p>
              {preview.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          </div>
          {progress ? (
            <div className="import-progress" role="status">
              <span className="loader" />
              <div>
                <b>
                  {progress.phase} · {progress.done} / {progress.total}
                </b>
                <p>
                  Добавлено {progress.imported}, пропущено {progress.skipped}
                </p>
              </div>
            </div>
          ) : null}
          {preview.format !== "tyaga" ? (
            <p className="import-own-footer tiny">Будет создано своих упражнений: {summary.toDecide + summary.own}</p>
          ) : null}
          {laidNotice ? (
            <p className="restore-laid-notice" role="status">
              {laidNotice}
            </p>
          ) : null}
          <button
            className="button primary full-width"
            disabled={busy}
            onClick={() => void run()}
          >
            <Import size={18} />
            {busy ? "Импортируем…" : "Импортировать"}
          </button>
        </>
      ) : null}
      {error ? (
        <div className="error-banner" role="alert">
          <p>{error}</p>
          {progress?.imported ? (
            <p>
              Уже сохранено {progress.imported} сессий. Повторный запуск
              продолжит перенос без дублей.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
