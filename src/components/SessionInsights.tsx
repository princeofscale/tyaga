import { useState } from "react";
import { Flame, Layers3, CheckCircle2, Trophy, Share2, Check, Sparkles, Camera } from "lucide-react";
import { SessionReport } from "../domain/SessionReport";
import { fmt, type Workout, type Settings } from "../lib/model";
import type { AccountProfile } from "../lib/account";
import Modal from "./Modal";
import { ShareStoryCardModal } from "./ShareStoryCardModal";

export default function SessionInsights({
  workout,
  settings,
  account,
}: {
  workout: Workout;
  settings: Settings;
  account?: AccountProfile;
}) {
  const [copied, setCopied] = useState(false);
  const [showStoryModal, setShowStoryModal] = useState(false);
  const report = new SessionReport(workout, settings), sets = report.sets, volume = report.volume;

  const shareSummary = async () => {
    const text = [
      `🏋️‍♂️ Тренировка «${workout.name}» в Тяге:`,
      `⏱️ Время: ${workout.duration} мин`,
      `⚡ Внешний тоннаж: ${fmt(volume.all.total)} кг (рабочий: ${fmt(volume.working.total)} кг)`,
      `📊 Подходы: ${sets.working} рабочих · ${sets.warmup} разминка`,
      report.muscles.length ? `💪 Зоны: ${report.muscles.map((m) => m.short).join(" · ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      if (navigator.share) {
        await navigator.share({ title: `Тренировка ${workout.name}`, text });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // sharing dismissed
    }
  };

  return (
    <section className="session-insights" aria-label="Итоги тренировки">
      <div className="celebration-hero">
        <div className="celebration-trophy-badge">
          <Trophy size={26} className="trophy-icon" />
          <Sparkles size={16} className="sparkle-decor-1" />
          <Sparkles size={14} className="sparkle-decor-2" />
        </div>
        <div className="celebration-hero-copy">
          <div className="celebration-tag">ТРЕНИРОВКА ЗАВЕРШЕНА</div>
          <h3>Твоя работа за тренировку</h3>
          <p>Разминка тоже остаётся в журнале и общем объёме.</p>
        </div>
        <div className="celebration-actions-group">
          <button
            type="button"
            className="story-card-trigger-btn"
            onClick={() => setShowStoryModal(true)}
            title="Создать брендовую картинку тренировки для сторис или Telegram"
          >
            <Camera size={15} />
            <span>Карточка для сторис</span>
          </button>
          <button
            type="button"
            className={`share-summary-btn ${copied ? "copied" : ""}`}
            onClick={shareSummary}
            title="Поделиться результатом тренировки текстом"
          >
            {copied ? <Check size={15} /> : <Share2 size={15} />}
            <span>{copied ? "Скопировано!" : "Текст"}</span>
          </button>
        </div>
      </div>

      {showStoryModal && (
        <Modal
          title="Карточка для сторис"
          onClose={() => setShowStoryModal(false)}
        >
          <ShareStoryCardModal
            workout={workout}
            account={
              account || {
                displayName: "Атлет",
                id: "user",
                email: "",
                revision: 1,
                timeZone: "UTC",
                bodyMassKg: null,
                createdAt: "",
              }
            }
            onClose={() => setShowStoryModal(false)}
          />
        </Modal>
      )}

      <div className="insight-metrics">
        <div>
          <Layers3 size={17} />
          <span>Рабочие</span>
          <b>
            {sets.working}
            <small>подх.</small>
          </b>
        </div>
        <div>
          <Flame size={17} />
          <span>Разминка</span>
          <b>
            {sets.warmup}
            <small>подх.</small>
          </b>
        </div>
        <div>
          <CheckCircle2 size={17} />
          <span>Всего выполнено</span>
          <b>
            {sets.total}
            <small>подх.</small>
          </b>
        </div>
      </div>

      <div className="warmup-volume">
        <div>
          <span>Тоннаж свободных весов</span>
          <b>{fmt(volume.all.total)} кг</b>
        </div>
        <p>
          Рабочие: {fmt(volume.working.total)} кг · Разминка: {fmt(volume.warmup.total)} кг
        </p>
        {volume.all.omittedSets > 0 && (
          <p className="tiny">
            {volume.all.omittedSets} подх. на тренажёрах, с массой тела или неизвестным правилом веса записаны отдельно. Их значения не складываются с килограммами свободных весов.
          </p>
        )}
      </div>

      {volume.all.invalidSets > 0 && <p role="status">Исключено повреждённых подходов: {volume.all.invalidSets}. Проверь значения в журнале.</p>}
      {report.machineVolume.length > 0 && <section className="session-machine-volume"><h3>Тоннаж на отдельных тренажёрах</h3>
        {report.machineVolume.map((row)=><p key={row.key}>{row.label}: {fmt(row.volume)} кг·повт. · {row.sets} подх.</p>)}
        <p className="tiny">Значения стека сравниваются только на той же машине в том же варианте движения.</p></section>}
      {report.density.supersetGroups > 0 && <p className="tiny">Групп суперсетов: {report.density.supersetGroups} · {report.density.setsPerMinute === null ? "длительность не указана" : `${fmt(report.density.setsPerMinute)} рабочих подхода/мин`}. Плотность записи не измеряет усталость.</p>}
      {report.muscles.length > 0 && (
        <div className="session-muscle-table">
          <div className="muscle-table-head">
            <span>Прямое участие</span>
            <span>Рабочие</span>
            <span>Разминка</span>
          </div>
          {report.muscles.map((m) => (
            <div key={m.id}>
              <span>
                {m.short}
                {m.indirect > 0 && <small>Помощь: {m.indirect} рабочих подх.</small>}
              </span>
              <b>{m.direct || "—"}</b>
              <b className="warmup-value">{m.warmup || "—"}</b>
            </div>
          ))}
        </div>
      )}

      {report.unmappedSets > 0 && (
        <p className="tiny">
          Для {report.unmappedSets} записанных подходов разметка мышц ещё не проверена. Они сохраняются в истории и общем количестве.
        </p>
      )}

      <details className="warmup-science">
        <summary>Как учитывается разминка</summary>
        <p>
          Разминка готовит движение и может улучшать последующие подходы. Все выполненные разминочные подходы входят в количество и внешний тоннаж. На карте выше её прямое участие показано отдельно.
        </p>
        <p>
          Недельный ориентир по умолчанию считает рабочие подходы. Нет доказанного универсального «процента роста» от разминки. Если подход стал полноценным тяжёлым рабочим, измени его тип и укажи реальный RIR.
        </p>
        <a href="https://pubmed.ncbi.nlm.nih.gov/39593476/" target="_blank" rel="noreferrer">
          Viveiros et al., 2024 — исследование разминки
        </a>
        <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980/" target="_blank" rel="noreferrer">
          Ribeiro et al., 2020 — жим и присед
        </a>
      </details>
    </section>
  );
}
