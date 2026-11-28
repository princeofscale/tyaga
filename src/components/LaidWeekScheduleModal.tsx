import { useMemo, useState } from "react";
import { LaidDupPlan, type LaidDay, type LaidWeekSlot } from "../domain/LaidDupPlan";
import { quantity } from "../lib/quantity";
import type { Routine } from "../lib/types";
import LaidWeekOrderEditor from "./LaidWeekOrderEditor";
import Modal from "./Modal";

type WeekScheduleProps = {
  cycle: Routine[];
  allRoutines: Routine[];
  today: string;
  accountId?: string;
  onSave: (weekdays: Record<LaidDay, number>) => Promise<void>;
  onClose: () => void;
};

/** Модальное окно «Дни недели · Дэвид Лейд»: перестановка тренировок и выходного по Пн–Вс. */
export function LaidWeekScheduleModal({ cycle, allRoutines, today, accountId, onSave, onClose }: WeekScheduleProps) {
  const initialSlots = useMemo(() => LaidDupPlan.slotsFromCycle(cycle), [cycle]);
  const [slots, setSlots] = useState<LaidWeekSlot[]>(initialSlots);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const first = cycle[0].periodization!;
  const rawWeek = LaidDupPlan.weekOf(first.startMonday, today);
  const position = LaidDupPlan.weekPosition(first, rawWeek);
  const activeMaxes = useMemo(() => LaidDupPlan.maxesFor(first, position.week), [first, position.week]);
  const cycleIds = useMemo(() => new Set(cycle.map((r) => r.id)), [cycle]);
  const otherRoutines = useMemo(() => allRoutines.filter((r) => !cycleIds.has(r.id)), [allRoutines, cycleIds]);

  const { summaries, counts } = useMemo(() => {
    const sum: Partial<Record<LaidDay, string>> = {};
    const cnt: Partial<Record<LaidDay, string>> = {};
    for (const r of cycle) {
      const p = r.periodization!;
      const plan = LaidDupPlan.day(p.day, rawWeek, activeMaxes, {
        version: p.version,
        light: p.light,
        substitutions: p.substitutions,
        calibrationLifts: p.calibrationLifts,
        painFlags: p.painFlags,
        deloadWeeks: p.deloadWeeks,
        accountId,
      });
      sum[p.day] = LaidDupPlan.compactLine(plan);
      cnt[p.day] = quantity(r.exercises.length, "упражнение", "упражнения", "упражнений");
    }
    return { summaries: sum, counts: cnt };
  }, [activeMaxes, cycle, rawWeek, accountId]);

  const changed = slots.some((s, idx) => s !== initialSlots[idx]);

  async function handleSave() {
    setBusy(true);
    setError("");
    try {
      await onSave(LaidDupPlan.weekdaysFromSlots(slots));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить дни недели");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Дни недели · Дэвид Лейд" wide onClose={() => (busy ? false : onClose())}>
      <div className="laid-week-modal">
        <p className="laid-lead">
          Перетащи тренировки или день отдыха на нужные дни недели. Веса по волнам DUP, состав упражнений и история сохраняются.
        </p>

        <LaidWeekOrderEditor
          slots={slots}
          initialSlots={initialSlots}
          onChange={setSlots}
          summaries={summaries}
          counts={counts}
          otherRoutines={otherRoutines}
          version={first.version}
          disabled={busy}
        />

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        <div className="laid-actions laid-sticky-footer">
          <button type="button" className="button primary" disabled={busy || !changed} onClick={() => void handleSave()}>
            {busy ? "Сохраняем…" : "Сохранить расписание"}
          </button>
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}
