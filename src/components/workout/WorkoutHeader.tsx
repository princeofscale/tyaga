import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { m } from "motion/react";
import {
  Activity,
  Calendar,
  ChevronDown,
  MoreHorizontal,
  Sun,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { DeloadHint } from "../../domain/DeloadHint";
import type { DeloadPlanRecord } from "../../domain/DeloadPlan";
import type { Draft } from "../../lib/draft";
import { fmt, type Workout } from "../../lib/model";
import LiveStrip from "../LiveStrip";
import RoomBadge from "../RoomBadge";
import WorkoutReadinessBar from "../WorkoutReadinessBar";
import { WorkoutLiveClock } from "./WorkoutLiveClock";

type ReadinessLevel = "normal" | "worse" | "hard";

type Props = {
  barRef: RefObject<HTMLElement | null>;
  pinRef: RefObject<HTMLDivElement | null>;
  nameBox: RefObject<HTMLTextAreaElement | null>;
  hintPrefix: string;
  entryPanelId: string;
  draft: Draft;
  workout: Workout;
  room: boolean;
  readOnly: boolean;
  saving: boolean;
  gymMode: boolean;
  workoutId?: string;
  manualClock: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  wakeLockSupported: boolean;
  keepAwake: boolean;
  onToggleWakeLock: () => void;
  retroLabel: string | null;
  entryPanel: boolean;
  onToggleEntryPanel: () => void;
  readiness: ReadinessLevel | null;
  appliedReadiness: "worse" | "hard" | null;
  onSelectReadiness: (level: ReadinessLevel) => void;
  onApplyReadiness: (level: "worse" | "hard") => void;
  deloadLine: string | null;
  deloadPlan?: DeloadPlanRecord | null;
  onApplyDeload: () => void;
  doneWorking: number;
  totalWorking: number;
  totalTonnage: number;
  reducedMotion: boolean | null;
  modeSwitch: ReactNode;
  dateField: (retro: boolean) => ReactNode;
  durationField: (retro: boolean) => ReactNode;
  onChangeWorkout: (next: Workout) => void;
  onToggleClock: () => void;
  onMinimize: () => void;
  onRequestDiscard: () => void;
  onSave: () => void;
  onOpenTogether: () => void;
  onToast?: (text: string) => void;
};

/** Шапка активной тренировки: компактные главные действия, переполняющее меню «•••» для звука/экрана/самочувствия и живой HUD. */
export function WorkoutHeader({
  barRef,
  pinRef,
  nameBox,
  hintPrefix,
  entryPanelId,
  draft,
  workout,
  room,
  readOnly,
  saving,
  gymMode,
  workoutId,
  manualClock,
  soundEnabled,
  onToggleSound,
  wakeLockSupported,
  keepAwake,
  onToggleWakeLock,
  retroLabel,
  entryPanel,
  onToggleEntryPanel,
  readiness,
  appliedReadiness,
  onSelectReadiness,
  onApplyReadiness,
  deloadLine,
  deloadPlan,
  onApplyDeload,
  doneWorking,
  totalWorking,
  totalTonnage,
  reducedMotion,
  modeSwitch,
  dateField,
  durationField,
  onChangeWorkout,
  onToggleClock,
  onMinimize,
  onRequestDiscard,
  onSave,
  onOpenTogether,
  onToast,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [readinessExpanded, setReadinessExpanded] = useState(false);
  const moreWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (moreWrapRef.current && !moreWrapRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  const canShowReadiness = !readOnly && !draft.editing && !gymMode && !!workoutId;
  const showReadinessBar = canShowReadiness && (readinessExpanded || readiness !== null || appliedReadiness !== null);
  const hasMoreIndicator = !soundEnabled || keepAwake || appliedReadiness !== null;

  return (
    <header className="workout-bar" ref={barRef}>
      <div className="workout-headline">
        <div className="workout-bar-title">
          <h1 className="workout-session-label">
            {draft.editing ? "Редактирование тренировки" : "Активная тренировка"}
          </h1>
          <label className="sr-only" htmlFor={`${hintPrefix}-name`}>Название тренировки</label>
          {room ? (
            <textarea
              id={`${hintPrefix}-name`}
              ref={nameBox}
              rows={1}
              className="workout-name-wrap"
              value={workout.name}
              maxLength={120}
              disabled={saving}
              onChange={(e) => onChangeWorkout({ ...workout, name: e.target.value.replace(/\n/g, " ") })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
              }}
            />
          ) : (
            <div className="workout-name-field">
              <span className="workout-name-copy" aria-hidden="true">{workout.name || "Название тренировки"}</span>
              <input
                id={`${hintPrefix}-name`}
                type="text"
                value={workout.name}
                maxLength={120}
                disabled={saving}
                onChange={(e) => onChangeWorkout({ ...workout, name: e.target.value })}
              />
            </div>
          )}
          {room ? <RoomBadge onToast={onToast ?? (() => {})} /> : null}
        </div>
        <div className="workout-head-buttons-cluster">
          <button
            type="button"
            className="icon-button workout-minimize-btn"
            aria-label="Свернуть тренировку"
            onClick={onMinimize}
          >
            <ChevronDown size={22} aria-hidden="true" />
          </button>
          {!retroLabel && (
            <button
              type="button"
              className="icon-button workout-entry-toggle"
              aria-label="Дата, длительность и заметки"
              title="Дата, длительность и заметки"
              aria-expanded={entryPanel}
              aria-controls={entryPanelId}
              onClick={onToggleEntryPanel}
            >
              <Calendar size={18} aria-hidden="true" />
            </button>
          )}
          <div className="workout-more-wrap" ref={moreWrapRef}>
            <button
              type="button"
              className={`icon-button workout-more-btn${hasMoreIndicator ? " has-dot" : ""}`}
              aria-label="Параметры тренировки"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              title="Звук, экран и самочувствие"
              onClick={() => setMoreOpen((v) => !v)}
            >
              <MoreHorizontal size={19} aria-hidden="true" />
            </button>
            {moreOpen ? (
              <div className="workout-more-menu" role="menu" aria-label="Параметры тренировки">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={soundEnabled}
                  className="workout-more-item"
                  onClick={onToggleSound}
                >
                  {soundEnabled ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
                  <span>Звук таймера</span>
                  <small>{soundEnabled ? "Вкл" : "Выкл"}</small>
                </button>
                {wakeLockSupported ? (
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={keepAwake}
                    className="workout-more-item"
                    onClick={onToggleWakeLock}
                  >
                    <Sun size={16} aria-hidden="true" />
                    <span>Не гасить экран</span>
                    <small>{keepAwake ? "Вкл" : "Выкл"}</small>
                  </button>
                ) : null}
                {canShowReadiness ? (
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={showReadinessBar}
                    className="workout-more-item"
                    onClick={() => {
                      setReadinessExpanded((v) => !v);
                      setMoreOpen(false);
                    }}
                  >
                    <Activity size={16} aria-hidden="true" />
                    <span>Самочувствие</span>
                    <small>{showReadinessBar ? "Открыто" : "Скрыто"}</small>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="button secondary cancel-workout-btn"
            title="Отменить тренировку без сохранения"
            onClick={onRequestDiscard}
          >
            <X size={15} aria-hidden="true" />
            <span>Отмена</span>
          </button>
        </div>
      </div>

      {showReadinessBar ? (
        <WorkoutReadinessBar
          readiness={readiness}
          appliedReadiness={appliedReadiness}
          saving={saving}
          onSelect={onSelectReadiness}
          onApply={onApplyReadiness}
        />
      ) : null}

      {deloadLine ? (
        <div className="deload-hint" role="status">
          <span>{deloadLine}</span>
          <button type="button" className="button secondary" disabled={saving} onClick={onApplyDeload}>
            Подставить {deloadPlan ? DeloadHint.percent(deloadPlan.mode) : 85} %
          </button>
        </div>
      ) : null}

      {(retroLabel || entryPanel) && (
        <div className="retro-date">
          {retroLabel && (
            <button
              type="button"
              className="retro-chip"
              aria-expanded={entryPanel}
              aria-controls={entryPanelId}
              onClick={onToggleEntryPanel}
            >
              <Calendar size={15} aria-hidden="true" />
              {retroLabel}
            </button>
          )}
          {entryPanel && (
            <div className="retro-panel workout-entry-panel" id={entryPanelId} role="group" aria-label="Дата и длительность записи">
              {dateField(!!retroLabel)}
              {durationField(!!retroLabel)}
              <div className="workout-entry-notes">
                <label htmlFor={entryPanelId + "-notes"}>Заметки</label>
                <textarea
                  id={entryPanelId + "-notes"}
                  rows={2}
                  value={workout.notes}
                  disabled={saving}
                  maxLength={2000}
                  onChange={(e) => onChangeWorkout({ ...workout, notes: e.target.value })}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {draft.editing ? null : <LiveStrip onOpen={onOpenTogether} />}

      <div className="workout-command-strip" ref={pinRef}>
        <div className="workout-live-hud">
          <WorkoutLiveClock
            draft={draft}
            manualClock={manualClock}
            saving={saving}
            onTogglePause={onToggleClock}
          />
          <span className="hud-metric hud-working">
            <b aria-live="polite" aria-atomic="true">{doneWorking}<small> / {totalWorking}</small></b>
            <span className="hud-label">Рабочие подходы</span>
          </span>
          <span className="hud-metric hud-tonnage-inline">
            <b>{fmt(totalTonnage)}<small> кг</small></b>
            <span className="hud-label">Тоннаж</span>
          </span>
        </div>
        <button
          type="button"
          className="button primary finish-button"
          aria-label={draft.editing ? "Сохранить изменения" : "Завершить тренировку"}
          onClick={onSave}
          disabled={saving || readOnly || doneWorking === 0}
        >
          {saving ? "…" : draft.editing ? "Сохранить" : "Завершить"}
        </button>
        {gymMode && modeSwitch}
        <div className="workout-session-progress" aria-hidden="true">
          <m.div
            className="workout-session-progress-fill"
            initial={false}
            animate={{ scaleX: totalWorking ? doneWorking / totalWorking : 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.24, ease: "easeOut" }}
          />
        </div>
      </div>
    </header>
  );
}
