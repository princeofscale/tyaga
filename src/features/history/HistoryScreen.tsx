import type { ReactNode } from "react";
import { Download, History, Plus, Upload } from "lucide-react";
import { entryName, localDate, volumeSummary, type Settings, type Workout } from "../../lib/model";
import type { AccountProfile } from "../../lib/account";
import { DateText } from "../../domain/DateText";
import type { ImportRecord } from "../../domain/ImportUndo";
import { VolumeLabel } from "../../domain/VolumeLabel";
import { quantity } from "../../lib/quantity";
import HistoryList, { HistoryStats } from "../../components/HistoryList";
import SessionInsights from "../../components/SessionInsights";
import { VolumeChart } from "../../components/Charts";

export interface HistoryScreenProps {
  account: AccountProfile;
  settings: Settings;
  displayed: Workout[];
  workouts: Workout[];
  monthWorkouts: Workout[];
  currentYear: string;
  justSaved: Workout | null;
  pendingImport: { runId: string; total: number } | null;
  lastImport: ImportRecord | null;
  lastImportRun: { runId: string; at: string; total: number; activeCount: number } | null;
  lastNoop: { at: string; kind: "import" | "restore" } | null;
  undoAsk: boolean;
  saving: boolean;
  onUndoAskChange: (ask: boolean) => void;
  onUndoImport: (runId: string) => void;
  onHideImportBanner: () => void;
  onOpenImport: () => void;
  onExportHistory: () => void;
  onStartBackdated: () => void;
  renderSession: (workout: Workout, records?: string[]) => ReactNode;
}

export default function HistoryScreen({
  account,
  settings,
  displayed,
  workouts,
  monthWorkouts,
  currentYear,
  justSaved,
  pendingImport,
  lastImport,
  lastImportRun,
  lastNoop,
  undoAsk,
  saving,
  onUndoAskChange,
  onUndoImport,
  onHideImportBanner,
  onOpenImport,
  onExportHistory,
  onStartBackdated,
  renderSession,
}: HistoryScreenProps) {
  return (
    <>
      <header className="screen-head history-head">
        <h1>История тренировок</h1>
      </header>
      <HistoryStats workouts={displayed} today={localDate(new Date(), settings.timeZone)} />
      {pendingImport ? (
        <section className="import-undo panel" role="status">
          <p>
            <b>Импорт не завершён · {pendingImport.total} тренировок ещё не записаны</b>
            <small>
              Если запись оборвалась, открой тот же файл и повтори импорт с теми же ответами. До завершения тренировки в Истории не появляются. Этот черновик можно отменить.
            </small>
          </p>
          <div>
            <button className="button secondary" onClick={onOpenImport}>
              Продолжить импорт
            </button>
            <button
              className="button danger"
              disabled={saving}
              onClick={() => onUndoImport(pendingImport.runId)}
            >
              Убрать черновик
            </button>
          </div>
        </section>
      ) : null}
      {justSaved ? (
        <SessionInsights workout={justSaved} settings={settings} account={account} />
      ) : null}
      {lastImportRun
        ? (() => {
            const when = DateText.moment(lastImportRun.at, settings.timeZone, currentYear);
            const restored = lastImport?.kind === "restore";
            const noun = restored ? "Восстановление" : "Импорт";
            const scope = `${quantity(lastImportRun.activeCount, "тренировку", "тренировки", "тренировок")}, добавленных ${when}`;
            return (
              <section
                className={`import-undo panel${undoAsk ? "" : " import-undo-compact"}`}
                role="status"
                aria-label="Последний импорт"
              >
                <div className="import-undo-text">
                  <b>
                    {noun}: записано {lastImportRun.activeCount} из {lastImportRun.total}
                  </b>
                  <small className="import-undo-scope">
                    Отмена удалит {scope}.
                    {restored ? " Программы, свои упражнения, избранное и вес останутся." : ""}
                  </small>
                  {lastNoop ? (
                    <small className="import-undo-noop">
                      {lastNoop.kind === "restore" ? "Восстановление" : "Импорт"}{" "}
                      {DateText.moment(lastNoop.at, settings.timeZone, currentYear)} ничего не
                      добавил{lastNoop.kind === "restore" ? "о" : ""} — отмена относится к{" "}
                      {restored ? "восстановлению" : "импорту"} от {when}.
                    </small>
                  ) : null}
                  <details className="import-undo-more">
                    <summary>Как работает отмена</summary>
                    <small>
                      Убираются только записи этого импорта, которые ты не менял. Твои правки и
                      тренировки с других устройств остаются.
                    </small>
                  </details>
                </div>
                {undoAsk ? (
                  <div>
                    <p className="import-undo-confirm">
                      <b>Удалить {scope}?</b> Вернуть их можно только повторным импортом файла.
                    </p>
                    <button
                      className="button danger"
                      disabled={saving}
                      onClick={() => onUndoImport(lastImportRun.runId)}
                    >
                      Убрать {lastImportRun.activeCount}
                    </button>
                    <button className="button secondary" onClick={() => onUndoAskChange(false)}>
                      Не надо
                    </button>
                  </div>
                ) : (
                  <div className="import-undo-actions">
                    <button className="button secondary" onClick={() => onUndoAskChange(true)}>
                      {restored ? "Отменить восстановление" : "Отменить импорт"}
                    </button>
                    <button className="text-button" onClick={onHideImportBanner}>
                      Скрыть
                    </button>
                  </div>
                )}
              </section>
            );
          })()
        : null}
      {monthWorkouts.length ? (
        <details className="panel volume-panel volume-fold">
          <summary>
            <span>
              <b>Объём за 28 дней</b>
              <small>Свободные веса, включая разминку</small>
            </span>
            <b
              className="volume-total"
              title={VolumeLabel.reason(volumeSummary(monthWorkouts, "all").omittedSets)}
            >
              {VolumeLabel.short(volumeSummary(monthWorkouts, "all").total)}
            </b>
          </summary>
          <VolumeChart workouts={monthWorkouts} timeZone={settings.timeZone} />
        </details>
      ) : null}
      <HistoryList
        workouts={displayed}
        entryName={entryName}
        renderItem={renderSession}
        actions={
          <>
            {workouts.length ? (
              <button className="button primary history-log" onClick={onStartBackdated}>
                <Plus size={17} aria-hidden="true" />
                Записать тренировку
              </button>
            ) : null}
            <button
              className="button secondary history-io"
              title="Экспорт JSON"
              onClick={onExportHistory}
            >
              <Download size={17} aria-hidden="true" />
              <span className="history-io-label">Экспорт JSON</span>
            </button>
            <button
              className="button secondary history-io"
              title="Импорт истории"
              onClick={onOpenImport}
            >
              <Upload size={17} aria-hidden="true" />
              <span className="history-io-label">Импорт истории</span>
            </button>
          </>
        }
        empty={
          <div className="empty-state">
            <History size={36} />
            <h2>История начинается сегодня</h2>
            <p>Завершённая тренировка появится здесь.</p>
            <button className="button primary" onClick={onStartBackdated}>
              Записать тренировку
            </button>
          </div>
        }
      />
    </>
  );
}
