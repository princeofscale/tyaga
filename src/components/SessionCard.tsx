import { memo } from "react";
import { ChevronRight, Clock3, Trophy } from "lucide-react";
import { m } from "motion/react";
import { DateText } from "../domain/DateText";
import { HistoryInsights } from "../domain/HistoryInsights";
import { VolumeLabel } from "../domain/VolumeLabel";
import {
  entryName,
  volumeSummary,
  workingSets,
  type Workout,
} from "../lib/model";

type Props = {
  workout: Workout;
  expanded?: boolean;
  index?: number;
  /** Год текущего дня: год в дате показывается только у записей другого года. */
  currentYear: string;
  /** Тренировки, которые ещё ждут отправки на сервер. */
  pendingIds: Set<string>;
  /** Упражнения, где в этой тренировке побит прежний расчётный 1ПМ. */
  records?: string[];
  /** Общий вход экрана: уважает «уменьшить движение». */
  enter: (delay: number) => Record<string, unknown>;
  onOpen: (workout: Workout) => void;
};

/** Строка тренировки в списках «Последние» и «История». */
const SessionCard = memo(function SessionCard({
  workout: w,
  expanded = false,
  index = 0,
  currentYear,
  pendingIds,
  records = [],
  enter,
  onOpen,
}: Props) {
  const tonnage = volumeSummary([w], "all");
  const caption = VolumeLabel.caption(tonnage.total, tonnage.omittedSets);
  const names = w.exercises.map((e) => entryName(e));
  return (
    <m.button
      type="button"
      data-testid="session-item"
      className={`session-item${expanded ? " session-item-rich" : ""}${records.length ? " has-record" : ""}`}
      onClick={() => onOpen(w)}
      {...enter(0.34 + index * 0.06)}
    >
      <div className="session-date">
        {expanded ? <small className="session-weekday">{HistoryInsights.weekday(w.date)}</small> : null}
        <b>{new Date(w.date + "T12:00:00").getDate()}</b>
        <span>{DateText.monthShort(w.date)}</span>
        {w.date.slice(0, 4) !== currentYear ? (
          <small className="session-year">{w.date.slice(0, 4)}</small>
        ) : null}
      </div>
      <div className="session-item-info">
        <h3>
          <span className="session-name">{w.name}</span>
          {records.length ? (
            <span className="record-badge" title={`Рекорд: ${records.join(", ")}`}>
              <Trophy size={12} aria-hidden="true" />
              {records.length > 1 ? `Рекорды · ${records.length}` : "Рекорд"}
            </span>
          ) : null}
          {pendingIds.has(w.id) ? <span className="pending-badge">Ждёт отправки</span> : null}
        </h3>
        <p>
          {w.exercises.length} упр. <span>·</span> {workingSets([w])} подх.{" "}
          {expanded && names.length ? (
            <>
              <span>·</span>
              <span className="session-names" title={names.join(", ")}>{names.join(", ")}</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="session-item-value">
        <b
          title={
            tonnage.total > 0
              ? "Только однозначно записанные свободные веса (включая разминку)"
              : VolumeLabel.reason(tonnage.omittedSets)
          }
        >
          {VolumeLabel.short(tonnage.total)}
        </b>
        {caption ? <small className="volume-none">{caption}</small> : null}
        <span>
          <Clock3 size={13} aria-hidden="true" />
          {w.duration} мин
        </span>
      </div>
      <ChevronRight size={17} className="muted session-chevron" aria-hidden="true" />
    </m.button>
  );
});

export default SessionCard;
