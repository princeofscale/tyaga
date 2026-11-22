import { ChevronRight, Clock3 } from "lucide-react";
import { m } from "motion/react";
import { DateText } from "../domain/DateText";
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
  /** Общий вход экрана: уважает «уменьшить движение». */
  enter: (delay: number) => Record<string, unknown>;
  onOpen: (workout: Workout) => void;
};

/** Строка тренировки в списках «Последние» и «История». */
export default function SessionCard({
  workout: w,
  expanded = false,
  index = 0,
  currentYear,
  pendingIds,
  enter,
  onOpen,
}: Props) {
  const tonnage = volumeSummary([w], "all");
  const caption = VolumeLabel.caption(tonnage.total, tonnage.omittedSets);
  return (
    <m.button
      className="session-item"
      onClick={() => onOpen(w)}
      {...enter(0.34 + index * 0.06)}
    >
      <div className="session-date">
        <b>{new Date(w.date + "T12:00:00").getDate()}</b>
        <span>{DateText.monthShort(w.date)}</span>
        {w.date.slice(0, 4) !== currentYear ? (
          <small className="session-year">{w.date.slice(0, 4)}</small>
        ) : null}
      </div>
      <div className="session-item-info">
        <h3>
          {w.name}
          {pendingIds.has(w.id) ? <span className="pending-badge">Ждёт отправки</span> : null}
        </h3>
        <p>
          {w.exercises.length} упр. <span>·</span> {workingSets([w])} подх.{" "}
          {expanded ? (
            <>
              <span>·</span>
              {w.exercises.slice(0, 2).map((e) => entryName(e)).join(", ")}
            </>
          ) : null}
        </p>
      </div>
      <div className="session-item-value">
        <b
          title={
            tonnage.total > 0
              ? "Только однозначно записанные свободные веса"
              : VolumeLabel.reason(tonnage.omittedSets)
          }
        >
          {VolumeLabel.short(tonnage.total)}
        </b>
        {caption ? <small className="volume-none">{caption}</small> : null}
        <span>
          <Clock3 size={13} />
          {w.duration} мин
        </span>
      </div>
      <ChevronRight size={17} className="muted" />
    </m.button>
  );
}
