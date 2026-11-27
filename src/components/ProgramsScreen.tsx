import { m, useReducedMotion } from "motion/react";
import { Suspense, useState, useEffect, useMemo, useRef } from "react";
import { ArrowLeftRight, ChevronRight, Play, Plus, Save, Trash2 } from "lucide-react";
import { TrainingProgram, DAY_NAMES } from "../domain/TrainingProgram";
import { PlanLine } from "../domain/PlanLine";
import { TrainingCalendar, type ScheduledTraining } from "../domain/TrainingCalendar";
import WorkoutPreviewCard from "./WorkoutPreviewCard";
import {
  localDate,
  exerciseForEntry,
  exerciseById,
  entryName,
  makeExerciseEntry,
  makeSets,
  fmt,
} from "../lib/model";
import ExerciseInfo from "./ExerciseInfo";
import ExerciseSwapModal from "./ExerciseSwapModal";
import type { Exercise, LaidMaxes, Muscle, Routine, Workout } from "../lib/types";
import { ApiError } from "../services/ApiClient";
import Modal from "./Modal";
import Select from "./Select";
import { ExerciseLibrary } from "./chunks";
import { DeloadPlan, type DeloadPlanRecord } from "../domain/DeloadPlan";
import { dateLabel } from "../lib/calendar";
import { LaidDupPlan, type LaidCalibrationGraduation, type LaidDay, type LaidLift, type LaidSubstitutions, type LaidVersion } from "../domain/LaidDupPlan";
import { AdaptiveNutritionEngine, NutritionStore } from "../domain/AdaptiveNutritionEngine";
import { BodyweightTracker } from "../domain/BodyweightTracker";
import type { EnergyStatus } from "../domain/LaidDupV3";
import LaidDupModal from "./LaidDupModal";
import { LaidDupCard, LaidDupSchedule, LaidSubstitutionsModal, LaidWeekScheduleModal } from "./LaidDupPanel";
import ScheduleOccurrenceModal from "./ScheduleOccurrenceModal";
import ProgramRoutineCard from "./ProgramRoutineCard";
import ProgramWeek from "./ProgramWeek";
import "../styles/programs.css";

type Props = {
  routines: Routine[];
  workouts: Workout[];
  timeZone: string;
  accountId?: string;
  minorMode?: boolean;
  personal: Exercise[];
  favorites: string[];
  onFavorite: (id: string) => void;
  onSave: (r: Routine) => Promise<Routine>;
  onDelete: (r: Routine) => Promise<void>;
  onDeleteMany?: (routines: Routine[]) => Promise<void>;
  onReplaceRoutines?: (toDelete: Routine[], toCreate: Routine[]) => Promise<void>;
  onStart: (r: Routine, slot?: ScheduledTraining) => void;
  onOpenWorkout?: (workout: Workout) => void;
  /** Действующая разгрузка на неделю (R04-REQ02) и её отмена. */
  deload?: DeloadPlanRecord | null;
  onCancelDeload?: () => void;
  initial?: Routine | null;
  onInitialUsed?: () => void;
};
const laidCopyNotice = (week: number) => "Копия сохранена. Веса из недели " + week + ", без периодизации.";

export default function ProgramsScreen(props: Props) {
  const [editor, setEditor] = useState<Routine | null>(props.initial ?? null);
  const reduceMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<{ title: string; routines: Routine[] } | null>(null);
  const [templateChoice, setTemplateChoice] = useState<{
    id: Parameters<typeof TrainingProgram.starter>[0] | "v2";
    name: string;
  } | null>(null);
  const [picker, setPicker] = useState(false);
  /** R10: окно Лейда (создать / обновить максимумы / новый цикл), расписание на 9 недель и настройка дней недели; цикл — по общему cycleId. */
  const [laid, setLaid] = useState<{
    mode: "create" | "update" | "restart";
    cycleId?: string;
    initialVersion?: LaidVersion;
  } | null>(null);
  const [schedule, setSchedule] = useState<string | null>(null);
  const [weekEditor, setWeekEditor] = useState<string | null>(null);
  const [subsEditor, setSubsEditor] = useState<{ cycleId: string; focusOriginalId?: string } | null>(null);
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const [adjustment, setAdjustment] = useState<Pick<ScheduledTraining, "routine" | "originalDate"> | null>(null);
  const [calendarNotice, setCalendarNotice] = useState("");
  const calendarHeading = useRef<HTMLHeadingElement>(null);
  const focusCalendarAfterSave = useRef(false);
  useEffect(() => {
    if (!adjustment && focusCalendarAfterSave.current) {
      focusCalendarAfterSave.current = false;
      calendarHeading.current?.focus({ preventScroll: true });
    }
  }, [adjustment]);
  const [notice, setNotice] = useState("");
  /** Уведомление, которое покажется после сохранения копии программы Лейда. */
  const [pendingNote, setPendingNote] = useState("");
  const [removed, setRemoved] = useState<{
    entry: Routine["exercises"][number];
    index: number;
  } | null>(null);
  const [info, setInfo] = useState<Exercise | null>(null);
  const [previewRoutine, setPreviewRoutine] = useState<Routine | null>(null);
  const [previewMuscle, setPreviewMuscle] = useState<Muscle | null>(null);
  // R03-REQ03: закрытие редактора с несохранёнными правками спрашивает, а не стирает работу.
  const baseline = useRef<string | null>(null);
  const editing = !!editor;
  useEffect(() => {
    baseline.current = editing ? JSON.stringify(editorRef.current) : null;
    if (!editing) setAskClose(false);
  }, [editing]);
  const [askClose, setAskClose] = useState(false);
  const editorRef = useRef<Routine | null>(editor);
  editorRef.current = editor;
  const dirty = !!editor && baseline.current !== null && JSON.stringify(editor) !== baseline.current;
  const weightHintsKey = editor
    ? `${editor.id}|${editor.progression}|${editor.repMin}|${editor.repMax}|${editor.incrementKg}|${editor.cycle ? "c" : ""}|${editor.exercises.map((e) => `${e.exerciseId}:${e.machineInstanceId ?? ""}:${e.equipmentNote ?? ""}:${e.sets.length}`).join(",")}`
    : "";
  const weightHints = useMemo(
    () => (editorRef.current ? new TrainingProgram(editorRef.current).weightHints(props.workouts, props.timeZone) : []),
    // Пересчёт только при изменении структуры упражнений/прогрессии, не на каждый ввод названия или заметок.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weightHintsKey, props.workouts, props.timeZone],
  );
  const closeEditor = () => {
    setEditor(null);
    setAskClose(false);
    props.onInitialUsed?.();
  };
  const { initial, onInitialUsed } = props;
  useEffect(() => {
    if (initial) onInitialUsed?.();
  }, [initial, onInitialUsed]);
  const [conflict, setConflict] = useState<{ current: Routine | null } | null>(
    null,
  );
  const today = localDate(new Date(), props.timeZone);
  const hasCycle = props.routines.some((r) => !!r.cycle);
  const laidCycles = useMemo(() => LaidDupPlan.cycles(props.routines), [props.routines]);
  const nonLaidRoutines = useMemo(
    () => props.routines.filter((r) => !LaidDupPlan.periodizationOf(r)),
    [props.routines],
  );
  const laidRoutines = useMemo(
    () => LaidDupPlan.ordered(props.routines.filter((r) => !!LaidDupPlan.periodizationOf(r))),
    [props.routines],
  );
  const cycleById = (id?: string) => laidCycles.find((c) => c[0].periodization!.cycleId === id) ?? laidCycles[0];
  /** isDeload walks the whole history per routine, so it stays off the keystroke path. */
  const deloadRoutineIds = useMemo(
    () =>
      new Set(
        props.routines
          .filter((r) => new TrainingProgram(r).isDeload(props.workouts, today))
          .map((r) => r.id),
      ),
    [props.routines, props.workouts, today],
  );
  const laidEdited = editor ? LaidDupPlan.periodizationOf(editor) : undefined;
  /** R11-REQ04 / QA-R11-05: в копии Лейда подпись «Начнёшь с веса из истории» скрыта, только когда этот вес и так стоит в поле; иначе она объясняет, почему старт не с числа в поле. */
  const laidCopy = pendingNote !== "";
  /** Основной лифт программы Лейда: его подходы и веса считаются по неделе, плоской схемой не редактируются. */
  const laidLift = laidEdited
    ? LaidDupPlan.liftExerciseId(LaidDupPlan.LIFT_OF[laidEdited.day], laidEdited.substitutions)
    : null;
  const laidPlan = editor && laidEdited ? LaidDupPlan.planFor(editor, today) : null;
  const open = (routine: Routine) => {
    setPendingNote("");
    setEditor(structuredClone(routine));
    setError("");
    setConflict(null);
    props.onInitialUsed?.();
  };
  async function save(asCopy = false) {
    if (!editor) return;
    setBusy(true);
    setError("");
    try {
      TrainingProgram.validateRanges(editor);
      // Копия Лейда — обычная программа с весами плана на текущую неделю, а не недельным шаблоном при создании цикла.
      const plan = asCopy ? LaidDupPlan.planFor(editor, today) : null;
      const copied = plan
        ? editor.exercises.map((e) => (e.exerciseId === plan.liftExerciseId ? { ...e, sets: LaidDupPlan.liftSets(plan) } : e))
        : editor.exercises;
      // Периодизация с битой структурой: сервер её не примет, поэтому при сохранении поле убирается — программа становится обычной.
      const broken = !asCopy && LaidDupPlan.isBroken(editor);
      await props.onSave(
        asCopy
          ? {
              ...editor,
              exercises: copied,
              periodization: undefined,
              occurrenceOverrides: undefined,
              id: crypto.randomUUID(),
              revision: 0,
              name: (editor.name + " (копия)").slice(0, 120),
            }
          : broken
            ? { ...editor, periodization: undefined }
            : editor,
      );
      setNotice(
        broken
          ? "Периодизация программы повреждена и убрана — программа сохранена как обычная."
          : plan
            ? laidCopyNotice(plan.position.week + 1)
            : pendingNote,
      );
      setPendingNote("");
      setEditor(null);
      setConflict(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        setConflict({ current: e.data.currentRoutine ?? null });
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }
  const editOccurrence = (routine: Routine, originalDate: string) => {
    setCalendarNotice("");
    setAdjustment({ routine, originalDate });
  };
  async function saveOccurrence(destination: string | null | undefined) {
    if (!adjustment) return;
    const { routine, originalDate } = adjustment;
    await props.onSave(TrainingCalendar.withOverride(routine, originalDate, destination, props.workouts));
    setCalendarNotice(destination === undefined ? "Тренировка возвращена в план."
      : destination === null ? "Тренировка пропущена."
      : `Тренировка перенесена на ${dateLabel(destination, true)}.`);
    focusCalendarAfterSave.current = true;
    setAdjustment(null);
  }
  /** Перестановка тренировок цикла Лейда по дням недели: сохраняются только изменившиеся программы. */
  async function saveLaidWeekdays(cycle: Routine[], weekdays: Record<LaidDay, number>) {
    const updates = LaidDupPlan.withWeekdays(cycle, weekdays, props.workouts, today);
    if (!updates.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    let saved = 0;
    try {
      for (const routine of updates) {
        await props.onSave(routine);
        saved++;
      }
      const assigned = new Set(Object.values(weekdays));
      const restIdx = [0, 1, 2, 3, 4, 5, 6].find((d) => !assigned.has(d));
      setNotice(
        restIdx !== undefined
          ? `Дни цикла Лейда обновлены: выходной — ${DAY_NAMES[restIdx]}.`
          : "Дни цикла Лейда обновлены.",
      );
    } catch (e) {
      const msg =
        (e instanceof Error ? e.message : "Не удалось сохранить дни недели") +
        (saved ? ` Уже обновлено программ: ${saved} из ${updates.length} — проверь расписание и повтори.` : "");
      setError(msg);
      throw new Error(msg, { cause: e });
    } finally {
      setBusy(false);
    }
  }
  /** Применить замены упражнений ко всем шести программам цикла Лейда. */
  async function saveLaidSubstitutions(
    cycle: Routine[],
    substitutions: LaidSubstitutions | undefined,
    maxes: LaidMaxes,
    options?: { calibrationLifts?: LaidLift[]; painFlags?: LaidLift[] },
  ) {
    const first = cycle[0].periodization!;
    const position = LaidDupPlan.position(LaidDupPlan.weekOf(first.startMonday, today));
    const fromWeek = position.beforeStart ? 0 : position.week;
    const updated = LaidDupPlan.withSubstitutions(cycle, substitutions, {
      maxes,
      fromWeek,
      calibrationLifts: options?.calibrationLifts,
      painFlags: options?.painFlags,
    });
    if (!updated.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    let saved = 0;
    try {
      for (const routine of updated) {
        await props.onSave(routine);
        saved++;
      }
      const count = substitutions ? Object.keys(substitutions).length : 0;
      setNotice(
        count > 0
          ? `Замены сохранены на весь цикл Лейда (${count}): веса, периодизация и объём обновлены.`
          : "Возвращены оригинальные упражнения цикла Лейда.",
      );
    } catch (e) {
      const msg =
        (e instanceof Error ? e.message : "Не удалось сохранить замены") +
        (saved ? ` Уже обновлено программ: ${saved} из ${updated.length} — проверь список и повтори.` : "");
      setError(msg);
      throw new Error(msg, { cause: e });
    } finally {
      setBusy(false);
    }
  }
  /** Автокоррекция TM (DUP v2 гистерезис): точечное обновление максимумов с текущей недели. */
  async function applyTmAutoreg(
    cycle: Routine[],
    updates: Array<{ lift: "squat" | "bench" | "deadlift" | "ohp"; toMax: number }>,
  ) {
    if (!updates.length) return;
    const first = cycle[0].periodization!;
    const maxes = { ...first.maxes };
    for (const u of updates) maxes[u.lift] = u.toMax;
    const state = LaidDupPlan.cycleState(cycle, props.workouts, today);
    const from = state.position.beforeStart ? 0 : state.position.week;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      for (const r of cycle) {
        await props.onSave({ ...r, periodization: LaidDupPlan.withMaxes(r.periodization!, maxes, from) });
      }
      setNotice(`TM обновлён по топ-сетам DUP v2 (с недели ${from + 1}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить TM");
    } finally {
      setBusy(false);
    }
  }
  /** «Можно обновить максимум»: новые максимумы по свежим подходам, пересчёт плана с текущей недели. */
  async function recalc(cycle: Routine[]) {
    const first = cycle[0].periodization!;
    const suggestion = LaidDupPlan.suggestion(first, props.workouts, today);
    if (!suggestion.length) return;
    const maxes = { ...first.maxes };
    for (const s of suggestion) maxes[s.lift] = s.to;
    const state = LaidDupPlan.cycleState(cycle, props.workouts, today);
    const from = state.position.beforeStart ? 0 : state.position.week;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      for (const r of cycle) await props.onSave({ ...r, periodization: LaidDupPlan.withMaxes(r.periodization!, maxes, from) });
      setNotice(`Максимумы обновлены: новые веса — с недели ${from + 1}, прошлые недели не меняются.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось пересчитать план");
    } finally {
      setBusy(false);
    }
  }
  /** Автовыпуск из «Калибровки по RIR»: применить ТМ 92,5 % и включить проценты DUP. */
  async function graduateLaidCalibration(
    cycle: Routine[],
    graduations: LaidCalibrationGraduation[],
    fromWeek: number,
  ) {
    const updated = LaidDupPlan.graduateCalibration(cycle, graduations, fromWeek);
    if (!updated.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      for (const r of updated) await props.onSave(r);
      const summary = graduations
        .map((g) => `${g.exerciseName}: ТМ ${LaidDupPlan.kg(g.suggestedTm)} кг`)
        .join(", ");
      setNotice(`Проценты DUP включены (${summary}). Новые веса действуют с недели ${fromWeek + 1}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось завершить калибровку");
    } finally {
      setBusy(false);
    }
  }
  /** Вставить или отменить разгрузочную неделю в действующем цикле Лейда. */
  async function upgradeLaidCycleToV2(cycle: Routine[]) {
    setBusy(true);
    setError("");
    try {
      const upgraded = LaidDupPlan.upgradeCycleToV2(cycle);
      for (const r of upgraded) await props.onSave(r);
      setNotice(
        "Цикл обновлён до «Умного DUP v2»: ритм 3+1+3, −68 % на поясницу, закрыты икры/пресс/задняя дельта и разгрузка на 7-й неделе.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось улучшить цикл");
    } finally {
      setBusy(false);
    }
  }

  async function upgradeLaidCycleToV3(cycle: Routine[]) {
    setBusy(true);
    setError("");
    try {
      const upgraded = LaidDupPlan.upgradeCycleToV3(cycle);
      await replaceRoutinesBatch(cycle, upgraded);
      setNotice(
        "Цикл обновлён до «DUP v3 · Hypertrophy Max»: 5 дней (PPL + Upper/Lower), 5+1 нед., 8 сетов на сред. дельту и авторегуляция топ-сета.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить цикл до DUP v3");
    } finally {
      setBusy(false);
    }
  }

  const liveEnergyStatus: EnergyStatus = useMemo(() => {
    if (!props.accountId) return "optimal_surplus";
    try {
      const store = new NutritionStore(props.accountId);
      const saved = store.readRaw();
      if (!saved) return "optimal_surplus";
      const tracker = new BodyweightTracker(props.accountId, props.timeZone);
      const entries = tracker.getEntries();
      const stats = tracker.getStats();
      const eng = new AdaptiveNutritionEngine();
      const tdee = eng.tdeeEstimator.estimateTdee(
        { ...saved.profile, weightKg: stats?.currentKg ?? saved.profile.weightKg },
        entries,
        saved.logs,
        saved.goalMode,
        today,
        saved.creatineStartDate,
      );
      const bridged = eng.energyBridge.deriveEnergyStatus(tdee, saved.lastEnergyStatus);
      return bridged.energyStatus === "unknown" ? "optimal_surplus" : bridged.energyStatus;
    } catch {
      return "optimal_surplus";
    }
  }, [props.accountId, props.timeZone, today]);

  async function toggleLaidDeloadWeek(cycle: Routine[], rawWeek: number, enable: boolean) {
    const updated = LaidDupPlan.withDeloadWeek(cycle, rawWeek, enable);
    if (!updated.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      for (const r of updated) await props.onSave(r);
      setNotice(
        enable
          ? `Неделя ${rawWeek + 1} переведена в разгрузку (55–65 %, половина подходов, RIR 3–4). Следующие волны сдвинулись автоматически.`
          : `Разгрузка на неделе ${rawWeek + 1} отменена — возвращён обычный план волны.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить разгрузочную неделю");
    } finally {
      setBusy(false);
    }
  }
  async function deleteRoutinesBatch(routinesToDelete: Routine[]) {
    if (props.onDeleteMany) {
      await props.onDeleteMany(routinesToDelete);
    } else {
      for (const r of routinesToDelete) await props.onDelete(r);
    }
  }
  async function replaceRoutinesBatch(toDelete: Routine[], toCreate: Routine[]) {
    if (props.onReplaceRoutines) {
      await props.onReplaceRoutines(toDelete, toCreate);
    } else {
      for (const r of toCreate) await props.onSave(r);
      for (const r of toDelete) await props.onDelete(r);
    }
  }
  async function starter(
    kind: Parameters<typeof TrainingProgram.starter>[0] | "v2",
    mode: "add" | "replace" = "add",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const routines =
        kind === "v2"
          ? TrainingProgram.programV2()
          : TrainingProgram.starter(kind);
      if (mode === "replace" && props.routines.length > 0) {
        await replaceRoutinesBatch(props.routines, routines);
        setNotice(`Программа заменена: установлено тренировок — ${routines.length}. История тренировок сохранена.`);
      } else {
        // Same names are skipped, so a repeated click adds what is missing only.
        for (const r of routines)
          if (!props.routines.some((old) => old.name === r.name))
            await props.onSave(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить пример");
    } finally {
      setBusy(false);
    }
  }
  const updateExercise = (
    i: number,
    patch: Partial<Routine["exercises"][number]>,
  ) =>
    setEditor((r) =>
      r
        ? {
            ...r,
            exercises: r.exercises.map((e, j) =>
              i === j ? { ...e, ...patch } : e,
            ),
          }
        : r,
    );
  /**
   * A movement range is stored as a pair: the API accepts two bounds or none.
   * The first edit fills a missing opposite bound from the routine. Clearing
   * keeps the other field intact; clearing both restores the routine range.
   */
  const setRepRange = (
    index: number,
    entry: Routine["exercises"][number],
    side: "min" | "max",
    raw: string,
  ) => {
    if (!editor) return;
    updateExercise(index, TrainingProgram.editRange(editor, entry, side, raw));
  };
  useEffect(() => {
    if (!editor) setRemoved(null);
  }, [editor]);
  useEffect(() => {
    if (!removed) return;
    const timer = window.setTimeout(() => setRemoved(null), 8000);
    return () => window.clearTimeout(timer);
  }, [removed]);
  const removeExercise = (index: number) => {
    if (!editor) return;
    setRemoved({ entry: editor.exercises[index], index });
    setEditor({
      ...editor,
      exercises: editor.exercises.filter((_, i) => i !== index),
    });
  };
  const restoreExercise = () => {
    if (!removed) return;
    setEditor((r) => {
      if (!r) return r;
      const exercises = [...r.exercises];
      exercises.splice(
        Math.min(removed.index, exercises.length),
        0,
        removed.entry,
      );
      return { ...r, exercises };
    });
    setRemoved(null);
  };
  const move = (i: number, direction: number) =>
    setEditor((r) => {
      if (!r || i + direction < 0 || i + direction >= r.exercises.length)
        return r;
      const exercises = [...r.exercises];
      [exercises[i], exercises[i + direction]] = [
        exercises[i + direction],
        exercises[i],
      ];
      return { ...r, exercises };
    });
  return (
    <div className="programs-screen programs-ledger">
      {props.deload ? (
        <div className="deload-active-banner" role="status">
          <span>
            <b>Разгрузка активна до {dateLabel(props.deload.until).replace(/\.$/, "")}.</b>{" "}
            {DeloadPlan.parameters(props.deload.mode, props.deload.sets)}: программы запускаются уменьшенными, сами они не изменены.
          </span>
          {props.onCancelDeload ? (
            <button type="button" className="button secondary" onClick={props.onCancelDeload}>
              Отменить
            </button>
          ) : null}
        </div>
      ) : null}
      <ProgramWeek
        routines={props.routines}
        workouts={props.workouts}
        today={today}
        notice={calendarNotice}
        headingRef={calendarHeading}
        onAdjust={editOccurrence}
        onEdit={open}
        onStart={props.onStart}
        onOpenWorkout={props.onOpenWorkout}
      />
      {adjustment ? (
        <ScheduleOccurrenceModal
          name={adjustment.routine.name}
          originalDate={adjustment.originalDate}
          today={today}
          override={adjustment.routine.occurrenceOverrides?.find((o) => o.from === adjustment.originalDate)}
          onSave={saveOccurrence}
          onEditLaidDays={
            LaidDupPlan.periodizationOf(adjustment.routine)
              ? () => {
                  const id = LaidDupPlan.periodizationOf(adjustment.routine)!.cycleId;
                  setAdjustment(null);
                  setWeekEditor(id);
                }
              : undefined
          }
          onClose={() => setAdjustment(null)}
        />
      ) : null}
      <section className="program-library" aria-labelledby="saved-programs-title">
        <header className="section-heading routine-heading">
          <h2 id="saved-programs-title">Сохранённые программы</h2>
          <div className="routine-heading-actions">
            <m.button
              type="button"
              className="button primary"
              whileTap={reduceMotion ? undefined : { scale: 0.98 }}
              onClick={() => open({ ...TrainingProgram.empty(), name: "" })}
            >
              <Plus size={18} aria-hidden="true" />
              Создать программу
            </m.button>
          </div>
        </header>
        {error && !editor && !deleting && !deletingGroup ? <p className="error-banner" role="alert">{error}</p> : null}
        {notice && !editor ? <p className="progression-note laid-notice" role="status">{notice}</p> : null}
        {laidCycles.map((cycle) => {
          const state = LaidDupPlan.cycleState(cycle, props.workouts, today);
          const plan = state.first;
          const isFinished = !state.isCurrentDeload && state.position.finished;
          return (
            <LaidDupCard
              key={plan.cycleId}
              cycle={cycle}
              workouts={props.workouts}
              today={today}
              busy={busy}
              onSchedule={() => setSchedule(plan.cycleId)}
              onEditDays={() => setWeekEditor(plan.cycleId)}
              onEditSubstitutions={(focusOriginalId) => setSubsEditor({ cycleId: plan.cycleId, focusOriginalId })}
              onUpdate={() => setLaid({
                mode: isFinished ? "restart" : "update",
                cycleId: plan.cycleId,
              })}
              onRecalc={() => void recalc(cycle)}
              onStartDay={(r) => {
                const slot = TrainingCalendar.onDate([r], today).find((item) => !TrainingCalendar.completed(item, props.workouts));
                props.onStart(r, slot);
              }}
              onPreviewDay={(r) => {
                setPreviewMuscle(null);
                setPreviewRoutine(r);
              }}
              onEditDay={(r) => open(r)}
              onGraduateCalibration={(grads, fromWeek) => void graduateLaidCalibration(cycle, grads, fromWeek)}
              onToggleDeloadWeek={(w, enable) => void toggleLaidDeloadWeek(cycle, w, enable)}
              onUpgradeToV2={() => void upgradeLaidCycleToV2(cycle)}
              onUpgradeToV3={() => void upgradeLaidCycleToV3(cycle)}
              energyStatus={liveEnergyStatus}
              onApplyTmUpdates={(updates) => void applyTmAutoreg(cycle, updates)}
              onDeleteCycle={() => {
                setError("");
                setDeletingGroup({
                  title: `цикл «Дэвид Лейд · DUP» (${cycle.length} дн.)`,
                  routines: cycle,
                });
              }}
            />
          );
        })}
        {props.routines.length ? (
          <>
            {nonLaidRoutines.length > 0 ? (
              <div className="routine-grid">
                {nonLaidRoutines.map((r) => (
                  <ProgramRoutineCard
                    key={r.id}
                    routine={r}
                    workouts={props.workouts}
                    timeZone={props.timeZone}
                    today={today}
                    deload={deloadRoutineIds.has(r.id)}
                    onEdit={() => open(r)}
                    onStart={() => {
                      const slot = TrainingCalendar.onDate([r], today).find((item) => !TrainingCalendar.completed(item, props.workouts));
                      props.onStart(r, slot);
                    }}
                    onPreview={() => {
                      setPreviewMuscle(null);
                      setPreviewRoutine(r);
                    }}
                    onCopy={() => {
                      open({
                        ...r,
                        periodization: undefined,
                        occurrenceOverrides: undefined,
                        id: crypto.randomUUID(),
                        revision: 0,
                        name: (r.name + " (копия)").slice(0, 120),
                      });
                      setPendingNote("");
                    }}
                    onDelete={() => { setDeleting(r); setError(""); }}
                  />
                ))}
              </div>
            ) : null}
            {laidRoutines.length > 0 ? (
              <details className="laid-routines-disclosure">
                <summary className="laid-routines-summary">
                  <span className="laid-routines-summary-label">Отдельные дни цикла Лейда (шаблоны и копирование)</span>
                  <span className="laid-routines-summary-count">{laidRoutines.length} дн.</span>
                </summary>
                <div className="laid-routines-disclosure-body">
                  <div className="routine-grid">
                    {laidRoutines.map((r) => (
                      <ProgramRoutineCard
                        key={r.id}
                        routine={r}
                        workouts={props.workouts}
                        timeZone={props.timeZone}
                        today={today}
                        deload={deloadRoutineIds.has(r.id)}
                        onEdit={() => open(r)}
                        onStart={() => {
                          const slot = TrainingCalendar.onDate([r], today).find((item) => !TrainingCalendar.completed(item, props.workouts));
                          props.onStart(r, slot);
                        }}
                        onCopy={() => {
                          const cycle = LaidDupPlan.cycleOf(props.routines, r);
                          const plan = LaidDupPlan.planFor(r, today, { workouts: props.workouts, cycle });
                          open({
                            ...r,
                            exercises: plan
                              ? r.exercises.map((e) => (e.exerciseId === plan.liftExerciseId ? { ...e, sets: LaidDupPlan.liftSets(plan) } : e))
                              : r.exercises,
                            periodization: undefined,
                            occurrenceOverrides: undefined,
                            id: crypto.randomUUID(),
                            revision: 0,
                            name: (r.name + " (копия)").slice(0, 120),
                          });
                          setPendingNote(plan ? laidCopyNotice(plan.position.week + 1) : "");
                        }}
                        onDelete={() => { setDeleting(r); setError(""); }}
                      />
                    ))}
                  </div>
                </div>
              </details>
            ) : null}
            {props.routines.length >= 2 ? (
              <div className="program-library-footer">
                <button
                  type="button"
                  className="laid-utility-btn is-danger bulk-delete-btn"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setDeletingGroup({
                      title: `все программы (${props.routines.length})`,
                      routines: props.routines,
                    });
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Удалить все программы ({props.routines.length})
                </button>
              </div>
            ) : null}
          </>
        ) : <p className="program-empty">Нет сохранённых программ. Создай свою или выбери шаблон.</p>}
      </section>
      <section className="starter-plans" aria-labelledby="starter-plans-title">
        <header className="section-heading">
          <h2 id="starter-plans-title">Шаблоны</h2>
        </header>
        <div className="starter-grid">
          {([
            { id: "full", name: "Всё тело", note: "Одна программа · 3 дня" },
            { id: "split", name: "Верх / низ", note: "Две программы · 4 дня" },
            { id: "ppl", name: "Жимы / тяги / ноги", note: "Три программы · 3 дня" },
            { id: "strength", name: "База 5 × 5", note: "Три движения · 3 дня" },
            { id: "laid-v3", name: "Hypertrophy Max · DUP v3 (5 дней)", note: "Дэвид Лейд v3 · 5+1 нед. · 8 сетов сред. дельты" },
            { id: "laid", name: "Дэвид Лейд · DUP · 9 недель · 6 дней", note: laidCycles.length ? "Настроить цикл" : "Веса от 1ПМ" },
            { id: "v2", name: "Программа v2 · 5 дней", note: hasCycle ? "Добавить недостающие дни" : "Разгрузка каждую пятую неделю" },
          ] as const).map((template) => (
            <m.button
              type="button"
              className="starter-card"
              key={template.id}
              disabled={busy}
              whileTap={reduceMotion ? undefined : { scale: 0.985 }}
              onClick={() => {
                if (template.id === "laid-v3") {
                  setNotice("");
                  setLaid({ mode: "create", initialVersion: "v3" });
                } else if (template.id === "laid") {
                  setNotice("");
                  setLaid({ mode: "create", initialVersion: "v1" });
                } else if (props.routines.length > 0) {
                  setError("");
                  setTemplateChoice({ id: template.id, name: template.name });
                } else {
                  void starter(template.id, "add");
                }
              }}
            >
              <span><b>{template.name}</b><small>{template.note}</small></span>
              {template.id === "laid" || template.id === "laid-v3" ? <ChevronRight size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
            </m.button>
          ))}
        </div>
      </section>
      {laid ? (
        <LaidDupModal
          key={`${laid.mode}-${laid.initialVersion ?? "default"}`}
          mode={laid.mode}
          initialVersion={laid.initialVersion}
          routines={props.routines}
          cycle={laid.mode === "create" ? undefined : cycleById(laid.cycleId)}
          existing={laid.mode === "create" && laidCycles.length > 0}
          workouts={props.workouts}
          personal={props.personal}
          accountId={props.accountId}
          minorMode={props.minorMode}
          today={today}
          onSave={props.onSave}
          onReplaceRoutines={replaceRoutinesBatch}
          onUpgradeToV2={
            laid.mode === "create" ? undefined : () => upgradeLaidCycleToV2(cycleById(laid.cycleId))
          }
          onUpgradeToV3={
            laid.mode === "create" ? undefined : () => upgradeLaidCycleToV3(cycleById(laid.cycleId))
          }
          onClose={() => setLaid(null)}
          onDone={setNotice}
          onSwitch={(mode) => setLaid({ mode, cycleId: laidCycles[0]?.[0].periodization!.cycleId })}
        />
      ) : null}
      {schedule && cycleById(schedule) ? (
        <LaidDupSchedule
          cycle={cycleById(schedule)}
          workouts={props.workouts}
          today={today}
          busy={busy}
          onClose={() => setSchedule(null)}
          onEditDays={() => {
            const id = cycleById(schedule)[0].periodization!.cycleId;
            setSchedule(null);
            setWeekEditor(id);
          }}
          onEditSubstitutions={(focusOriginalId) => {
            const id = cycleById(schedule)[0].periodization!.cycleId;
            setSchedule(null);
            setSubsEditor({ cycleId: id, focusOriginalId });
          }}
          onUpdate={() => {
            const cycle = cycleById(schedule);
            setSchedule(null);
            setLaid({
              mode: LaidDupPlan.position(LaidDupPlan.weekOf(cycle[0].periodization!.startMonday, today)).finished ? "restart" : "update",
              cycleId: cycle[0].periodization!.cycleId,
            });
          }}
          onRecalc={() => void recalc(cycleById(schedule))}
        />
      ) : null}
      {weekEditor && cycleById(weekEditor) ? (
        <LaidWeekScheduleModal
          cycle={cycleById(weekEditor)}
          allRoutines={props.routines}
          today={today}
          onSave={(weekdays) => saveLaidWeekdays(cycleById(weekEditor), weekdays)}
          onClose={() => setWeekEditor(null)}
        />
      ) : null}
      {subsEditor && cycleById(subsEditor.cycleId) ? (
        <LaidSubstitutionsModal
          cycle={cycleById(subsEditor.cycleId)}
          workouts={props.workouts}
          personal={props.personal}
          accountId={props.accountId}
          minorMode={props.minorMode}
          today={today}
          initialFocusOriginalId={subsEditor.focusOriginalId}
          onSave={(subs, maxes, opts) => saveLaidSubstitutions(cycleById(subsEditor.cycleId), subs, maxes, opts)}
          onClose={() => setSubsEditor(null)}
        />
      ) : null}
      {previewRoutine ? (() => {
        const cycle = LaidDupPlan.periodizationOf(previewRoutine)
          ? LaidDupPlan.cycleOf(props.routines, previewRoutine)
          : undefined;
        const planned = new TrainingProgram(previewRoutine).start(
          props.workouts,
          props.timeZone,
          today,
          undefined,
          cycle ? { cycle } : undefined,
        );
        return (
          <Modal
            title={`Превью · ${previewRoutine.name}`}
            wide
            onClose={() => {
              setPreviewRoutine(null);
              setPreviewMuscle(null);
            }}
          >
            <div className="program-preview-modal">
              <WorkoutPreviewCard
                planned={planned}
                history={props.workouts}
                today={today}
                timeZone={props.timeZone}
                selectedMuscle={previewMuscle}
                onSelectMuscle={setPreviewMuscle}
              />
              <ol className="plan-exercises program-preview-list">
                {planned.exercises.map((ex, idx) => {
                  const def = exerciseForEntry(ex);
                  const firstW = ex.sets.find((s) => !s.warmup);
                  const hits =
                    previewMuscle !== null &&
                    def !== undefined &&
                    (def.primary.includes(previewMuscle) || def.secondary.includes(previewMuscle));
                  const dim = previewMuscle !== null && !hits;
                  return (
                    <li
                      key={`${ex.exerciseId}:${idx}`}
                      className={hits ? "is-muscle-hit" : dim ? "is-muscle-dim" : undefined}
                    >
                      <span className="plan-number" aria-hidden="true">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="plan-exercise-name">{entryName(ex)}</span>
                      <b>
                        {PlanLine.sets(ex)}
                        {firstW?.weight ? ` · ${fmt(firstW.weight)} кг` : ""}
                      </b>
                    </li>
                  );
                })}
              </ol>
              <div className="program-preview-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    const target = previewRoutine;
                    setPreviewRoutine(null);
                    setPreviewMuscle(null);
                    const slot = TrainingCalendar.onDate([target], today).find(
                      (item) => !TrainingCalendar.completed(item, props.workouts),
                    );
                    props.onStart(target, slot);
                  }}
                >
                  <Play size={16} fill="currentColor" aria-hidden="true" />
                  Начать тренировку
                </button>
              </div>
            </div>
          </Modal>
        );
      })() : null}
      {editor ? (
        <Modal
          title={
            editor.revision ? "Редактировать программу" : "Новая программа"
          }
          wide
          onClose={() => {
            if (busy) return false;
            if (dirty) {
              setAskClose(true);
              return false;
            }
            closeEditor();
          }}
        >
          <form
            className="product-form routine-editor"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Название программы
                <input
                  required
                  maxLength={120}
                  placeholder="Например, Мой push"
                  data-autofocus={editor.revision === 0 && editor.name === "" ? "" : undefined}
                  value={editor.name}
                  onChange={(e) =>
                    setEditor({ ...editor, name: e.target.value })
                  }
                />
              </label>
              <div>
                <p className="field-caption">Дни недели</p>
                <div className="day-picker">
                  {DAY_NAMES.map((d, i) => (
                    <button
                      type="button"
                      key={d}
                      aria-pressed={editor.days.includes(i)}
                      className={editor.days.includes(i) ? "active" : ""}
                      onClick={() =>
                        setEditor({
                          ...editor,
                          days: editor.days.includes(i)
                            ? editor.days.filter((x) => x !== i)
                            : [...editor.days, i].sort(),
                        })
                      }
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-grid">
                <label>
                  Отдых, секунды
                  <input
                    type="number"
                    min={15}
                    max={600}
                    required
                    value={editor.restSeconds}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        restSeconds: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Правило прогрессии
                  <Select
                    value={editor.progression}
                    onChange={(v) =>
                      setEditor({
                        ...editor,
                        progression: v as Routine["progression"],
                      })
                    }
                    options={[
                      { value: "repeat", label: "Повторять веса и повторы" },
                      { value: "double", label: "Двойная прогрессия" },
                    ]}
                  />
                </label>
              </div>
              {editor.progression === "double" ? (
                <>
                  <div className="form-grid three">
                    <label>
                      Повторы от
                      <input
                        type="number"
                        min={1}
                        max={200}
                        required
                        value={editor.repMin}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            repMin: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Повторы до
                      <input
                        type="number"
                        min={editor.repMin}
                        max={200}
                        required
                        value={editor.repMax}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            repMax: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Шаг веса, кг
                      <input
                        type="number"
                        min={0.25}
                        max={50}
                        step={0.25}
                        required
                        value={editor.incrementKg}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            incrementKg: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <p className="tiny">
                    Прибавка предлагается для проверенных свободных весов, когда
                    все запланированные рабочие подходы выполнены на верхней
                    границе. Для остальных вариантов сохраняется прежний вес.
                  </p>
                </>
              ) : null}
              <div className="routine-editor-exercises">
                <p className="tiny">
                  У каждого упражнения может быть свой диапазон повторений.
                  Пустые поля «Повторы от» и «Повторы до» означают общий
                  диапазон программы.
                </p>
                {editor.exercises.map((entry, index) => {
                  const exercise = exerciseForEntry(entry)!,
                    spec = exercise.recording;
                  return (
                    <article
                      className="routine-editor-exercise"
                      key={entry.exerciseId}
                    >
                      <div className="routine-editor-head">
                        <div>
                          <span className="eyebrow">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <h3>{entryName(entry)}</h3>
                        </div>
                        <div className="routine-order-controls">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Заменить ${entryName(entry)}`}
                            title="Заменить упражнение"
                            onClick={() => setSwapIndex(index)}
                          >
                            <ArrowLeftRight size={16} />
                          </button>
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            Выше
                          </button>
                          <button
                            type="button"
                            disabled={index === editor.exercises.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            Ниже
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Убрать из программы ${entryName(entry)}`}
                            onClick={() => removeExercise(index)}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </div>
                      {laidLift === entry.exerciseId ? (
                        <p className="laid-editor-note" data-testid="laid-editor-note">
                          Схема Лейда: веса и подходы считаются по неделе цикла; меняются максимумы и дни.
                          {laidPlan ? <span> Сейчас: {LaidDupPlan.line(laidPlan)}.</span> : null}
                        </p>
                      ) : null}
                      <div className="routine-fields" hidden={laidLift === entry.exerciseId} aria-hidden={laidLift === entry.exerciseId ? true : undefined}>
                        <label>
                          Подходы
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={entry.sets.length}
                            onChange={(e) => {
                              const count = Math.max(
                                1,
                                Math.min(30, Number(e.target.value) || 1),
                              );
                              updateExercise(index, {
                                sets: Array.from(
                                  { length: count },
                                  (_, i) =>
                                    entry.sets[i] ?? {
                                      ...makeSets(
                                        1,
                                        entry.sets[0]?.weight,
                                        entry.sets[0]?.reps,
                                      )[0],
                                      ...(spec.type === "duration"
                                        ? {
                                            rir: null,
                                            durationSeconds:
                                              entry.sets[0]?.durationSeconds ??
                                              30,
                                          }
                                        : {}),
                                    },
                                ),
                              });
                            }}
                          />
                        </label>
                        <label>
                          {spec.type === "duration" ? "Секунды" : "Повторы"}
                          <input
                            type="number"
                            min={1}
                            max={spec.type === "duration" ? 86400 : 200}
                            value={
                              spec.type === "duration"
                                ? (entry.sets[0].durationSeconds ?? 30)
                                : entry.sets[0].reps
                            }
                            onChange={(e) =>
                              updateExercise(index, {
                                sets: entry.sets.map((s) => ({
                                  ...s,
                                  ...(spec.type === "duration"
                                    ? {
                                        durationSeconds: Number(e.target.value),
                                      }
                                    : { reps: Number(e.target.value) }),
                                })),
                              })
                            }
                          />
                        </label>
                        <label>
                          {spec.loadMode === "assisted_bodyweight"
                            ? "Помощь, кг"
                            : "Вес, кг"}
                          <input
                            aria-label={
                              spec.loadMode === "assisted_bodyweight"
                                ? "Помощь, кг"
                                : "Начальный вес, кг"
                            }
                            type="number"
                            min={0}
                            max={1000}
                            step={0.5}
                            disabled={spec.loadMode === "bodyweight"}
                            value={
                              spec.loadMode === "assisted_bodyweight"
                                ? (entry.sets[0].assistanceKg ?? 0)
                                : entry.sets[0].weight
                            }
                            onChange={(e) =>
                              updateExercise(index, {
                                sets: entry.sets.map((s) => ({
                                  ...s,
                                  ...(spec.loadMode === "assisted_bodyweight"
                                    ? {
                                        assistanceKg: Number(e.target.value),
                                        weight: 0,
                                      }
                                    : { weight: Number(e.target.value) }),
                                })),
                              })
                            }
                          />
                        </label>
                      </div>
                      <details className="routine-more" hidden={laidLift === entry.exerciseId}>
                        <summary>
                          <span>Ещё</span>
                            {spec.loadMode !== "bodyweight" && weightHints[index] && !(laidCopy && weightHints[index].source === "history" && weightHints[index].weightKg === (entry.sets.find((s) => !s.warmup)?.weight ?? 0)) ? (
                              <span className={`weight-source ${weightHints[index].source}`} data-source={weightHints[index].source}>
                                {weightHints[index].source === "history"
                                  ? `Начнёшь с веса из истории: ${fmt(weightHints[index].weightKg!)} кг`
                                  : weightHints[index].source === "plan"
                                    ? `Вес по плану: ${fmt(weightHints[index].weightKg!)} кг`
                                    : "Вес не задан — введи его или впиши в тренировке"}
                              </span>
                            ) : null}
                        </summary>
                        <div className="form-grid">
                          <label>
                            Повторы от
                            <input
                              type="number"
                              min={1}
                              max={200}
                              inputMode="numeric"
                              placeholder={String(editor.repMin)}
                              value={entry.repMin ?? ""}
                              onChange={(e) =>
                                setRepRange(index, entry, "min", e.target.value)
                              }
                            />
                          </label>
                          <label>
                            Повторы до
                            <input
                              type="number"
                              min={1}
                              max={200}
                              inputMode="numeric"
                              placeholder={String(editor.repMax)}
                              value={entry.repMax ?? ""}
                              onChange={(e) =>
                                setRepRange(index, entry, "max", e.target.value)
                              }
                            />
                          </label>
                        </div>
                        {["machine_stack", "assisted_bodyweight"].includes(
                          spec.loadMode,
                        ) ? (
                          <label>
                            Тренажёр / блок
                            <input
                              maxLength={120}
                              value={entry.equipmentNote ?? ""}
                              onChange={(e) =>
                                updateExercise(index, {
                                  equipmentNote: e.target.value,
                                })
                              }
                              placeholder="Название или расположение машины"
                            />
                          </label>
                        ) : null}
                      </details>
                    </article>
                  );
                })}
              </div>
              {removed ? (
                <div className="undo-bar" role="status">
                  <span>Упражнение убрано</span>
                  <button type="button" onClick={restoreExercise}>
                    Отменить
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className="button secondary full-width"
                disabled={editor.exercises.length >= 30}
                onClick={() => setPicker(true)}
              >
                <Plus size={18} />
                Добавить упражнение в программу
              </button>
              <label>
                Заметки к программе
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={editor.notes}
                  onChange={(e) =>
                    setEditor({ ...editor, notes: e.target.value })
                  }
                />
              </label>
              {error ? (
                <p className="error-banner" role="alert">
                  {error}
                </p>
              ) : null}
              {conflict ? (
                <div className="conflict-actions">
                  {conflict.current ? (
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => open(conflict.current!)}
                    >
                      Загрузить актуальную версию
                    </button>
                  ) : null}
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => void save(true)}
                  >
                    Сохранить отдельную копию
                  </button>
                </div>
              ) : null}
              <button
                className="button primary full-width"
                type="submit"
                disabled={!editor.exercises.length}
              >
                <Save size={17} />
                {busy ? "Сохраняем…" : "Сохранить программу"}
              </button>
            </fieldset>
          </form>
        </Modal>
      ) : null}
      {editor && swapIndex !== null && editor.exercises[swapIndex] && exerciseForEntry(editor.exercises[swapIndex]) ? (
        <ExerciseSwapModal
          currentExercise={exerciseForEntry(editor.exercises[swapIndex])!}
          workouts={props.workouts}
          today={today}
          personal={props.personal}
          excludeIds={editor.exercises.filter((_, i) => i !== swapIndex).map((e) => e.exerciseId)}
          requireWeighted={laidLift === editor.exercises[swapIndex].exerciseId}
          subtitle={
            laidEdited
              ? "Замена изменит этот день; чтобы заменить упражнение во всех днях цикла сразу, открой «Замены» на карточке Лейда."
              : undefined
          }
          onSwap={(nextEx) => {
            const target = editor.exercises[swapIndex];
            const isDuration = nextEx.recording.type === "duration";
            const fresh = makeExerciseEntry(nextEx.id);
            const nextEntry = {
              ...fresh,
              sets: target.sets.map((s) => ({
                ...s,
                id: crypto.randomUUID(),
                weight: 0,
                done: false,
                ...(isDuration ? { reps: 0, durationSeconds: s.durationSeconds ?? 45 } : {}),
              })),
              ...(isDuration ? {} : { repMin: target.repMin, repMax: target.repMax }),
            };
            const nextExercises = editor.exercises.map((e, i) => (i === swapIndex ? nextEntry : e));
            let nextPeriodization = editor.periodization;
            if (laidEdited) {
              const origLift = LaidDupPlan.LIFT_EXERCISE[LaidDupPlan.LIFT_OF[laidEdited.day]];
              const currentLift = LaidDupPlan.liftExerciseId(LaidDupPlan.LIFT_OF[laidEdited.day], laidEdited.substitutions);
              if (target.exerciseId === currentLift) {
                const merged = LaidDupPlan.normalizeSubstitutions({
                  ...(laidEdited.substitutions ?? {}),
                  [origLift]: nextEx.id,
                });
                nextPeriodization = { ...laidEdited, ...(merged ? { substitutions: merged } : {}) };
                if (!merged) delete nextPeriodization.substitutions;
              }
            }
            setEditor({ ...editor, exercises: nextExercises, periodization: nextPeriodization });
            setSwapIndex(null);
          }}
          onClose={() => setSwapIndex(null)}
        />
      ) : null}
      {picker && editor ? (
        <Modal
          title="Упражнения для программы"
          wide
          onClose={() => setPicker(false)}
        >
          <Suspense fallback={<p>Открываем библиотеку…</p>}>
            <ExerciseLibrary
              picker
              personal={props.personal}
              favorites={props.favorites}
              onFavorite={props.onFavorite}
              onDetail={(id) => setInfo(exerciseById(id) ?? null)}
              selectedIds={editor.exercises.map((e) => e.exerciseId)}
              limitReached={editor.exercises.length >= 30}
              onAdd={(id) =>
                setEditor((r) =>
                  r &&
                  !r.exercises.some((e) => e.exerciseId === id) &&
                  r.exercises.length < 30
                    ? {
                        ...r,
                        exercises: [...r.exercises, makeExerciseEntry(id)],
                      }
                    : r,
                )
              }
            />
          </Suspense>
          <button
            className="button primary full-width"
            onClick={() => setPicker(false)}
          >
            Готово
          </button>
        </Modal>
      ) : null}
      {info && editor ? (
        <Modal title={info.name} onClose={() => setInfo(null)}>
          <ExerciseInfo
            exercise={info}
            disabled={
              editor.exercises.some((e) => e.exerciseId === info.id) ||
              editor.exercises.length >= 30
            }
            onAdd={() => {
              setEditor({
                ...editor,
                exercises: [...editor.exercises, makeExerciseEntry(info.id)],
              });
              setInfo(null);
            }}
          />
        </Modal>
      ) : null}
      {editor && askClose ? (
        <Modal title="Сохранить программу?" onClose={() => setAskClose(false)}>
          <p>В программе «{editor.name || "без названия"}» есть несохранённые правки.</p>
          {!editor.exercises.length ? (
            <p className="tiny">Чтобы сохранить, добавь хотя бы одно упражнение.</p>
          ) : null}
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={busy || !editor.exercises.length}
              onClick={() => {
                setAskClose(false);
                void save();
              }}
            >
              Сохранить
            </button>
            <button className="button danger" disabled={busy} onClick={closeEditor}>
              Не сохранять
            </button>
            <button className="button secondary" onClick={() => setAskClose(false)}>
              Продолжить правку
            </button>
          </div>
        </Modal>
      ) : null}
      {deleting ? (
        <Modal
          title="Удалить программу?"
          onClose={() => {
            if (busy) return false;
            setDeleting(null);
          }}
        >
          <p>
            «{deleting.name}» исчезнет из плана. Сохранённые тренировки
            останутся.
          </p>
          {error ? (
            <p className="error-banner" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              data-autofocus=""
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await props.onDelete(deleting);
                  setDeleting(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Ошибка удаления");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Удаляем…" : "Удалить программу"}
            </button>
          </div>
        </Modal>
      ) : null}
      {deletingGroup ? (
        <Modal
          title="Удалить программы разом?"
          onClose={() => {
            if (busy) return false;
            setDeletingGroup(null);
          }}
        >
          <p>
            Будут удалены {deletingGroup.title}. Вся сохранённая история тренировок останется на месте.
          </p>
          <ul className="bulk-delete-list" aria-label="Удаляемые программы">
            {deletingGroup.routines.map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
          {error ? (
            <p className="error-banner" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button
              type="button"
              className="button secondary"
              data-autofocus=""
              disabled={busy}
              onClick={() => setDeletingGroup(null)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const count = deletingGroup.routines.length;
                  await deleteRoutinesBatch(deletingGroup.routines);
                  setDeletingGroup(null);
                  setNotice(`Удалено программ: ${count}. История тренировок сохранена.`);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Ошибка удаления программ");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Удаляем…" : `Удалить (${deletingGroup.routines.length})`}
            </button>
          </div>
        </Modal>
      ) : null}
      {templateChoice ? (
        <Modal
          title={`Установить «${templateChoice.name}»?`}
          onClose={() => {
            if (busy) return false;
            setTemplateChoice(null);
          }}
        >
          <p>
            У тебя уже есть сохранённые программы ({props.routines.length}). Можно заменить их разом на «{templateChoice.name}» или добавить шаблон к текущим. История тренировок сохранится.
          </p>
          {error ? (
            <p className="error-banner" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={async () => {
                const chosen = templateChoice;
                setTemplateChoice(null);
                await starter(chosen.id, "replace");
              }}
            >
              Заменить текущие ({props.routines.length})
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                const chosen = templateChoice;
                setTemplateChoice(null);
                await starter(chosen.id, "add");
              }}
            >
              Добавить к текущим
            </button>
            <button
              type="button"
              className="button secondary"
              data-autofocus=""
              disabled={busy}
              onClick={() => setTemplateChoice(null)}
            >
              Отмена
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
