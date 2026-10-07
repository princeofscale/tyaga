import { ANATOMICAL_MUSCLES, evidenceById, type Exercise } from "../lib/model";
const ROLE_NAMES = {
  primary: "Движители",
  assistant: "Помогающие мышцы",
  stabilizer: "Стабилизаторы",
} as const;
const KIND_NAMES = {
  anatomy: "Анатомия",
  emg: "ЭМГ",
  longitudinal: "Длительное исследование",
  methodology: "Методология",
} as const;
const VERIFICATION = {
  "full-text": "проверен полный текст",
  abstract: "проверен абстракт",
  metadata: "проверены метаданные",
} as const;
export default function ExerciseInfo({
  exercise: e,
  onAdd,
  disabled,
}: {
  exercise: Exercise;
  onAdd: () => void;
  disabled: boolean;
}) {
  const sources = [
    ...new Set([
      ...e.muscles.flatMap((m) => m.sources),
      ...e.evidence,
      "emg-limits",
    ]),
  ]
    .map((id) => evidenceById(id))
    .filter((x) => !!x);
  return (
    <div className="exercise-technique">
      <span className="feature-tag">
        Вариант упражнения · каталог {e.catalogRevision}
      </span>
      <p>{e.variant}</p>
      <p>{e.tip}</p>
      {e.jointActions.length ? (
        <p className="tiny">Движения: {e.jointActions.join(" · ")}.</p>
      ) : null}
      {(["primary", "assistant", "stabilizer"] as const).map((role) => {
        const muscles = e.muscles.filter((m) => m.role === role);
        return muscles.length ? (
          <section className="role-section" key={role}>
            <h3>{ROLE_NAMES[role]}</h3>
            <div className="anatomy-list">
              {muscles.map((m) => {
                const a = ANATOMICAL_MUSCLES.find((a) => a.id === m.muscleId)!;
                return (
                  <div key={m.muscleId}>
                    <b>{a.name}</b>
                    <small>{a.latin}</small>
                    <span>
                      По анатомии ·{" "}
                      {m.confidence === "high" ? "высокая" : "умеренная"}{" "}
                      уверенность в роли
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null;
      })}
      <p className="catalog-limit">{e.limitations}</p>
      <details className="evidence-details">
        <summary>Источники и границы данных</summary>
        <p className="tiny">
          Разметка составлена с помощью ИИ и сверена с указанными источниками.
          Это редакционная модель, без независимой сертификации специалистом.
          Список описывает основные роли и не исчерпывает все работающие мышцы.
        </p>
        {sources.map((s) => (
          <article key={s.id}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>
            <small>
              {KIND_NAMES[s.kind]} · {VERIFICATION[s.verification]}
            </small>
            <p>{s.claim}</p>
            <p className="tiny">{s.limitation}</p>
          </article>
        ))}
        <p className="tiny">
          Проверка источников: 7 октября 2026. Собственные метаданные Тяги —
          MIT. Тексты и медиа источников не включены в приложение.
        </p>
      </details>
      <button
        className="button primary full-width"
        onClick={onAdd}
        disabled={disabled}
      >
        Добавить в тренировку
      </button>
    </div>
  );
}
