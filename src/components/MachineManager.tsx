import { useState } from "react";
import { MachineRegistry } from "../domain/MachineRegistry";
import type { MachineInstance } from "../lib/types";
import Select from "./Select";
export default function MachineManager({
  machines,
  onSave,
  onArchive,
}: {
  machines: MachineInstance[];
  onSave: (machine: MachineInstance) => Promise<void>;
  onArchive: (machine: MachineInstance) => Promise<void>;
}) {
  const [draft, setDraft] = useState<MachineInstance>(() =>
    MachineRegistry.create(),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [aliases, setAliases] = useState("");
  const [search, setSearch] = useState("");
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      setDraft(MachineRegistry.create());
      setAliases("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось сохранить тренажёр",
      );
    } finally {
      setBusy(false);
    }
  };
  const knownModels = [
    ...new Map(machines.map((m) => [m.model.id, m.model])).values(),
  ];
  const modelLocked =
    draft.revision > 0 || knownModels.some((m) => m.id === draft.model.id);
  return (
    <div className="machine-manager">
      <p>
        Выбирай конкретную станцию для сравнения весов. Название и заметки можно
        менять; ID и история сравнения сохраняются.
      </p>
      <label>
        Найти тренажёр
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <div className="machine-list">
        {MachineRegistry.search(machines, search).map((machine) => (
          <div key={machine.id}>
            <button
              className="text-button"
              onClick={() => {
                setDraft(structuredClone(machine));
                setAliases(machine.aliases.join(", "));
              }}
            >
              {machine.nickname} · {machine.gym || "Зал не указан"} ·{" "}
              {machine.model.manufacturer} {machine.model.model}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void run(() => onArchive(machine))}
            >
              Убрать из списка: {machine.nickname}
            </button>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            onSave(
              MachineRegistry.parse({
                ...draft,
                aliases: aliases
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }),
            ),
          );
        }}
      >
        <h3>{draft.revision ? "Изменить станцию" : "Добавить тренажёр"}</h3>
        <div className="execution-grid">
          <label>
            Название станции
            <input
              aria-label="Название станции"
              required
              maxLength={120}
              value={draft.nickname}
              onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}
            />
          </label>
          <label>
            Зал
            <input
              aria-label="Зал тренажёра"
              maxLength={120}
              value={draft.gym}
              onChange={(e) => setDraft({ ...draft, gym: e.target.value })}
            />
          </label>
          <label>
            Номер станции
            <input
              maxLength={80}
              value={draft.stationId ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, stationId: e.target.value })
              }
            />
          </label>
          <label>
            Другие названия
            <input
              aria-label="Другие названия тренажёра"
              maxLength={1200}
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
            />
          </label>
          {draft.revision === 0 && (
            <label>
              Модель из списка
              <Select
                value={
                  knownModels.some((m) => m.id === draft.model.id)
                    ? draft.model.id
                    : ""
                }
                onChange={(id) =>
                  setDraft({
                    ...draft,
                    model:
                      knownModels.find((m) => m.id === id) ??
                      MachineRegistry.create().model,
                  })
                }
                options={[
                  { value: "", label: "Новая модель" },
                  ...knownModels.map((m) => ({
                    value: m.id,
                    label: `${m.manufacturer} ${m.model}`,
                  })),
                ]}
              />
            </label>
          )}
          <label>
            Производитель
            <input
              aria-label="Производитель тренажёра"
              disabled={modelLocked}
              maxLength={120}
              value={draft.model.manufacturer}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  model: { ...draft.model, manufacturer: e.target.value },
                })
              }
            />
          </label>
          <label>
            Модель
            <input
              aria-label="Модель тренажёра"
              required
              disabled={modelLocked}
              maxLength={120}
              value={draft.model.model}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  model: { ...draft.model, model: e.target.value },
                })
              }
            />
          </label>
          <label>
            Механизм
            <Select
              disabled={modelLocked}
              value={draft.model.mechanism}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  model: {
                    ...draft.model,
                    mechanism: v as MachineInstance["model"]["mechanism"],
                  },
                })
              }
              options={[
                { value: "selectorized", label: "Весовой стек" },
                { value: "plate_loaded", label: "Нагружаемый блинами" },
                { value: "cable", label: "Блок / трос" },
                { value: "lever", label: "Рычажный" },
                { value: "smith", label: "Смит" },
                { value: "other", label: "Другой" },
              ]}
            />
          </label>
          <label>
            Правило веса
            <Select
              disabled={modelLocked}
              value={draft.model.loadSemantics}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  model: {
                    ...draft.model,
                    loadSemantics:
                      v as MachineInstance["model"]["loadSemantics"],
                  },
                })
              }
              options={[
                { value: "stack_marking", label: "Значение на стеке" },
                { value: "plates_added", label: "Добавленные блины" },
                { value: "total_external", label: "Общий внешний вес" },
              ]}
            />
          </label>
          {(["stackRatio", "pulleyRatio"] as const).map((key) => (
            <label key={key}>
              {key === "stackRatio"
                ? "Передаточное отношение стека"
                : "Отношение блоков"}
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                value={draft.calibration?.[key] ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    calibration: {
                      ...draft.calibration,
                      [key]:
                        e.target.value === ""
                          ? undefined
                          : Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <p className="tiny">
          Передаточные отношения — справочные данные. Приложение не
          пересчитывает по ним мышечную силу или общий тоннаж.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setDraft(MachineRegistry.create());
              setAliases("");
            }}
          >
            Новая станция
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить тренажёр"}
          </button>
        </div>
      </form>
    </div>
  );
}
