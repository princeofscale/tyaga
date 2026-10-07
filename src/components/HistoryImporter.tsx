import { useState } from "react";
import { Check, FileUp, Import, ShieldCheck } from "lucide-react";
import {
  WorkoutImport,
  type ImportFormat,
  type ImportPreview,
  type ImportOptions,
} from "../domain/WorkoutImport";
import { importService } from "../services/ImportService";
import { EXERCISES, exerciseById, localDate } from "../lib/model";
import type { Exercise, Settings } from "../lib/types";

type Props = {
  timeZone: string;
  onComplete: (result: {
    imported: number;
    skipped: number;
    settings?: Settings;
  }) => Promise<void>;
  onBusy: (busy: boolean) => void;
};
export default function HistoryImporter({
  timeZone,
  onComplete,
  onBusy,
}: Props) {
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
  const [choices, setChoices] = useState<Record<string, string>>({}),
    [machines, setMachines] = useState<Record<string, string>>({}),
    [sides, setSides] = useState<Record<string, "both" | "left" | "right">>({});
  const [applyRules, setApplyRules] = useState(false),
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
      const resolved =
        format === "tyaga"
          ? {}
          : await importService.resolve(data.exerciseNames);
      setMatches(resolved);
      setChoices(
        Object.fromEntries(
          data.exerciseNames.map((name) => [
            name,
            resolved[name]?.[0]?.id ?? "",
          ]),
        ),
      );
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать экспорт");
    } finally {
      markBusy(false);
    }
  }
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
            const chosen = choices[e.sourceName]
              ? exerciseById(choices[e.sourceName])
              : undefined;
            if (preview.format === "tyaga") return e;
            if (
              applyRules &&
              chosen &&
              (chosen.recording.type ?? "reps") === e.type
            ) {
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
            return { ...e, displayName: chosen?.name ?? e.displayName };
          }),
        })),
      };
      const result = await importService.import(prepared, setProgress);
      if (restoreExtras && prepared.extras)
        await importService.restoreExtras(prepared, result.idMap, (phase) =>
          setProgress((p) => ({ ...p!, phase })),
        );
      await onComplete({
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
          <select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as ImportFormat);
              reset();
            }}
          >
            <option value="strong">Strong CSV</option>
            <option value="hevy">Hevy CSV</option>
            <option value="fitnotes">FitNotes CSV</option>
            <option value="tyaga">Тяга JSON</option>
          </select>
        </label>
        {format !== "tyaga" ? (
          <>
            <label>
              Даты с цифрами
              <select
                value={options.dateOrder}
                onChange={(e) => {
                  setOptions({
                    ...options,
                    dateOrder: e.target.value as ImportOptions["dateOrder"],
                  });
                  reset();
                }}
              >
                <option value="dmy">День / месяц / год</option>
                <option value="mdy">Месяц / день / год</option>
              </select>
            </label>
            <label>
              Вес без указанной единицы
              <select
                value={options.weightUnit}
                onChange={(e) => {
                  setOptions({
                    ...options,
                    weightUnit: e.target.value as ImportOptions["weightUnit"],
                  });
                  reset();
                }}
              >
                <option value="kg">Килограммы</option>
                <option value="lb">Фунты → килограммы</option>
              </select>
            </label>
            <label>
              Дистанция без единицы
              <select
                value={options.distanceUnit}
                onChange={(e) => {
                  setOptions({
                    ...options,
                    distanceUnit: e.target
                      .value as ImportOptions["distanceUnit"],
                  });
                  reset();
                }}
              >
                <option value="km">Километры</option>
                <option value="m">Метры → км</option>
                <option value="mi">Мили → км</option>
              </select>
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
              <label className="check-label import-rules">
                <input
                  type="checkbox"
                  checked={applyRules}
                  disabled={busy}
                  onChange={(e) => setApplyRules(e.target.checked)}
                />
                <span>
                  Применить правила веса выбранных вариантов библиотеки.
                  Подтверждаю, что число в файле означает тот же вес и те же
                  стороны.
                </span>
              </label>
              <details className="import-mapping">
                <summary>
                  Сопоставления упражнений · {preview.exerciseNames.length}
                </summary>
                <div>
                  {preview.exerciseNames.map((name) => {
                    const candidate = choices[name]
                      ? exerciseById(choices[name])
                      : null;
                    const options = [
                      ...new Map(
                        [...(matches[name] ?? []), ...EXERCISES].map((e) => [
                          e.id,
                          e,
                        ]),
                      ).values(),
                    ];
                    return (
                      <div className="import-mapping-row" key={name}>
                        <label>
                          <span>{name}</span>
                          <select
                            value={choices[name] ?? ""}
                            disabled={busy}
                            onChange={(e) =>
                              setChoices({ ...choices, [name]: e.target.value })
                            }
                          >
                            <option value="">
                              Своя запись с неизвестным правилом
                            </option>
                            {options.map((e) => (
                              <option value={e.id} key={e.id}>
                                {e.name}
                                {e.source ? " · wger" : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        {applyRules &&
                        candidate &&
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
                        {applyRules &&
                        candidate?.recording.laterality === "unilateral" ? (
                          <label>
                            Как записаны стороны
                            <select
                              value={sides[name] ?? "both"}
                              disabled={busy}
                              onChange={(e) =>
                                setSides({
                                  ...sides,
                                  [name]: e.target.value as
                                    "both" | "left" | "right",
                                })
                              }
                            >
                              <option value="both">
                                Обe: число повторов на каждую
                              </option>
                              <option value="left">Только левая</option>
                              <option value="right">Только правая</option>
                            </select>
                          </label>
                        ) : null}
                        <small>
                          {applyRules && candidate
                            ? "Используем выбранное правило записи"
                            : "Русское название, алиас оригинала; вес сохранится буквально"}
                        </small>
                      </div>
                    );
                  })}
                </div>
              </details>
            </>
          ) : null}
          {preview.extras ? (
            <div className="import-backup-options">
              <label className="check-label">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={restoreExtras}
                  onChange={(e) => setRestoreExtras(e.target.checked)}
                />
                Перенести программы ({preview.extras.routines.length}), свои
                упражнения ({preview.extras.customExercises.length}) и избранное
                ({preview.extras.favorites.length})
              </label>
              {preview.extras.settings ? (
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
                Повторный импорт пропускает те же сессии. Если соединение
                прервётся, открой этот файл ещё раз.
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
