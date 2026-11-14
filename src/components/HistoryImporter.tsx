import { useBodyweight } from "../state/BodyweightContext";
import { JournalBackup, type ProfileBackup } from "../domain/JournalBackup";
import type { ThemeId } from "../lib/theme";
import { useState } from "react";
import { Check, FileUp, Import, ShieldCheck } from "lucide-react";
import {
  WorkoutImport,
  type ImportFormat,
  type ImportPreview,
  type ImportOptions,
} from "../domain/WorkoutImport";
import { ImportMapping } from "../domain/ImportMapping";
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
};
export default function HistoryImporter({
  timeZone,
  onComplete,
  onBusy,
}: Props) {
  const journal = useBodyweight();
  const [restoreProfile, setRestoreProfile] = useState(false);
  const [restoreWeight, setRestoreWeight] = useState(true),
    [replaceWeight, setReplaceWeight] = useState(false);
  const [text, setText] = useState(""),
    [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<ImportFormat>("strong");
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
  async function file(file: File | undefined) {
    reset();
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Выбери файл не больше 10 МБ.");
      return;
    }
    try {
      const content = await file.text();
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
  const suggestion = (name: string) =>
    ImportMapping.suggestForImport(name) ?? matches[name]?.[0] ?? null;
  const choiceFor = (name: string) =>
    name in userChoices
      ? userChoices[name]
      : weightTotal === "yes" &&
          ImportMapping.appliesByDefault(ImportMapping.suggestForImport(name))
        ? ImportMapping.suggestForImport(name)!.id
        : "";
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
      const prepared: ImportPreview = {
        ...preview,
        workouts: preview.workouts.map((w) => ({
          ...w,
          exercises: w.exercises.map((e) => {
            const chosen = choiceFor(e.sourceName)
              ? exerciseById(choiceFor(e.sourceName))
              : undefined;
            if (preview.format === "tyaga") return e;
            if (chosen && (chosen.recording.type ?? "reps") === e.type) {
              if (
                ["machine_stack", "assisted_bodyweight"].includes(
                  chosen.recording.loadMode,
                ) &&
                !machines[e.sourceName]?.trim()
              )
                throw new Error(
                  `Укажи тренажёр для «${e.sourceName}» или выбери буквальную запись.`,
                );
              return {
                ...e,
                exerciseId: chosen.id,
                displayName: chosen.name,
                catalogRevision: chosen.catalogRevision,
                equipmentNote: machines[e.sourceName],
                ...(chosen.recording.laterality === "unilateral"
                  ? { performedSides: sides[e.sourceName] ?? ("both" as const) }
                  : {}),
                sets: e.sets.map((s) => ({
                  ...s,
                  ...(chosen.recording.loadMode === "assisted_bodyweight"
                    ? { assistanceKg: s.weight, weight: 0 }
                    : {}),
                })),
              };
            }
            return e;
          }),
        })),
      };
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Импорт остановлен");
    } finally {
      markBusy(false);
    }
  }
  return (
    <div className="history-importer">
      <p className="modal-intro">
        Перенеси историю из Strong, Hevy, FitNotes или JSON Тяги. Сначала
        проверь предпросмотр; существующие тренировки останутся.
      </p>
      <label className="import-file">
        <FileUp size={30} />
        <b>{fileName || "Выбрать файл экспорта"}</b>
        <span>CSV или JSON · до 10 МБ</span>
        <input
          aria-label="Файл истории тренировок"
          type="file"
          accept=".csv,.json,text/csv,application/json"
          disabled={busy}
          onChange={(e) => void file(e.target.files?.[0])}
        />
      </label>
      <fieldset disabled={busy} className="import-options">
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
      </fieldset>
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
          {preview.extras?.bodyweight && (
            <section
              className="backup-weight-preview"
              aria-label="Вес в резервной копии"
            >
              <h3>Взвешивания: {preview.extras.bodyweight.entries.length}</h3>
              <p className="tiny">
                Новых:{" "}
                {
                  JournalBackup.merge(
                    journal.tracker.getEntries(),
                    preview.extras.bodyweight.entries,
                  ).added
                }{" "}
                · Совпадают:{" "}
                {
                  JournalBackup.merge(
                    journal.tracker.getEntries(),
                    preview.extras.bodyweight.entries,
                  ).same
                }{" "}
                · Различаются:{" "}
                {
                  JournalBackup.merge(
                    journal.tracker.getEntries(),
                    preview.extras.bodyweight.entries,
                  ).conflictDates.length
                }
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
                <span>{w.date}</span>
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
              {ImportMapping.needsWeightQuestion(preview.exerciseNames) ? (
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
                            : first && !ImportMapping.appliesByDefault(first)
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
                Повторный импорт не создаёт дублей: те же сессии заменяются или
                пропускаются. Если соединение прервётся, открой этот файл ещё
                раз.
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
