import { useState } from "react";
import type { Exercise, Equipment, RecordingSpec } from "../lib/types";
import { MUSCLES, EXERCISES } from "../lib/model";
import { productService } from "../services/ProductService";
import Select from "./Select";

export default function PersonalExerciseEditor({
  exercise,
  onSaved,
  onDeleted,
}: {
  exercise?: Exercise;
  onSaved: (e: Exercise) => void;
  onDeleted?: (id: string) => void;
}) {
  const [name, setName] = useState(exercise?.name ?? "");
  const [aliases, setAliases] = useState(exercise?.aliases?.join("; ") ?? "");
  const [notes, setNotes] = useState(exercise?.tip ?? "");
  const [equipment, setEquipment] = useState<Equipment>(
    exercise?.equipment ?? "gym",
  );
  const [type, setType] = useState<"reps" | "duration">(
    exercise?.recording.type ?? "reps",
  );
  const [loadMode, setLoadMode] = useState<RecordingSpec["loadMode"]>(
    exercise?.recording.loadMode ?? "total_external",
  );
  const [count, setCount] = useState(exercise?.recording.implementCount ?? 1);
  const [unilateral, setUnilateral] = useState(
    exercise?.recording.laterality === "unilateral",
  );
  const [zones, setZones] = useState(exercise?.custom?.declaredZones ?? []);
  const [basedOn, setBasedOn] = useState(exercise?.custom?.basedOnExerciseId ?? "");
  const [familyId] = useState(
    exercise?.custom?.familyId ?? crypto.randomUUID(),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await productService.saveExercise({
        familyId,
        name,
        nameEn: exercise?.nameEn ?? "",
        aliases: aliases
          .split(/[;\n]/)
          .map((a) => a.trim())
          .filter(Boolean),
        notes,
        equipment,
        declaredZones: zones,
          basedOnExerciseId: type === "reps" ? basedOn : "",
        recording: {
          type,
          loadMode,
          implementCount: loadMode === "per_implement" ? count : 1,
          laterality: unilateral ? "unilateral" : "bilateral",
        },
      });
      onSaved(result.exercise);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="product-form" onSubmit={save}>
      <fieldset disabled={busy}>
        <label>
          Название упражнения
          <input
            required
            maxLength={120}
            value={name}
            placeholder="Например: тяга моего тренажёра"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Алиасы — через точку с запятой
          <textarea
            rows={2}
            maxLength={2400}
            value={aliases}
            placeholder="Другое название; English name; привычное сокращение"
            onChange={(e) => setAliases(e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Что записываем
            <Select
              value={type}
              onChange={(v) => setType(v as typeof type)}
              options={[
                { value: "reps", label: "Повторения" },
                { value: "duration", label: "Время в секундах" },
              ]}
            />
          </label>
          <label>
            Оборудование
            <Select
              value={equipment}
              onChange={(v) => setEquipment(v as Equipment)}
              options={[
                { value: "gym", label: "Оборудование зала" },
                { value: "dumbbells", label: "Гантели" },
                { value: "bodyweight", label: "Без оборудования" },
              ]}
            />
          </label>
        </div>
        <label>
          Что означает введённый вес
          <Select
            value={loadMode}
            onChange={(v) => setLoadMode(v as RecordingSpec["loadMode"])}
            options={[
              { value: "total_external", label: "Общий вес: гриф и блины" },
              { value: "per_implement", label: "Вес одной гантели / снаряда" },
              { value: "machine_stack", label: "Число на стеке тренажёра" },
              { value: "bodyweight", label: "Без внешнего веса" },
              { value: "added_bodyweight", label: "Дополнительный вес к весу тела" },
              { value: "assisted_bodyweight", label: "Помощь тренажёра в кг" },
              { value: "legacy_unspecified", label: "Правило неизвестно: сохранить как введено" },
            ]}
          />
        </label>
        {loadMode === "per_implement" ? (
          <label>
            Количество снарядов
            <Select
              value={String(count)}
              onChange={(v) => setCount(Number(v) as 1 | 2)}
              options={[
                { value: "1", label: "Один" },
                { value: "2", label: "Два" },
              ]}
            />
          </label>
        ) : null}
        <label className="check-label">
          <input
            type="checkbox"
            checked={unilateral}
            onChange={(e) => setUnilateral(e.target.checked)}
          />
          Одностороннее: повторы на каждую сторону
        </label>
        <div>
          {type === "reps" && <label>Базовое движение для карты мышц
            <Select value={basedOn} onChange={setBasedOn} options={[
              { value: "", label: "Без разметки — только журнал" },
              ...EXERCISES.map(e => ({ value: e.id, label: e.name })),
            ]} /><small className="tiny">Выбирай, если движение совпадает. Для жима от груди в своём тренажёре — жим лёжа; для тяги сидя — горизонтальная тяга. Это твоя разметка, её можно изменить отдельной версией.</small>
          </label>}
          <p className="field-caption">
            Группы мышц для поиска — твоя разметка
          </p>
          <div className="muscle-chips">
            {MUSCLES.map((m) => (
              <button
                type="button"
                className={zones.includes(m.id) ? "active" : ""}
                aria-pressed={zones.includes(m.id)}
                key={m.id}
                onClick={() =>
                  setZones((z) =>
                    z.includes(m.id)
                      ? z.filter((x) => x !== m.id)
                      : [...z, m.id],
                  )
                }
              >
                {m.short}
              </button>
            ))}
          </div>
        </div>
        <label>
          Техника и заметки
          <textarea
            rows={3}
            maxLength={6000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Хват, положение сиденья, амплитуда, как считаешь повторы…"
          />
        </label>
        <p className="tiny">
          Этот вариант сохраняется в твоём аккаунте. Мышцы помогают искать
          упражнение. Если выбрано базовое движение, подходы участвуют в карте
          с пометкой пользовательской разметки. Расчётный 1ПМ отключён.
        </p>
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
        <button className="button primary full-width" type="submit">
          {busy ? "Сохраняем…" : "Сохранить упражнение"}
        </button>
        {exercise && onDeleted ? (
          <button
            className="button secondary danger-text full-width"
            type="button"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await productService.deleteExercise(exercise.id);
                onDeleted(exercise.id);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Ошибка удаления");
              } finally {
                setBusy(false);
              }
            }}
          >
            Убрать из личного каталога
          </button>
        ) : null}
      </fieldset>
    </form>
  );
}
