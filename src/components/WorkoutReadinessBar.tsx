type ReadinessLevel = "normal" | "worse" | "hard";

type Props = {
  readiness: ReadinessLevel | null;
  appliedReadiness: "worse" | "hard" | null;
  saving: boolean;
  onSelect: (level: ReadinessLevel) => void;
  onApply: (level: "worse" | "hard") => void;
};

const OPTIONS: readonly { id: ReadinessLevel; label: string }[] = [
  { id: "normal", label: "Нормально" },
  { id: "worse", label: "Хуже обычного" },
  { id: "hard", label: "Тяжело сегодня" },
];

/** Панель самочувствия перед тренировкой с живыми кнопками авторегуляции (−5 % / −10 % и −1 подход). */
export default function WorkoutReadinessBar({
  readiness,
  appliedReadiness,
  saving,
  onSelect,
  onApply,
}: Props) {
  return (
    <div className="workout-readiness-bar" role="group" aria-label="Самочувствие перед тренировкой">
      <span className="readiness-label">Самочувствие</span>
      <div className="readiness-chips">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`readiness-chip${readiness === opt.id ? " active" : ""}${opt.id !== "normal" ? " is-caution" : ""}`}
            aria-pressed={readiness === opt.id}
            onClick={() => onSelect(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {readiness === "worse" || readiness === "hard" ? (
        <div className="readiness-hint" role="status">
          <p>
            {readiness === "worse"
              ? "База −5 %, подсобка −2,5 %, RIR 2–3 — сохрани технику без гонки за рекордом."
              : "Щадящий режим: база −10 %, подсобка −5 %, RIR 3 и −1 подход на многоподходных движениях."}
          </p>
          {appliedReadiness ? (
            <span className="readiness-applied-pill">
              {appliedReadiness === "worse" ? "Применено: база −5 %, подсобка −2,5 %" : "Применено: база −10 %, подсобка −5 % и −1 подход"}
            </span>
          ) : (
            <button
              type="button"
              className="button secondary readiness-apply-btn"
              disabled={saving}
              onClick={() => onApply(readiness)}
            >
              {readiness === "worse"
                ? "Смягчить на сегодня (−5 % / −2,5 %)"
                : "Щадящий режим (−10 % / −5 % и −1 подход)"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
