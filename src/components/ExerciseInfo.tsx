import { ANATOMICAL_MUSCLES, evidenceById, type Exercise } from "../lib/model";
import BodyMap from "./BodyMap";
import { ExternalLink, Globe2 } from "lucide-react";
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
      <div className="exercise-atlas">
        <BodyMap
          loads={[]}
          selected={null}
          onSelect={() => {}}
          exercise={e}
          compact
        />
        <p>
          {e.source
            ? "Зоны мышц по данным wger"
            : "Основные роли в выбранном варианте"}{" "}
          · условный атлас
        </p>
      </div>
      <span className="feature-tag">
        {e.source
          ? "WGER · " + e.source.record.language.toUpperCase()
          : `Вариант упражнения · каталог ${e.catalogRevision}`}
      </span>
      <p>{e.variant}</p>
      <p className="exercise-instructions">{e.tip}</p>
      {e.aliases?.length ? (
        <details className="exercise-aliases">
          <summary>Другие названия и алиасы</summary>
          <p>{e.aliases.join(" · ")}</p>
        </details>
      ) : null}
      {e.source ? (
        <section className="wger-details">
          <div className="wger-equipment">
            {e.source.record.equipment.map((item) => (
              <span key={item.id}>{item.name}</span>
            ))}
          </div>
          {(["muscles", "secondaryMuscles"] as const).map((key) =>
            e.source!.record[key].length ? (
              <div className="role-section" key={key}>
                <h3>
                  {key === "muscles"
                    ? "Основные мышцы по wger"
                    : "Помогающие мышцы по wger"}
                </h3>
                <div className="wger-muscle-tags">
                  {e.source!.record[key].map((m) => (
                    <span key={m.id}>{m.name}</span>
                  ))}
                </div>
              </div>
            ) : null,
          )}
          <details className="wger-attribution">
            <summary>
              <Globe2 size={16} />
              Источник и лицензии
            </summary>
            <p>
              Снимок от{" "}
              {new Date(e.source.importedAt).toLocaleDateString("ru-RU")}.
              {e.source.record.localization
                ? "Русская адаптация Тяги. Названия и алиасы составлены с помощью ИИ; описание — машинный перевод оригинала. Техника требует проверки."
                : "Описание очищено от HTML, при необходимости сокращено."}{" "}
              Медиа не импортировались.
            </p>
            {e.source.record.localization ? (
              <details>
                <summary>Оригинальное описание</summary>
                <p>
                  {e.source.record.localization.sourceInstructions.replace(
                    /\\n/g,
                    "\n",
                  )}
                </p>
              </details>
            ) : null}
            {e.source.record.attributions.map((a, i) => (
              <article key={i}>
                <b>{a.title}</b>
                <p>
                  {a.authors.length
                    ? a.authors.join(", ")
                    : "Автор не указан источником"}
                </p>
                <div>
                  <a href={a.sourceUrl} target="_blank" rel="noreferrer">
                    Оригинал <ExternalLink size={13} />
                  </a>
                  <a href={a.licenseUrl} target="_blank" rel="noreferrer">
                    {a.license}
                  </a>
                </div>
              </article>
            ))}
          </details>
        </section>
      ) : null}
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
      {!e.source ? (
        <details className="evidence-details">
          <summary>Источники и границы данных</summary>
          <p className="tiny">
            Разметка составлена с помощью ИИ и сверена с указанными источниками.
            Это редакционная модель, без независимой сертификации специалистом.
            Список описывает основные роли и не исчерпывает все работающие
            мышцы.
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
      ) : null}
      <button
        className="button primary full-width"
        onClick={onAdd}
        disabled={disabled || e.source?.record.loggable === false}
      >
        Добавить в тренировку
      </button>
    </div>
  );
}
