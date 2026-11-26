import { useMemo, useState } from "react";
import { ArrowLeftRight, RotateCcw, Sparkles } from "lucide-react";
import {
  LaidDupPlan,
  type LaidLift,
  type LaidSlotInfo,
  type LaidSubstitutions,
} from "../domain/LaidDupPlan";
import { ExerciseAvoidStore, SubstitutionPolicy } from "../domain/SubstitutionPolicy";
import { exerciseById } from "../lib/model";
import type { Exercise, LaidMaxes, Routine, Workout } from "../lib/types";
import ExerciseSwapModal from "./ExerciseSwapModal";
import Modal from "./Modal";

type SubstitutionsModalProps = {
  cycle: Routine[];
  workouts: Workout[];
  personal?: Exercise[];
  accountId?: string;
  minorMode?: boolean;
  today: string;
  onSave: (
    substitutions: LaidSubstitutions | undefined,
    maxes: LaidMaxes,
    options?: { calibrationLifts?: LaidLift[]; painFlags?: LaidLift[] },
  ) => Promise<void>;
  onClose: () => void;
};

const SUB_LIFTS: LaidLift[] = ["squat", "bench", "deadlift", "ohp"];

/** Модальное окно «Замены упражнений · Дэвид Лейд»: замена любого базового или подсобного упражнения на весь цикл. */
export function LaidSubstitutionsModal({
  cycle,
  workouts,
  personal,
  accountId,
  today,
  onSave,
  onClose,
}: SubstitutionsModalProps) {
  const first = cycle[0].periodization!;
  const avoidedIds = useMemo(
    () => (accountId ? new ExerciseAvoidStore(accountId).ids() : undefined),
    [accountId],
  );
  const initialSubs = useMemo(() => first.substitutions ?? {}, [first.substitutions]);
  const [subs, setSubs] = useState<LaidSubstitutions>(() => ({ ...initialSubs }));
  const [calibrationLifts, setCalibrationLifts] = useState<LaidLift[]>(() =>
    first.calibrationLifts ? [...first.calibrationLifts] : [],
  );
  const [painFlags, setPainFlags] = useState<LaidLift[]>(() =>
    first.painFlags ? [...first.painFlags] : [],
  );
  const [maxValues, setMaxValues] = useState<Record<LaidLift, string>>(() =>
    Object.fromEntries(
      SUB_LIFTS.map((l) => [
        l,
        first.calibrationLifts?.includes(l) || first.painFlags?.includes(l)
          ? ""
          : LaidDupPlan.kg(first.maxes[l]),
      ]),
    ) as Record<LaidLift, string>,
  );
  const [swapSlot, setSwapSlot] = useState<LaidSlotInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);

  const activeSubs = useMemo(() => LaidDupPlan.normalizeSubstitutions(subs), [subs]);
  const normalizedInitial = useMemo(() => LaidDupPlan.normalizeSubstitutions(initialSubs), [initialSubs]);

  const catalogSlots = useMemo(
    () => LaidDupPlan.catalogSlots(first.extras, activeSubs),
    [first.extras, activeSubs],
  );
  const liftSlots = useMemo(() => catalogSlots.filter((s) => s.role === "lift"), [catalogSlots]);
  const auxSlots = useMemo(() => catalogSlots.filter((s) => s.role !== "lift"), [catalogSlots]);

  const estimates = useMemo(
    () => LaidDupPlan.estimates(workouts, today, activeSubs),
    [workouts, today, activeSubs],
  );

  const currentVolume = useMemo(() => LaidDupPlan.cycleMuscleVolume(cycle), [cycle]);
  const nextVolume = useMemo(
    () => LaidDupPlan.cycleMuscleVolume(LaidDupPlan.withSubstitutions(cycle, activeSubs)),
    [cycle, activeSubs],
  );

  const checks = SUB_LIFTS.map((lift) => {
    if (calibrationLifts.includes(lift) || painFlags.includes(lift)) {
      const parsed = LaidDupPlan.checkMax(maxValues[lift]);
      return { lift, value: parsed.value ?? first.maxes[lift] ?? 100, error: null };
    }
    return { lift, ...LaidDupPlan.checkMax(maxValues[lift]) };
  });
  const validMaxes = checks.every((c) => c.error === null);
  const parsedMaxes = validMaxes
    ? (Object.fromEntries(checks.map((c) => [c.lift, c.value!])) as LaidMaxes)
    : null;

  const subsChanged = JSON.stringify(activeSubs ?? {}) !== JSON.stringify(normalizedInitial ?? {});
  const calChanged =
    JSON.stringify([...calibrationLifts].sort()) !== JSON.stringify([...(first.calibrationLifts ?? [])].sort());
  const painChanged =
    JSON.stringify([...painFlags].sort()) !== JSON.stringify([...(first.painFlags ?? [])].sort());
  const maxesChanged = !!parsedMaxes && SUB_LIFTS.some((l) => parsedMaxes[l] !== first.maxes[l]);
  const changed = subsChanged || maxesChanged || calChanged || painChanged;

  function applySub(originalId: string, nextId: string | null) {
    const nextMap = { ...subs };
    if (!nextId || nextId === originalId) {
      delete nextMap[originalId];
    } else {
      nextMap[originalId] = nextId;
    }
    setSubs(nextMap);

    const lift = SUB_LIFTS.find((l) => LaidDupPlan.LIFT_EXERCISE[l] === originalId);
    if (lift) {
      if (!nextId || nextId === originalId) {
        setCalibrationLifts((prev) => prev.filter((l) => l !== lift));
      } else {
        const ownSessions = LaidDupPlan.sessionsForExercise(workouts, nextId);
        const compat = SubstitutionPolicy.classify(exerciseById(originalId), exerciseById(nextId), {
          hasOwnHistory: ownSessions >= 2,
          painFlag: painFlags.includes(lift),
        });
        if (compat.prescriptionMode !== "percent_1rm") {
          setCalibrationLifts((prev) => (prev.includes(lift) ? prev : [...prev, lift]));
        }
        const nextEst = LaidDupPlan.estimates(workouts, today, LaidDupPlan.normalizeSubstitutions(nextMap))[lift];
        if (nextEst !== null) {
          setMaxValues((prev) => ({ ...prev, [lift]: LaidDupPlan.kg(nextEst) }));
        }
      }
    }
  }

  async function handleSave() {
    setShown(true);
    if (!parsedMaxes) return;
    setBusy(true);
    setError("");
    try {
      await onSave(activeSubs, parsedMaxes, { calibrationLifts, painFlags });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить замены");
    } finally {
      setBusy(false);
    }
  }

  const swapCurrentEx = swapSlot ? exerciseById(swapSlot.resolvedId) ?? exerciseById(swapSlot.originalId) : null;
  const swapOriginalEx = swapSlot ? exerciseById(swapSlot.originalId) : undefined;
  const swapExcludeIds = swapSlot
    ? LaidDupPlan.conflictingIdsForSubstitution(swapSlot.originalId, first.extras, activeSubs)
    : [];

  return (
    <>
      <Modal title="Замены упражнений · Дэвид Лейд" wide onClose={() => (busy ? false : onClose())}>
        <div className="laid-subs-modal">
          <p className="laid-lead">
            Замени любое упражнение на весь цикл (например, при травме спины или под инвентарь). Периодизация, проценты волн и объём по мышцам пересчитаются автоматически, а история тренировок сохранится.
          </p>

          <div className="laid-volume-strip" aria-label="Плановый объём цикла">
            <div className="laid-volume-strip-head">
              <span>Недельный объём цикла</span>
              <span className="laid-volume-axial">
                Осевая нагрузка: <b>{nextVolume.axialSets}</b> подх.
                {nextVolume.axialSets !== currentVolume.axialSets ? (
                  <small>
                    {" "}
                    ({nextVolume.axialSets - currentVolume.axialSets > 0 ? "+" : ""}
                    {nextVolume.axialSets - currentVolume.axialSets})
                  </small>
                ) : null}
              </span>
            </div>
            <div className="laid-volume-chips">
              {nextVolume.muscles.map((mItem) => {
                const prevSets = currentVolume.muscles.find((b) => b.id === mItem.id)?.sets ?? 0;
                const delta = Math.round((mItem.sets - prevSets) * 10) / 10;
                return (
                  <span key={mItem.id} className={`laid-vol-chip${delta !== 0 ? " changed" : ""}`}>
                    <span>{mItem.name}</span>
                    <b>{LaidDupPlan.kg(mItem.sets)}</b>
                    {delta !== 0 ? (
                      <small>{delta > 0 ? `+${LaidDupPlan.kg(delta)}` : LaidDupPlan.kg(delta)}</small>
                    ) : null}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="laid-subs-group">
            <p className="laid-subcaption">Базовые движения (волновая периодизация DUP)</p>
            <ul className="laid-subs-list">
              {liftSlots.map((slot) => {
                const lift = slot.lift!;
                const origName = exerciseById(slot.originalId)?.name ?? slot.originalId;
                const curDef = exerciseById(slot.resolvedId);
                const curName = curDef?.name ?? slot.resolvedId;
                const check = checks.find((c) => c.lift === lift)!;
                const liftErr = shown && check.error ? check.error : "";
                const est = estimates[lift];
                const changedThisLift = slot.resolvedId !== LaidDupPlan.liftExerciseId(lift, normalizedInitial);
                return (
                  <li key={slot.originalId} className={`laid-subs-item laid-subs-lift-item${slot.replaced ? " is-replaced" : ""}`}>
                    <div className="laid-subs-item-row">
                      <div className="laid-subs-item-info">
                        <b>{curName}</b>
                        <small>
                          {slot.days.map((d) => LaidDupPlan.SHORT[d]).join(" · ")} · {slot.weeklySets} подх./нед
                          {slot.replaced ? ` · вместо «${origName}»` : ""}
                        </small>
                      </div>
                      <div className="laid-subs-item-actions">
                        {slot.replaced ? (
                          <button
                            type="button"
                            className="laid-subs-reset-btn"
                            aria-label={`Вернуть ${origName}`}
                            onClick={() => applySub(slot.originalId, null)}
                          >
                            <RotateCcw size={14} aria-hidden="true" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="laid-subs-swap-btn"
                          onClick={() => setSwapSlot(slot)}
                        >
                          <ArrowLeftRight size={14} aria-hidden="true" />
                          <span>Заменить</span>
                        </button>
                      </div>
                    </div>

                    {slot.replaced || changedThisLift || calibrationLifts.includes(lift) || painFlags.includes(lift) ? (
                      <div className="laid-subs-max-row">
                        <div className="laid-lift-mode-row">
                          <button
                            type="button"
                            aria-pressed={calibrationLifts.includes(lift)}
                            className={`laid-mode-chip${calibrationLifts.includes(lift) ? " active" : ""}`}
                            onClick={() =>
                              setCalibrationLifts((prev) =>
                                prev.includes(lift) ? prev.filter((l) => l !== lift) : [...prev, lift],
                              )
                            }
                          >
                            {calibrationLifts.includes(lift) ? "Калибровка по RIR: вкл" : "Режим калибровки"}
                          </button>
                          <button
                            type="button"
                            aria-pressed={painFlags.includes(lift)}
                            className={`laid-mode-chip is-pain${painFlags.includes(lift) ? " active" : ""}`}
                            onClick={() =>
                              setPainFlags((prev) =>
                                prev.includes(lift) ? prev.filter((l) => l !== lift) : [...prev, lift],
                              )
                            }
                          >
                            {painFlags.includes(lift) ? "Щадяще (боль): вкл" : "Травма / боль"}
                          </button>
                        </div>
                        {!calibrationLifts.includes(lift) && !painFlags.includes(lift) ? (
                          <>
                            <label className="laid-subs-max-label">
                              <span>1ПМ для {curName}</span>
                              <span className="laid-input">
                                <input
                                  inputMode="decimal"
                                  value={maxValues[lift]}
                                  aria-invalid={liftErr ? true : undefined}
                                  onChange={(e) => setMaxValues({ ...maxValues, [lift]: e.target.value })}
                                />
                                <span className="laid-unit" aria-hidden="true">
                                  {curDef?.recording.loadMode === "per_implement" ? "кг · 1 гант." : "кг"}
                                </span>
                              </span>
                            </label>
                            {est !== null && maxValues[lift] !== LaidDupPlan.kg(est) ? (
                              <button
                                type="button"
                                className="laid-estimate"
                                onClick={() => setMaxValues({ ...maxValues, [lift]: LaidDupPlan.kg(est) })}
                              >
                                <Sparkles size={13} aria-hidden="true" />
                                <span>по истории ≈ {LaidDupPlan.kg(est)} кг</span>
                              </button>
                            ) : null}
                            {liftErr ? <p className="laid-error" role="alert">{liftErr}</p> : null}
                          </>
                        ) : (
                          <p className="tiny laid-quiet-note">
                            {painFlags.includes(lift)
                              ? "Синглы 95 % и автоповышение веса отключены — работа по переносимому весу (RIR 2–3)."
                              : "1-я неделя в режиме калибровки по RIR без фиктивных % от старого 1ПМ."}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="laid-subs-group">
            <p className="laid-subcaption">Подсобные упражнения</p>
            <ul className="laid-subs-list">
              {auxSlots.map((slot) => {
                const origName = exerciseById(slot.originalId)?.name ?? slot.originalId;
                const curName = exerciseById(slot.resolvedId)?.name ?? slot.resolvedId;
                return (
                  <li key={slot.originalId} className={`laid-subs-item${slot.replaced ? " is-replaced" : ""}`}>
                    <div className="laid-subs-item-info">
                      <b>{curName}</b>
                      <small>
                        {slot.days.map((d) => LaidDupPlan.SHORT[d]).join(" · ")} · {slot.weeklySets} подх./нед
                        {slot.role === "wave-aux" ? " · волна повт." : ""}
                        {slot.replaced ? ` · вместо «${origName}»` : ""}
                      </small>
                    </div>
                    <div className="laid-subs-item-actions">
                      {slot.replaced ? (
                        <button
                          type="button"
                          className="laid-subs-reset-btn"
                          aria-label={`Вернуть ${origName}`}
                          onClick={() => applySub(slot.originalId, null)}
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="laid-subs-swap-btn"
                        onClick={() => setSwapSlot(slot)}
                      >
                        <ArrowLeftRight size={14} aria-hidden="true" />
                        <span>Заменить</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {error ? (
            <p className="error-banner" role="alert">
              {error}
            </p>
          ) : null}

          <div className="laid-actions laid-sticky-footer">
            <button
              type="button"
              className="button primary"
              disabled={busy || !changed}
              onClick={() => void handleSave()}
            >
              {busy ? "Сохраняем…" : "Сохранить замены"}
            </button>
            <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
              Отмена
            </button>
          </div>
        </div>
      </Modal>

      {swapSlot && swapCurrentEx ? (
        <ExerciseSwapModal
          title={swapSlot.role === "lift" ? "Заменить базовое движение" : "Заменить упражнение в цикле"}
          subtitle={`Замена применится на всех неделях цикла (${swapSlot.days.map((d) => LaidDupPlan.SHORT[d]).join(" · ")}). Объём по мышцам и периодизация пересчитаются автоматически.`}
          currentExercise={swapCurrentEx}
          originalExercise={swapOriginalEx}
          showCompatibilityFor={swapSlot.role === "lift" ? swapOriginalEx : undefined}
          personal={personal}
          avoidedIds={avoidedIds}
          excludeIds={swapExcludeIds}
          requireWeighted={swapSlot.role === "lift"}
          onSwap={(nextEx) => applySub(swapSlot.originalId, nextEx.id)}
          onReset={() => applySub(swapSlot.originalId, null)}
          onClose={() => setSwapSlot(null)}
        />
      ) : null}
    </>
  );
}
