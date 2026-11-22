import { useMemo } from "react";
import { PersonalRecordsCalculator } from "../domain/PersonalRecords";
import type { Workout } from "../lib/model";

export default function MovementBalance({ workouts }: { workouts: Workout[] }) {
  const r = useMemo(
    () => new PersonalRecordsCalculator(workouts).calculateRatios(),
    [workouts],
  );
  const ppTotal = r.pushSets + r.pullSets;
  const ulTotal = r.upperSets + r.lowerSets;

  return (
    <section className="progress-card movement-balance">
      <h2>Баланс недели</h2>
      <div className="movement-balance-grid">
        <div className="balance-meter-card">
          <div className="balance-meter-head">
            <span>Жимы / тяги</span>
            <strong>
              {r.pushSets} / {r.pullSets}
            </strong>
          </div>
          <div className="balance-meter-bar" aria-hidden="true">
            {(!ppTotal || r.pushSets > 0) ? (
              <span className="balance-meter-a" style={{ flexGrow: ppTotal ? r.pushSets : 1 }} />
            ) : null}
            {(!ppTotal || r.pullSets > 0) ? (
              <span className="balance-meter-b" style={{ flexGrow: ppTotal ? r.pullSets : 1 }} />
            ) : null}
          </div>
        </div>
        <div className="balance-meter-card">
          <div className="balance-meter-head">
            <span>Верх / низ</span>
            <strong>
              {r.upperSets} / {r.lowerSets}
            </strong>
          </div>
          <div className="balance-meter-bar" aria-hidden="true">
            {(!ulTotal || r.upperSets > 0) ? (
              <span className="balance-meter-a" style={{ flexGrow: ulTotal ? r.upperSets : 1 }} />
            ) : null}
            {(!ulTotal || r.lowerSets > 0) ? (
              <span className="balance-meter-b" style={{ flexGrow: ulTotal ? r.lowerSets : 1 }} />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
