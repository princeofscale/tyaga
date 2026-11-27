import { addCalendarDays } from "../lib/calendar";
import { MUSCLES } from "../data/muscles";
import { PeriodizationRules } from "./PeriodizationRules";
import { OneRepMaxFormulas } from "./OneRepMaxFormulas";
import { DeloadEngine } from "./DeloadEngine";
import { ProgressionEngine } from "./ProgressionEngine";
import { SubstitutionPolicy, type PrescriptionMode, type SubstitutionClass } from "./SubstitutionPolicy";
import { entryName, estimatedOneRepMax, exerciseById, exerciseForEntry, makeExerciseEntry, makeSets } from "../lib/model";
import { quantity } from "../lib/quantity";
import type {
  LaidDay,
  LaidMaxes,
  Muscle,
  Routine,
  RoutinePeriodization,
  SetEntry,
  Workout,
  WorkoutExercise,
} from "../lib/types";
import {
  ACCESSORY_RIR_RAMP_V3,
  computeNextWeekLoad,
  DAVID_LAID_DUP_V3_LIVE_PLAN,
  getV3DayByLaidDay,
  LAID_V3_DAYS,
  LAID_V3_DELOAD_WEEK,
  LAID_V3_NAMES,
  LAID_V3_RDL_FROM_DL_FACTOR,
  LAID_V3_REST_SUMMARY,
  LAID_V3_SHORT,
  LAID_V3_SUMMARY_BULLETS,
  LAID_V3_TM_FACTOR,
  LAID_V3_WEEKDAYS,
  LAID_V3_WEEKS,
  mesocycleWeekFromZeroBased,
  roundPlate,
  v3StimulusForWeek,
  WAVE_MATRIX_V3,
  type EnergyStatus,
} from "./LaidDupV3";
import { BiomechanicsProfileStore } from "./BiomechanicsProfile";
import {
  daysForVersion,
  LAID_AUTO_NOTICE,
  LAID_DELOAD_NOTICE,
  LAID_HEAVY_PCT,
  LAID_LIFT_EXERCISE,
  LAID_LIFT_LABEL,
  LAID_LIFT_OF,
  LAID_LOAD_NOTICE,
  LAID_NAMES,
  LAID_NOTICE,
  LAID_ORIGINAL,
  LAID_PLAN_MARK,
  LAID_REST_SUMMARY,
  LAID_RHYTHM_WEEKDAYS,
  LAID_SCHEME,
  LAID_SHORT,
  LAID_LONG_LEVERS_SUBS,
  LAID_SPINE_FRIENDLY_SUBS,
  LAID_TRAINING_MAX_FACTOR,
  LAID_V2_DELOAD_WEEK,
  LAID_V2_MAIN_MATRIX,
  LAID_V2_PULL2_ROW,
  LAID_V2_STIMULUS,
  LAID_V2_SUMMARY_BULLETS,
  LAID_V2_TM_FACTOR,
  LAID_V2_TRAP_MATRIX,
  LAID_WAVE_META,
  LAID_WEEKDAY,
  LAID_WEEKS,
  LAID_WORK_PCT,
  MAX_KG,
  WAVE_WEEKS,
  isAxialExercise,
  laidAuxReps,
  laidOriginalIds,
  layoutForVersion,
  liftExerciseForDay,
  resolveLaidExerciseId,
  type HeavyScheme,
  type LaidAutoUpdate,
  type LaidAuxProgressionHint,
  type LaidCalibrationGraduation,
  type LaidCycleState,
  type LaidCycleSummary,
  type LaidDayExercisePreview,
  type LaidDayPlan,
  type LaidExerciseGuidance,
  type LaidExerciseSpec,
  type LaidLastSetSummary,
  type LaidLift,
  type LaidPlanSet,
  type LaidPosition,
  type LaidRhythm,
  type LaidSlotInfo,
  type LaidStimulus,
  type LaidSubstitutions,
  type LaidVersion,
  type LaidVolumeSummary,
  type LaidWaveLiftProgress,
  type LaidWaveWeekPoint,
  type LaidWeekGuide,
  type LaidWeekSlot,
  type WorkReps,
} from "./laidDupData";
import {
  buildAuxProgressionHint,
  buildExerciseGuidance,
  buildExerciseSpec,
  buildWeekGuide,
  buildWeekLabel,
  calcRestSecondsForSet,
  formatCompactDayLine,
  formatDayDescription,
  formatDayLine,
  formatKg,
  formatPct,
  repsWord,
} from "./laidDupGuidance";

export { LAID_WEEKS };
export type {
  LaidAutoUpdate,
  LaidAuxProgressionHint,
  LaidCalibrationGraduation,
  LaidCycleState,
  LaidCycleSummary,
  LaidDay,
  LaidDayExercisePreview,
  LaidDayPlan,
  LaidExerciseGuidance,
  LaidExerciseSpec,
  LaidLastSetSummary,
  LaidLift,
  LaidPlanSet,
  LaidPosition,
  LaidRhythm,
  LaidSlotInfo,
  LaidStimulus,
  LaidSubstitutions,
  LaidVersion,
  LaidVolumeSummary,
  LaidWaveLiftProgress,
  LaidWaveWeekPoint,
  LaidWeekGuide,
  LaidWeekSlot,
};

/**
 * Программа Дэвида Лейда (DUP, 9 недель, 6 дней) по распространяемой таблице `David Laid DUP Program.xlsx`.
 * Схема недель и волн — по таблице; данные и таблицы лежат в `laidDupData.ts`, гайды/RIR/отдых/прогрессия — в `laidDupGuidance.ts`.
 */
export class LaidDupPlan {
  static readonly DAYS: LaidDay[] = PeriodizationRules.DAYS;
  static readonly REST_SECONDS = 180;
  static readonly NAMES = LAID_NAMES;
  static readonly SHORT = LAID_SHORT;
  static readonly ORIGINAL = LAID_ORIGINAL;
  static readonly WEEKDAY = LAID_WEEKDAY;
  static readonly RHYTHM_WEEKDAYS = LAID_RHYTHM_WEEKDAYS;
  static readonly WAVE_META = LAID_WAVE_META;
  static readonly LIFT_OF = LAID_LIFT_OF;
  static readonly LIFT_EXERCISE = LAID_LIFT_EXERCISE;
  static readonly LIFT_LABEL = LAID_LIFT_LABEL;
  static readonly ESTIMATE_DAYS = 182;
  static readonly SUGGEST_DAYS = 28;
  static readonly NOTICE = LAID_NOTICE;
  static readonly AUTO_NOTICE = LAID_AUTO_NOTICE;
  static readonly LOAD_NOTICE = LAID_LOAD_NOTICE;
  static readonly DELOAD_NOTICE = LAID_DELOAD_NOTICE;
  static readonly REST_SUMMARY = LAID_REST_SUMMARY;
  static readonly TRAINING_MAX_FACTOR = LAID_TRAINING_MAX_FACTOR;
  static readonly SPINE_FRIENDLY_SUBS = LAID_SPINE_FRIENDLY_SUBS;
  static readonly LONG_LEVERS_SUBS = LAID_LONG_LEVERS_SUBS;
  static readonly V2_SUMMARY_BULLETS = LAID_V2_SUMMARY_BULLETS;
  static readonly V2_TM_FACTOR = LAID_V2_TM_FACTOR;
  static readonly V2_DELOAD_WEEK = LAID_V2_DELOAD_WEEK;
  static readonly V3_SUMMARY_BULLETS = LAID_V3_SUMMARY_BULLETS;
  static readonly V3_TM_FACTOR = LAID_V3_TM_FACTOR;
  static readonly V3_DELOAD_WEEK = LAID_V3_DELOAD_WEEK;
  static readonly V3_WEEKS = LAID_V3_WEEKS;
  static readonly V3_DAYS = LAID_V3_DAYS;
  static readonly V3_WEEKDAYS = LAID_V3_WEEKDAYS;
  static readonly V3_NAMES = LAID_V3_NAMES;
  static readonly V3_SHORT = LAID_V3_SHORT;

  static dayShort(day: LaidDay, version?: LaidVersion): string {
    return version === "v3" ? LAID_V3_SHORT[day] : LAID_SHORT[day];
  }

  static dayName(day: LaidDay, version?: LaidVersion): string {
    return version === "v3" ? LAID_V3_NAMES[day] : LAID_NAMES[day];
  }
  static readonly PLAN_MARK = LAID_PLAN_MARK;
  static readonly MAX_KG = MAX_KG;

  static windowText(days: number): string {
    return days % 7 === 0 && days > 28
      ? `за ${quantity(days / 7, "неделю", "недели", "недель")}`
      : `за ${quantity(days, "день", "дня", "дней")}`;
  }

  static slotsForRhythm(rhythm: LaidRhythm): LaidWeekSlot[] {
    const slots: LaidWeekSlot[] = Array.from({ length: 7 }, () => null);
    const map = LAID_RHYTHM_WEEKDAYS[rhythm];
    for (const day of LaidDupPlan.DAYS) slots[map[day]] = day;
    return slots;
  }

  static weekdaysFromSlots(slots: readonly LaidWeekSlot[]): Record<LaidDay, number> {
    const out: Partial<Record<LaidDay, number>> = {};
    slots.forEach((slot, weekday) => {
      if (slot && weekday >= 0 && weekday <= 6 && out[slot] === undefined) out[slot] = weekday;
    });
    for (const day of LaidDupPlan.DAYS) {
      if (out[day] === undefined) out[day] = LAID_WEEKDAY[day];
    }
    return out as Record<LaidDay, number>;
  }

  static slotsForV3(): LaidWeekSlot[] {
    const slots: LaidWeekSlot[] = Array.from({ length: 7 }, () => null);
    for (const day of LAID_V3_DAYS) slots[LAID_V3_WEEKDAYS[day]] = day;
    return slots;
  }

  static slotsFromCycle(cycle: readonly Routine[]): LaidWeekSlot[] {
    const slots: LaidWeekSlot[] = Array.from({ length: 7 }, () => null);
    const unplaced: LaidDay[] = [];
    const byDay = new Map<LaidDay, Routine>();
    let firstVersion: LaidVersion | undefined;
    for (const r of cycle) {
      const p = LaidDupPlan.periodizationOf(r);
      if (p) {
        if (!firstVersion) firstVersion = p.version;
        if (!byDay.has(p.day)) byDay.set(p.day, r);
      }
    }
    const targetDays = daysForVersion(firstVersion);
    for (const day of targetDays) {
      const r = byDay.get(day);
      const preferred = r?.days.length ? r.days[0] : firstVersion === "v3" ? LAID_V3_WEEKDAYS[day] : LAID_WEEKDAY[day];
      if (preferred >= 0 && preferred <= 6 && slots[preferred] === null) slots[preferred] = day;
      else unplaced.push(day);
    }
    for (const day of unplaced) {
      const free = slots.indexOf(null);
      if (free !== -1) slots[free] = day;
    }
    return slots;
  }

  static moveSlot(slots: readonly LaidWeekSlot[], fromIndex: number, toIndex: number): LaidWeekSlot[] {
    const from = Math.max(0, Math.min(slots.length - 1, Math.trunc(fromIndex)));
    const to = Math.max(0, Math.min(slots.length - 1, Math.trunc(toIndex)));
    if (from === to) return [...slots];
    const next = [...slots];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  }

  static swapSlots(slots: readonly LaidWeekSlot[], a: number, b: number): LaidWeekSlot[] {
    if (a === b || a < 0 || b < 0 || a >= slots.length || b >= slots.length) return [...slots];
    const next = [...slots];
    [next[a], next[b]] = [next[b], next[a]];
    return next;
  }

  static assignDay(slots: readonly LaidWeekSlot[], day: LaidDay, targetWeekday: number): LaidWeekSlot[] {
    const from = slots.indexOf(day);
    if (from === -1 || targetWeekday < 0 || targetWeekday >= slots.length) return [...slots];
    return LaidDupPlan.swapSlots(slots, from, targetWeekday);
  }

  static matchingRhythm(slots: readonly LaidWeekSlot[]): LaidRhythm | "custom" {
    for (const rhythm of ["6x1", "3x1x3"] as const) {
      const preset = LaidDupPlan.slotsForRhythm(rhythm);
      if (preset.length === slots.length && preset.every((slot, idx) => slot === slots[idx])) return rhythm;
    }
    return "custom";
  }

  static restWeekday(slots: readonly LaidWeekSlot[]): number | null {
    const idx = slots.indexOf(null);
    return idx === -1 ? null : idx;
  }

  static backToBackNotice(slots: readonly LaidWeekSlot[], dayNames: readonly string[]): string[] {
    const pairs: [LaidDay, LaidDay, string][] = [
      ["legs1", "legs2", "присед два дня подряд"],
      ["push1", "push2", "жимы два дня подряд"],
      ["pull1", "pull2", "становая два дня подряд"],
    ];
    const notes: string[] = [];
    for (const [a, b, reason] of pairs) {
      const ia = slots.indexOf(a);
      const ib = slots.indexOf(b);
      if (ia === -1 || ib === -1) continue;
      const adjacent = Math.abs(ia - ib) === 1 || (ia === 0 && ib === 6) || (ia === 6 && ib === 0);
      if (!adjacent) continue;
      const first = (ia === 6 && ib === 0) ? ia : (ib === 6 && ia === 0) ? ib : Math.min(ia, ib);
      const second = first === ia ? ib : ia;
      notes.push(
        `${LAID_SHORT[slots[first]!]} и ${LAID_SHORT[slots[second]!]} стоят подряд (${dayNames[first]}–${dayNames[second]}) — ${reason}, следи за восстановлением.`,
      );
    }
    return notes;
  }

  static weekdayOf(routine: Routine): number {
    return routine.days.length ? Math.min(...routine.days) : 7;
  }

  private static compareCycleRoutines(x: Routine, y: Routine): number {
    const dx = LaidDupPlan.weekdayOf(x) - LaidDupPlan.weekdayOf(y);
    if (dx !== 0) return dx;
    return (
      LaidDupPlan.DAYS.indexOf(LaidDupPlan.periodizationOf(x)!.day) -
      LaidDupPlan.DAYS.indexOf(LaidDupPlan.periodizationOf(y)!.day)
    );
  }

  static withWeekdays(
    cycle: readonly Routine[],
    weekdays: Record<LaidDay, number>,
    workouts: readonly Workout[],
    today: string,
  ): Routine[] {
    const changed: Routine[] = [];
    for (const r of cycle) {
      const p = LaidDupPlan.periodizationOf(r);
      if (!p) continue;
      const targetDay = weekdays[p.day];
      if (!Number.isInteger(targetDay) || targetDay < 0 || targetDay > 6) continue;
      const overrides = r.occurrenceOverrides ?? [];
      const kept = overrides.filter((o) => {
        if (workouts.some((w) => w.routineId === r.id && w.programDate === o.from)) return true;
        if (o.from < today && (o.to === null || o.to < today)) return true;
        const fromWeekday = (new Date(o.from + "T12:00:00Z").getUTCDay() + 6) % 7;
        return fromWeekday === targetDay;
      });
      const sameDays = r.days.length === 1 && r.days[0] === targetDay;
      const sameOverrides = kept.length === overrides.length;
      if (!sameDays || !sameOverrides) {
        changed.push({
          ...r,
          days: [targetDay],
          occurrenceOverrides: kept.length ? kept : undefined,
        });
      }
    }
    return changed.sort(LaidDupPlan.compareCycleRoutines);
  }

  static trainingMaxFrom1Rm(oneRepMaxKg: number, factor = LAID_TRAINING_MAX_FACTOR): number {
    if (!Number.isFinite(oneRepMaxKg) || oneRepMaxKg <= 0) return 0;
    return Math.max(2.5, LaidDupPlan.roundKg(oneRepMaxKg * factor));
  }

  static isSpineFriendly(subs?: LaidSubstitutions): boolean {
    if (!subs) return false;
    return Object.entries(LAID_SPINE_FRIENDLY_SUBS).every(([from, to]) => subs[from] === to);
  }

  static toggleSpineFriendly(subs: LaidSubstitutions | undefined, enable: boolean): LaidSubstitutions {
    const next: LaidSubstitutions = { ...(subs ?? {}) };
    for (const [from, to] of Object.entries(LAID_SPINE_FRIENDLY_SUBS)) {
      if (enable) next[from] = to;
      else if (next[from] === to) delete next[from];
    }
    return next;
  }

  static isLongLevers(subs?: LaidSubstitutions): boolean {
    if (!subs) return false;
    return Object.entries(LAID_LONG_LEVERS_SUBS).every(([from, to]) => subs[from] === to);
  }

  static toggleLongLevers(subs: LaidSubstitutions | undefined, enable: boolean): LaidSubstitutions {
    const next: LaidSubstitutions = { ...(subs ?? {}) };
    for (const [from, to] of Object.entries(LAID_LONG_LEVERS_SUBS)) {
      if (enable) next[from] = to;
      else if (next[from] === to) delete next[from];
    }
    return next;
  }

  static totalWeeks(p?: Pick<RoutinePeriodization, "deloadWeeks" | "version">): number {
    if (p?.version === "v3") return LAID_V3_WEEKS;
    if (!p?.deloadWeeks?.length) return LAID_WEEKS;
    const midDeloads = p.deloadWeeks.filter((w) => w < LAID_WEEKS).length;
    const maxDeload = Math.max(...p.deloadWeeks);
    return Math.max(LAID_WEEKS + midDeloads, maxDeload + 1);
  }

  static isDeloadWeek(p: Pick<RoutinePeriodization, "deloadWeeks" | "version"> | undefined, raw: number): boolean {
    const idx = Math.trunc(raw);
    if (p?.version === "v3") {
      return p.deloadWeeks?.length ? p.deloadWeeks.includes(idx) : idx === LAID_V3_DELOAD_WEEK;
    }
    return !!p?.deloadWeeks?.includes(idx);
  }

  static effectiveRawWeek(
    cycle: readonly Routine[],
    workouts: readonly Workout[],
    today: string,
  ): number {
    const first = cycle[0]?.periodization;
    if (!first) return 0;
    const calRaw = LaidDupPlan.weekOf(first.startMonday, today);
    if (first.weekMode !== "rolling") return calRaw;
    if (calRaw < 0) return calRaw;
    const ids = new Set(cycle.map((r) => r.id));
    let completed = 0;
    for (const w of workouts) {
      if (!w.routineId || !ids.has(w.routineId)) continue;
      const eff = w.programDate ?? w.date;
      if (eff < first.startMonday) continue;
      if (w.exercises.some((e) => e.sets.some((s) => s.done && !s.warmup))) completed++;
    }
    return Math.floor(completed / Math.max(1, cycle.length));
  }

  static cycleState(
    cycle: readonly Routine[],
    workouts: readonly Workout[],
    today: string,
  ): LaidCycleState {
    const first = cycle[0].periodization!;
    const totalWeeks = LaidDupPlan.totalWeeks(first);
    const rawWeek = LaidDupPlan.effectiveRawWeek(cycle, workouts, today);
    const isCurrentDeload = LaidDupPlan.isDeloadWeek(first, rawWeek);
    const deloadsBefore = (first.deloadWeeks ?? []).filter((w) => w < rawWeek).length;
    let position: LaidPosition;
    if (first.version === "v3") {
      const clampedWeek = Math.max(0, Math.min(LAID_V3_WEEKS - 1, Math.trunc(rawWeek)));
      const wave = (clampedWeek < 2 ? 1 : clampedWeek < 4 ? 2 : 3) as 1 | 2 | 3;
      position = {
        raw: Math.trunc(rawWeek),
        week: clampedWeek,
        wave,
        inWave: (clampedWeek % 3) as 0 | 1 | 2,
        finished: Math.trunc(rawWeek) >= LAID_V3_WEEKS,
        beforeStart: Math.trunc(rawWeek) < 0,
      };
    } else {
      const effectiveIdx = isCurrentDeload ? Math.max(0, rawWeek - deloadsBefore - 1) : rawWeek - deloadsBefore;
      position = { ...LaidDupPlan.position(effectiveIdx), raw: rawWeek };
    }
    const activeMaxes = LaidDupPlan.maxesFor(first, position.week);
    const statusWeek = position.beforeStart ? 0 : Math.min(totalWeeks - 1, Math.max(0, rawWeek));
    const weekGuide = buildWeekGuide(position, {
      light: first.light,
      deload: isCurrentDeload,
      totalWeeks,
      version: first.version,
    });
    return {
      first,
      rawWeek,
      totalWeeks,
      isCurrentDeload,
      deloadsBefore,
      position,
      activeMaxes,
      statusWeek,
      weekGuide,
    };
  }

  static cycleSummary(
    cycle: readonly Routine[],
    workouts: Workout[],
    today: string,
  ): LaidCycleSummary {
    const first = cycle[0].periodization!;
    const ids = new Set(cycle.map((r) => r.id));
    const plannedSessions = LaidDupPlan.totalWeeks(first) * Math.max(1, cycle.length);
    let completedSessions = 0;
    let totalTonnageKg = 0;
    for (const w of workouts) {
      if (!w.routineId || !ids.has(w.routineId)) continue;
      const eff = w.programDate ?? w.date;
      if (eff < first.startMonday || eff > today) continue;
      let hasWork = false;
      for (const e of w.exercises) {
        const def = exerciseForEntry(e);
        const mult = def?.recording.loadMode === "per_implement" ? (def.recording.implementCount ?? 1) : 1;
        for (const s of e.sets) {
          if (!s.done || s.warmup) continue;
          hasWork = true;
          if (s.weight > 0 && s.reps > 0) totalTonnageKg += s.weight * s.reps * mult;
        }
      }
      if (hasWork) completedSessions++;
    }
    const startMaxes = LaidDupPlan.maxesFor(first, 0);
    const lifts = (["squat", "bench", "deadlift", "ohp"] as const).map((lift) => {
      const startMax = startMaxes[lift];
      const bestE1rm = LaidDupPlan.estimate(
        workouts,
        lift,
        first.startMonday,
        today,
        LaidDupPlan.liftExerciseId(lift, first.substitutions),
        10,
      );
      const suggestedNextTm = bestE1rm !== null ? LaidDupPlan.trainingMaxFrom1Rm(bestE1rm) : null;
      const isCalOrPain = first.calibrationLifts?.includes(lift) || first.painFlags?.includes(lift);
      const deltaKg =
        bestE1rm !== null && !isCalOrPain
          ? Math.round((bestE1rm - startMax) * 10) / 10
          : null;
      return {
        lift,
        name: LaidDupPlan.liftLabel(lift, first.substitutions),
        startMax,
        bestE1rm,
        suggestedNextTm,
        deltaKg,
      };
    });
    return {
      completedSessions,
      plannedSessions,
      adherencePct: Math.min(100, Math.round((completedSessions / plannedSessions) * 100)),
      totalTonnageKg: Math.round(totalTonnageKg),
      lifts,
    };
  }

  static calibrationReady(
    p: RoutinePeriodization,
    workouts: Workout[],
    today: string,
  ): LaidCalibrationGraduation[] {
    if (!p.calibrationLifts?.length) return [];
    const out: LaidCalibrationGraduation[] = [];
    for (const lift of p.calibrationLifts) {
      if (p.painFlags?.includes(lift)) continue;
      const exerciseId = LaidDupPlan.liftExerciseId(lift, p.substitutions);
      const sessions = LaidDupPlan.sessionsForExercise(workouts, exerciseId, p.startMonday, today);
      if (sessions < 2) continue;
      let best1Rm: number | null = null;
      for (const w of workouts) {
        if (w.date < p.startMonday || w.date > today) continue;
        for (const entry of w.exercises) {
          if (entry.exerciseId !== exerciseId) continue;
          for (const set of entry.sets) {
            if (!set.done || set.warmup || set.weight <= 0 || set.reps < 1 || set.reps > 10) continue;
            const rom = set.execution?.rom ?? entry.execution?.rom;
            if (rom === "shortened_partial" || rom === "lengthened_partial") continue;
            const est = OneRepMaxFormulas.rirAdjustedEpley(set.weight, set.reps, set.rir);
            if (est !== null && (best1Rm === null || est > best1Rm)) best1Rm = est;
          }
        }
      }
      if (best1Rm === null || best1Rm < 5) continue;
      const estimated1Rm = Math.round(best1Rm * 10) / 10;
      const suggestedTm = Math.min(MAX_KG, LaidDupPlan.trainingMaxFrom1Rm(estimated1Rm));
      out.push({
        lift,
        exerciseId,
        exerciseName: LaidDupPlan.liftLabel(lift, p.substitutions),
        sessions,
        estimated1Rm,
        suggestedTm,
      });
    }
    return out;
  }

  static auxProgressionHint(
    entry: Pick<WorkoutExercise, "exerciseId" | "repMin" | "repMax" | "sets">,
    previousWorkingSets: readonly SetEntry[],
  ): LaidAuxProgressionHint | null {
    return buildAuxProgressionHint(entry, previousWorkingSets);
  }

  static liftModeOf(
    p: Pick<RoutinePeriodization, "calibrationLifts" | "painFlags" | "substitutions">,
    lift: LaidLift,
  ): "percent_1rm" | "calibration" | "pain" | "rir_range" {
    if (p.painFlags?.includes(lift)) return "pain";
    if (p.calibrationLifts?.includes(lift)) return "calibration";
    const origId = LAID_LIFT_EXERCISE[lift];
    const resolvedId = LaidDupPlan.liftExerciseId(lift, p.substitutions);
    if (resolvedId !== origId) {
      const compat = SubstitutionPolicy.classify(exerciseById(origId), exerciseById(resolvedId), {
        hasOwnHistory: true,
        painFlag: false,
      });
      if (compat.prescriptionMode === "rir_range") return "rir_range";
    }
    return "percent_1rm";
  }

  static weekGuide(
    position: LaidPosition,
    options: { light?: boolean; deload?: boolean; totalWeeks?: number; version?: LaidVersion } = {},
  ): LaidWeekGuide {
    return buildWeekGuide(position, options);
  }

  static exerciseGuidance(
    day: LaidDay,
    exerciseId: string,
    plan: LaidDayPlan,
    substitutions?: LaidSubstitutions,
    options: { deload?: boolean } = {},
  ): LaidExerciseGuidance {
    return buildExerciseGuidance(day, exerciseId, plan, substitutions, options);
  }

  static restSecondsForSet(
    day: LaidDay,
    exerciseId: string,
    plan: LaidDayPlan,
    options: { isTopSet?: boolean; reps?: number; substitutions?: LaidSubstitutions; deload?: boolean } = {},
  ): number {
    return calcRestSecondsForSet(day, exerciseId, plan, options);
  }

  static roundKg(kg: number): number {
    if (!Number.isFinite(kg) || kg <= 0) return 0;
    return Math.floor(kg / 2.5 + 0.5 + 1e-9) * 2.5;
  }

  static weight(maxKg: number, percent: number): number {
    return LaidDupPlan.roundKg((maxKg * percent) / 100);
  }

  static weekOf(startMonday: string, date: string): number {
    const day = (iso: string) => Math.round(new Date(iso + "T12:00:00Z").getTime() / 86_400_000);
    const monday = addCalendarDays(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
    return Math.round((day(monday) - day(startMonday)) / 7);
  }

  static position(raw: number): LaidPosition {
    const n = Number.isFinite(raw) ? Math.trunc(raw) : 0;
    const week = Math.max(0, Math.min(LAID_WEEKS - 1, n));
    return {
      raw: n,
      week,
      wave: (Math.floor(week / WAVE_WEEKS) + 1) as 1 | 2 | 3,
      inWave: (week % WAVE_WEEKS) as 0 | 1 | 2,
      finished: n >= LAID_WEEKS,
      beforeStart: n < 0,
    };
  }

  static startMonday(today: string, which: "this" | "next"): string {
    const monday = addCalendarDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
    return which === "this" ? monday : addCalendarDays(monday, 7);
  }

  static defaultStart(today: string): "this" | "next" {
    return (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7 <= 2 ? "this" : "next";
  }

  static maxesFor(p: Pick<RoutinePeriodization, "maxes" | "maxesFromWeek" | "earlier">, week: number): LaidMaxes {
    const stages = [...(p.earlier ?? []), { fromWeek: p.maxesFromWeek, maxes: p.maxes }].sort((x, y) => x.fromWeek - y.fromWeek);
    let chosen = stages[0].maxes;
    for (const stage of stages) if (stage.fromWeek <= week) chosen = stage.maxes;
    return chosen;
  }

  static normalizeSubstitutions(substitutions?: LaidSubstitutions): LaidSubstitutions | undefined {
    if (!substitutions) return undefined;
    const cleaned: LaidSubstitutions = {};
    for (const [orig, repl] of Object.entries(substitutions)) {
      const from = orig.trim();
      const to = typeof repl === "string" ? repl.trim() : "";
      if (from && to && from !== to) cleaned[from] = to;
    }
    return Object.keys(cleaned).length ? cleaned : undefined;
  }

  static resolveExerciseId(originalId: string, substitutions?: LaidSubstitutions): string {
    return resolveLaidExerciseId(originalId, substitutions);
  }

  static liftExerciseId(lift: LaidLift, substitutions?: LaidSubstitutions): string {
    return resolveLaidExerciseId(LAID_LIFT_EXERCISE[lift], substitutions);
  }

  static isLiftSubstituted(lift: LaidLift, substitutions?: LaidSubstitutions): boolean {
    const orig = LAID_LIFT_EXERCISE[lift];
    return !!substitutions?.[orig] && substitutions[orig] !== orig;
  }

  static liftLabel(lift: LaidLift, substitutions?: LaidSubstitutions, version?: LaidVersion): string {
    if (LaidDupPlan.isLiftSubstituted(lift, substitutions)) {
      const id = LaidDupPlan.liftExerciseId(lift, substitutions);
      return exerciseById(id)?.name ?? LAID_LIFT_LABEL[lift];
    }
    if (version === "v3") {
      if (lift === "ohp") return "Наклонный жим 30°";
      if (lift === "deadlift") return "Трэп-гриф / RDL";
    }
    return LAID_LIFT_LABEL[lift];
  }

  static day(
    day: LaidDay,
    raw: number,
    maxes: LaidMaxes,
    options: {
      version?: LaidVersion;
      light?: boolean;
      substitutions?: LaidSubstitutions;
      calibrationLifts?: readonly LaidLift[];
      painFlags?: readonly LaidLift[];
      deloadWeeks?: readonly number[];
    } = {},
  ): LaidDayPlan {
    const n = Number.isFinite(raw) ? Math.trunc(raw) : 0;
    const isV3 = options.version === "v3";
    const isV2 = options.version === "v2";
    const deloads = options.deloadWeeks ?? [];
    const isDeload = isV3 ? (deloads.length ? deloads.includes(n) : n === LAID_V3_DELOAD_WEEK) : deloads.includes(n);
    const deloadsBefore = deloads.filter((w) => w < n).length;
    const effectiveIndex = isDeload ? Math.max(0, n - deloadsBefore - 1) : n - deloadsBefore;
    const basePos = LaidDupPlan.position(effectiveIndex);
    const position: LaidPosition = isV3
      ? {
          raw: n,
          week: Math.max(0, Math.min(LAID_V3_WEEKS - 1, n)),
          wave: (Math.max(0, n) < 2 ? 1 : Math.max(0, n) < 4 ? 2 : 3) as 1 | 2 | 3,
          inWave: (Math.max(0, Math.min(LAID_V3_WEEKS - 1, n)) % 3) as 0 | 1 | 2,
          finished: n >= LAID_V3_WEEKS,
          beforeStart: n < 0,
        }
      : deloads.length
        ? { ...basePos, raw: n }
        : basePos;
    const lift = LAID_LIFT_OF[day];
    const maxKg = maxes[lift];
    const originalLiftExerciseId = liftExerciseForDay(day, options.version);
    const liftExerciseId = resolveLaidExerciseId(originalLiftExerciseId, options.substitutions);
    const isReplaced = liftExerciseId !== originalLiftExerciseId;
    const isCalibration = !!options.calibrationLifts?.includes(lift);
    const painFlag = !!options.painFlags?.includes(lift);

    // DUP v3 — Hypertrophy & Strength Max (6-week 5+1 mesocycle, Dynamic Wave H/S + Autoregulated Top Set + RIR Ramp)
    if (isV3) {
      const v3Week = isDeload ? 6 : mesocycleWeekFromZeroBased(n);
      const stimulus = v3StimulusForWeek(day, v3Week);
      const spec = WAVE_MATRIX_V3[v3Week][stimulus];
      const longLevers = BiomechanicsProfileStore.read().longLevers || true;
      const loadDrop = longLevers ? spec.loadDropLL : spec.loadDrop;
      const compat = isReplaced
        ? SubstitutionPolicy.classify(exerciseById(originalLiftExerciseId), exerciseById(liftExerciseId), {
            hasOwnHistory: !isCalibration,
            painFlag,
          })
        : {
            subClass: "A" as SubstitutionClass,
            prescriptionMode: (painFlag ? "rir_range" : isCalibration ? "calibration" : "percent_1rm") as PrescriptionMode,
            badge: "",
            summary: "",
            allowHeavySingles: false,
          };
      const prescriptionMode: PrescriptionMode = painFlag
        ? "rir_range"
        : isCalibration
          ? "calibration"
          : compat.prescriptionMode;
      const noPercent = prescriptionMode !== "percent_1rm";
      // RDL (legs2 / Lower B) scales cleanly from Trap Bar DL Working TM (~75%)
      const effectiveTm =
        day === "legs2" ? roundPlate(maxes.deadlift * LAID_V3_RDL_FROM_DL_FACTOR, 2.5) : maxKg;
      const topKg = noPercent ? 0 : roundPlate(effectiveTm * spec.topPctTM, 2.5);
      const backoffKg = noPercent ? 0 : roundPlate(topKg * (1 - loadDrop), 2.5);
      return {
        version: "v3",
        stimulus,
        day,
        position,
        lift,
        liftExerciseId,
        originalLiftExerciseId,
        prescriptionMode,
        subClass: compat.subClass,
        painFlag,
        isDeload: v3Week === 6 || isDeload,
        v3Week,
        v3TargetTopRir: spec.topTargetRir,
        v3LoadDropPct: Math.round(loadDrop * 100),
        v3RepOutCap: spec.repOutCap,
        v3AccessoryRir: ACCESSORY_RIR_RAMP_V3[v3Week],
        maxKg: effectiveTm,
        heavy: {
          reps: spec.topReps,
          percent: noPercent ? 0 : Math.round(spec.topPctTM * 1000) / 10,
          weightKg: topKg,
          light: false,
        },
        work: {
          sets: spec.backoffSets,
          reps: spec.backoffReps,
          percent: noPercent ? 0 : Math.round(spec.topPctTM * (1 - loadDrop) * 1000) / 10,
          weightKg: backoffKg,
        },
      };
    }

    // DUP v2: полностью детерминированная матрица (TM = 90 %, без синглов 1ПМ, Pull 1 — трэп-гриф, Pull 2 — тяга с упором грудью по RIR)
    if (isV2) {
      const stimulus = LAID_V2_STIMULUS[day][position.inWave];
      const isPull2Row = day === "pull2";
      const compat = isPull2Row
        ? {
            subClass: "C" as SubstitutionClass,
            prescriptionMode: "rir_range" as PrescriptionMode,
            badge: "",
            summary: "",
            allowHeavySingles: false,
          }
        : isReplaced
          ? SubstitutionPolicy.classify(exerciseById(originalLiftExerciseId), exerciseById(liftExerciseId), {
              hasOwnHistory: !isCalibration,
              painFlag,
            })
          : {
              subClass: "A" as SubstitutionClass,
              prescriptionMode: (painFlag ? "rir_range" : isCalibration ? "calibration" : "percent_1rm") as PrescriptionMode,
              badge: "",
              summary: "",
              allowHeavySingles: false,
            };
      const prescriptionMode: PrescriptionMode = isPull2Row
        ? "rir_range"
        : painFlag
          ? "rir_range"
          : isCalibration
            ? "calibration"
            : compat.prescriptionMode;
      const noPercent = prescriptionMode !== "percent_1rm";

      if (isDeload) {
        const deloadReps = isPull2Row ? 8 : day === "pull1" ? 3 : 5;
        const deloadWorkReps = isPull2Row ? 8 : day === "pull1" ? 3 : 5;
        return {
          version: "v2",
          stimulus,
          day,
          position,
          lift,
          liftExerciseId,
          originalLiftExerciseId,
          prescriptionMode,
          subClass: compat.subClass,
          painFlag,
          isDeload: true,
          maxKg,
          heavy: {
            reps: deloadReps,
            percent: noPercent ? 0 : 75,
            weightKg: noPercent ? 0 : LaidDupPlan.weight(maxKg, 75),
            light: false,
          },
          work: {
            sets: 1,
            reps: deloadWorkReps,
            percent: noPercent ? 0 : 75,
            weightKg: noPercent ? 0 : LaidDupPlan.weight(maxKg, 75),
          },
        };
      }

      if (isPull2Row) {
        const rowScheme = LAID_V2_PULL2_ROW[stimulus];
        return {
          version: "v2",
          stimulus,
          day,
          position,
          lift,
          liftExerciseId,
          originalLiftExerciseId,
          prescriptionMode: "rir_range",
          subClass: "C",
          painFlag,
          maxKg,
          heavy: { reps: rowScheme.heavyReps, percent: 0, weightKg: 0, light: false },
          work: { sets: rowScheme.workSets, reps: rowScheme.workReps, percent: 0, weightKg: 0 },
        };
      }

      const waveIdx = position.wave - 1;
      const recipe =
        day === "pull1"
          ? LAID_V2_TRAP_MATRIX[stimulus][waveIdx]
          : LAID_V2_MAIN_MATRIX[stimulus][waveIdx];
      const workSets = day === "legs2" ? 2 : recipe.workSets;
      return {
        version: "v2",
        stimulus,
        day,
        position,
        lift,
        liftExerciseId,
        originalLiftExerciseId,
        prescriptionMode,
        subClass: compat.subClass,
        painFlag,
        maxKg,
        heavy: {
          reps: recipe.heavyReps,
          percent: noPercent ? 0 : recipe.heavyPct,
          weightKg: noPercent ? 0 : LaidDupPlan.weight(maxKg, recipe.heavyPct),
          light: false,
        },
        work: {
          sets: workSets,
          reps: recipe.workReps,
          percent: noPercent ? 0 : recipe.workPct,
          weightKg: noPercent ? 0 : LaidDupPlan.weight(maxKg, recipe.workPct),
        },
      };
    }

    const scheme = LAID_SCHEME[day];
    const compat = isReplaced
      ? SubstitutionPolicy.classify(exerciseById(originalLiftExerciseId), exerciseById(liftExerciseId), {
          hasOwnHistory: !isCalibration,
          painFlag,
        })
      : {
          subClass: "A" as SubstitutionClass,
          prescriptionMode: (painFlag ? "rir_range" : isCalibration ? "calibration" : "percent_1rm") as PrescriptionMode,
          badge: "",
          summary: "",
          allowHeavySingles: !painFlag && !isCalibration,
        };

    const prescriptionMode: PrescriptionMode = painFlag
      ? "rir_range"
      : isCalibration
        ? "calibration"
        : compat.prescriptionMode;
    const noPercent = prescriptionMode !== "percent_1rm";

    if (isDeload) {
      const deloadHeavyReps: HeavyScheme = 5;
      const deloadWorkReps: WorkReps = Math.max(6, scheme.work[position.inWave]) as WorkReps;
      return {
        day,
        position,
        lift,
        liftExerciseId,
        originalLiftExerciseId,
        prescriptionMode,
        subClass: compat.subClass,
        painFlag,
        isDeload: true,
        maxKg,
        heavy: {
          reps: deloadHeavyReps,
          percent: noPercent ? 0 : 60,
          weightKg: noPercent ? 0 : LaidDupPlan.weight(maxKg, 60),
          light: false,
        },
        work: {
          sets: 2,
          reps: deloadWorkReps,
          percent: noPercent ? 0 : 55,
          weightKg: noPercent ? 0 : LaidDupPlan.weight(maxKg, 55),
        },
      };
    }

    const blockSingles = !!options.light || !compat.allowHeavySingles || noPercent;
    const light = blockSingles && scheme.heavy[position.inWave] === 1;
    const heavyScheme: HeavyScheme =
      prescriptionMode === "rir_range"
        ? 5
        : light
          ? 3
          : scheme.heavy[position.inWave];
    const wave = position.wave - 1;
    const heavyPercent = LAID_HEAVY_PCT[heavyScheme][wave];
    const rawWorkReps = scheme.work[position.inWave];
    const workLight = (light && rawWorkReps === 2) || (prescriptionMode === "rir_range" && rawWorkReps < 6);
    const workReps: WorkReps =
      prescriptionMode === "rir_range" && rawWorkReps < 6
        ? 8
        : light && rawWorkReps === 2
          ? 4
          : rawWorkReps;
    const workPercent = LAID_WORK_PCT[workReps][wave];
    return {
      day,
      position,
      lift,
      liftExerciseId,
      originalLiftExerciseId,
      prescriptionMode,
      subClass: compat.subClass,
      painFlag,
      maxKg,
      heavy: {
        reps: heavyScheme,
        percent: noPercent ? 0 : heavyPercent,
        weightKg: noPercent ? 0 : LaidDupPlan.weight(maxKg, heavyPercent),
        light: !!options.light && scheme.heavy[position.inWave] === 1,
      },
      work: {
        sets: 4,
        reps: workReps,
        percent: noPercent ? 0 : workPercent,
        weightKg: noPercent ? 0 : LaidDupPlan.weight(maxKg, workPercent),
        ...(workLight && !!options.light ? { light: true } : {}),
      },
    };
  }

  static auxReps(
    day: LaidDay,
    exerciseId: string,
    inWave: 0 | 1 | 2,
    substitutions?: LaidSubstitutions,
    version?: LaidVersion,
  ): number | null {
    return laidAuxReps(day, exerciseId, inWave, substitutions, version);
  }

  static waveAuxSummary(
    day: LaidDay,
    inWave: 0 | 1 | 2,
    substitutions?: LaidSubstitutions,
    version?: LaidVersion,
  ): string | null {
    const found = layoutForVersion(version)[day].aux.find((x) => x.byWave);
    if (!found?.byWave) return null;
    const resolvedId = resolveLaidExerciseId(found.exerciseId, substitutions);
    const label =
      resolvedId !== found.exerciseId
        ? (exerciseById(resolvedId)?.name ?? resolvedId)
        : found.exerciseId === "push-press"
          ? "Push press"
          : found.exerciseId === "incline-db"
            ? "Наклон гантели 30°"
            : "Наклонный жим";
    return `${label} ${found.sets} × ${found.byWave[inWave]}`;
  }

  static exerciseSpec(
    day: LaidDay,
    exerciseId: string,
    substitutions?: LaidSubstitutions,
    version?: LaidVersion,
  ): LaidExerciseSpec {
    return buildExerciseSpec(day, exerciseId, substitutions, version);
  }

  static originalIds(day: LaidDay, substitutions?: LaidSubstitutions, version?: LaidVersion): string[] {
    return laidOriginalIds(day, substitutions, version);
  }

  static isAdded(day: LaidDay, exerciseId: string, substitutions?: LaidSubstitutions, version?: LaidVersion): boolean {
    return !laidOriginalIds(day, substitutions, version).includes(exerciseId);
  }

  static line(plan: LaidDayPlan): string {
    return formatDayLine(plan);
  }

  static compactLine(plan: LaidDayPlan): string {
    return formatCompactDayLine(plan);
  }

  static kg(value: number): string {
    return formatKg(value);
  }

  static pct(value: number): string {
    return formatPct(value);
  }

  static repsWord(n: number): string {
    return repsWord(n);
  }

  static weekLabel(
    position: LaidPosition,
    options: { isDeload?: boolean; totalWeeks?: number; version?: LaidVersion } = {},
  ): string {
    return buildWeekLabel(position, options);
  }

  static hasPlanWeight(entry: { progressionNote?: string }): boolean {
    return typeof entry.progressionNote === "string" && entry.progressionNote.includes(LAID_PLAN_MARK);
  }

  static describe(plan: LaidDayPlan): string {
    return formatDayDescription(plan);
  }

  static liftSets(plan: LaidDayPlan): SetEntry[] {
    const rir = plan.isDeload ? 4 : plan.prescriptionMode === "percent_1rm" ? null : 2;
    const set = (weight: number, reps: number): SetEntry => ({
      id: crypto.randomUUID(),
      weight,
      reps,
      rir,
      warmup: false,
      done: false,
    });
    return [
      set(plan.heavy.weightKg, plan.heavy.reps),
      ...Array.from({ length: plan.work.sets }, () => set(plan.work.weightKg, plan.work.reps)),
    ];
  }

  static entries(
    day: LaidDay,
    maxes: LaidMaxes,
    options: {
      version?: LaidVersion;
      extras: boolean;
      light: boolean;
      substitutions?: LaidSubstitutions;
      calibrationLifts?: readonly LaidLift[];
      painFlags?: readonly LaidLift[];
    },
  ): WorkoutExercise[] {
    const plan = LaidDupPlan.day(day, 0, maxes, options);
    if (options.version === "v3") {
      const v3Day = getV3DayByLaidDay(day, DAVID_LAID_DUP_V3_LIVE_PLAN);
      if (v3Day) {
        const seen = new Set<string>();
        const ordered: WorkoutExercise[] = [];
        for (const slot of v3Day.exercises) {
          const resolvedId = resolveLaidExerciseId(slot.exerciseId, options.substitutions);
          if (seen.has(resolvedId)) continue;
          seen.add(resolvedId);
          if (resolvedId === plan.liftExerciseId) {
            ordered.push({ ...makeExerciseEntry(resolvedId), sets: LaidDupPlan.liftSets(plan) });
            continue;
          }
          const def = exerciseById(resolvedId);
          const isDuration = def?.recording.type === "duration";
          ordered.push({
            ...makeExerciseEntry(resolvedId),
            ...(slot.supersetGroup ? { supersetId: `v3-${day}-${slot.supersetGroup}` } : {}),
            sets: makeSets(slot.sets, 0, isDuration ? 0 : slot.repRange[0]).map((s) => ({
              ...s,
              rir: null,
              ...(isDuration ? { durationSeconds: 45 } : {}),
            })),
            ...(isDuration
              ? {}
              : {
                  repMin: slot.repRange[0],
                  repMax: slot.repRange[1],
                }),
          });
        }
        return ordered;
      }
    }
    const layout = layoutForVersion(options.version)[day];
    const lift = { ...makeExerciseEntry(plan.liftExerciseId), sets: LaidDupPlan.liftSets(plan) };
    const seen = new Set<string>([plan.liftExerciseId]);
    const rows: WorkoutExercise[] = [];
    for (const x of [...layout.aux, ...(options.extras ? layout.extras : [])]) {
      const resolvedId = resolveLaidExerciseId(x.exerciseId, options.substitutions);
      if (seen.has(resolvedId)) continue;
      seen.add(resolvedId);
      const reps = x.byWave ? x.byWave[0] : x.repMin;
      const def = exerciseById(resolvedId);
      const isDuration = def?.recording.type === "duration";
      rows.push({
        ...makeExerciseEntry(resolvedId),
        sets: makeSets(x.sets, 0, isDuration ? 0 : reps).map((s) => ({
          ...s,
          rir: null,
          ...(isDuration ? { durationSeconds: 45 } : {}),
        })),
        ...(isDuration
          ? {}
          : {
              repMin: x.byWave ? reps : x.repMin,
              repMax: x.byWave ? reps : x.repMax,
            }),
      });
    }
    return [lift, ...rows];
  }

  static routines(input: {
    version?: LaidVersion;
    maxes: LaidMaxes;
    extras: boolean;
    light: boolean;
    startMonday: string;
    cycleId?: string;
    rhythm?: LaidRhythm;
    weekdays?: Partial<Record<LaidDay, number>>;
    substitutions?: LaidSubstitutions;
    calibrationLifts?: readonly LaidLift[];
    painFlags?: readonly LaidLift[];
    autoEscalate?: boolean;
    weekMode?: "calendar" | "rolling";
    deloadWeeks?: readonly number[];
  }): Routine[] {
    const isV3 = input.version === "v3";
    const isV2 = input.version === "v2";
    const cycleId = input.cycleId ?? crypto.randomUUID();
    const baseWeekdays = isV3
      ? LAID_V3_WEEKDAYS
      : LAID_RHYTHM_WEEKDAYS[input.rhythm ?? (isV2 ? "3x1x3" : "6x1")];
    const weekdays: Record<LaidDay, number> = { ...baseWeekdays, ...(input.weekdays ?? {}) };
    const substitutions = LaidDupPlan.normalizeSubstitutions(input.substitutions);
    const calibrationLifts = input.calibrationLifts?.length ? [...new Set(input.calibrationLifts)] : undefined;
    const painFlags = input.painFlags?.length ? [...new Set(input.painFlags)] : undefined;
    const rawDeloads =
      input.deloadWeeks ??
      (isV3 ? [LAID_V3_DELOAD_WEEK] : isV2 ? [LAID_V2_DELOAD_WEEK] : undefined);
    const deloadWeeks = rawDeloads?.length
      ? [...new Set(rawDeloads.map((w) => Math.trunc(w)).filter((w) => w >= 0 && w <= 12))].sort((a, b) => a - b).slice(0, 3)
      : undefined;
    const effectiveExtras = isV3 || isV2 ? true : input.extras;
    const effectiveLight = isV3 || isV2 ? true : input.light;
    const effectiveWeekMode = input.weekMode ?? (isV2 ? "rolling" : "calendar");
    const targetDays = daysForVersion(input.version);
    return targetDays.map((day) => ({
      id: crypto.randomUUID(),
      name: isV3 ? LAID_V3_NAMES[day] : LAID_NAMES[day],
      notes: isV3
        ? `David Laid DUP v3 · Hypertrophy & Strength Max (5+1 нед., Dynamic Wave H/S + авторегуляция топ-сета + RIR Ramp 3→0). ${LAID_V3_REST_SUMMARY}.`
        : isV2
          ? `${LAID_ORIGINAL[day]} · Умный DUP v2 (${LaidDupPlan.totalWeeks({ deloadWeeks })} нед., ТМ = 90 % 1ПМ, без синглов 1ПМ). Отдых: база 2,5–3,5 мин, подсобка 2–2,5 мин, изоляция 75–90 с.`
          : `${LAID_ORIGINAL[day]} программы Дэвида Лейда (DUP, ${LaidDupPlan.totalWeeks({ deloadWeeks })} нед.). Отдых: база 3–5 мин, тяжёлая подсобка 2–3 мин, тренажёры/изоляция 1–1,5 мин. Подсобка — RIR 1–2 (RPE 8–9).`,
      days: [weekdays[day]],
      exercises: LaidDupPlan.entries(day, input.maxes, {
        version: input.version,
        extras: effectiveExtras,
        light: effectiveLight,
        substitutions,
        calibrationLifts,
        painFlags,
      }),
      restSeconds: LaidDupPlan.REST_SECONDS,
      progression: isV3 ? ("double" as const) : ("repeat" as const),
      repMin: 8,
      repMax: 12,
      incrementKg: 2.5,
      revision: 0,
      periodization: {
        kind: "laid-dup" as const,
        ...(isV3 ? { version: "v3" as const } : isV2 ? { version: "v2" as const } : {}),
        cycleId,
        day,
        startMonday: input.startMonday,
        maxes: { ...input.maxes },
        maxesFromWeek: 0,
        extras: effectiveExtras,
        light: effectiveLight,
        ...(substitutions ? { substitutions } : {}),
        ...(calibrationLifts ? { calibrationLifts } : {}),
        ...(painFlags ? { painFlags } : {}),
        ...(input.autoEscalate ? { autoEscalate: true } : {}),
        ...(effectiveWeekMode === "rolling" ? { weekMode: "rolling" as const } : {}),
        ...(deloadWeeks?.length ? { deloadWeeks } : {}),
      },
    }));
  }

  /** В один клик обновляет существующий цикл Лейда (v1) до «Умного DUP v2», сохраняя даты старта, максимумы и историю. */
  static upgradeCycleToV2(cycle: readonly Routine[]): Routine[] {
    if (!cycle.length) return [];
    const first = LaidDupPlan.periodizationOf(cycle[0]);
    if (!first) return [...cycle];
    const weekdays = LAID_RHYTHM_WEEKDAYS["3x1x3"];
    return cycle.map((routine) => {
      const prev = LaidDupPlan.periodizationOf(routine);
      if (!prev) return routine;
      const nextPeriodization: RoutinePeriodization = {
        ...prev,
        version: "v2",
        extras: true,
        light: true,
        weekMode: "rolling",
        deloadWeeks: prev.deloadWeeks?.length ? prev.deloadWeeks : [LAID_V2_DELOAD_WEEK],
      };
      delete nextPeriodization.substitutions;
      return {
        ...routine,
        days: [weekdays[prev.day]],
        notes: `${LAID_ORIGINAL[prev.day]} · Умный DUP v2 (${LaidDupPlan.totalWeeks(nextPeriodization)} нед., ТМ = 90 % 1ПМ, без синглов 1ПМ). Отдых: база 2,5–3,5 мин, подсобка 2–2,5 мин, изоляция 75–90 с.`,
        exercises: LaidDupPlan.entries(prev.day, prev.maxes, {
          version: "v2",
          extras: true,
          light: true,
          calibrationLifts: prev.calibrationLifts,
          painFlags: prev.painFlags,
        }),
        periodization: nextPeriodization,
      };
    });
  }

  /** В один клик обновляет существующий цикл Лейда (v1 или v2) до 5-дневного «DUP v3 · Hypertrophy Max». */
  static upgradeCycleToV3(cycle: readonly Routine[], startMonday?: string): Routine[] {
    if (!cycle.length) return [];
    const first = LaidDupPlan.periodizationOf(cycle[0]);
    if (!first) return [...cycle];
    // Переводим максимум OHP в реалистичный ТМ наклонного жима 30° (~80 % от жима лёжа), если OHP сильно ниже
    const inclineTm =
      first.maxes.ohp < first.maxes.bench * 0.72
        ? roundPlate(first.maxes.bench * 0.8, 2.5)
        : first.maxes.ohp;
    const nextMaxes: LaidMaxes = {
      squat: first.maxes.squat,
      bench: first.maxes.bench,
      deadlift: first.maxes.deadlift,
      ohp: Math.max(20, inclineTm),
    };
    return LaidDupPlan.routines({
      version: "v3",
      maxes: nextMaxes,
      extras: true,
      light: true,
      startMonday: startMonday ?? first.startMonday,
      calibrationLifts: first.calibrationLifts,
      painFlags: first.painFlags,
      autoEscalate: first.autoEscalate,
      weekMode: first.weekMode ?? "calendar",
      deloadWeeks: [LAID_V3_DELOAD_WEEK],
    });
  }

  static checkMax(raw: string): { value: number | null; error: string | null } {
    const text = raw.trim().replace(",", ".");
    if (!text) return { value: null, error: "Введи максимум в килограммах." };
    if (!/^\d+(\.\d+)?$/.test(text)) return { value: null, error: "Максимум — число в килограммах." };
    const value = Number(text);
    if (!(value > 0)) return { value: null, error: "Максимум должен быть больше нуля." };
    if (value < 1) return { value: null, error: "Введи максимум не меньше 1 кг." };
    if (value > MAX_KG) return { value: null, error: `Максимум не больше ${MAX_KG} кг: проверь число.` };
    return { value, error: null };
  }

  static periodizationOf(routine: Routine | null | undefined): RoutinePeriodization | undefined {
    const p = routine?.periodization as unknown;
    return p === undefined || p === null ? undefined : PeriodizationRules.check(p).ok ? (p as RoutinePeriodization) : undefined;
  }

  static isBroken(routine: Routine | null | undefined): boolean {
    const p = routine?.periodization as unknown;
    return p !== undefined && !PeriodizationRules.check(p).ok;
  }

  static cycleOf(routines: Routine[], routine: Routine): Routine[] {
    const id = LaidDupPlan.periodizationOf(routine)?.cycleId;
    return id ? routines.filter((r) => LaidDupPlan.periodizationOf(r)?.cycleId === id) : [];
  }

  static cycles(routines: Routine[]): Routine[][] {
    const valid = routines.filter((r) => LaidDupPlan.periodizationOf(r));
    const ids = [...new Set(valid.map((r) => LaidDupPlan.periodizationOf(r)!.cycleId))];
    return ids.map((id) =>
      valid
        .filter((r) => LaidDupPlan.periodizationOf(r)!.cycleId === id)
        .sort(LaidDupPlan.compareCycleRoutines),
    );
  }

  static ordered(routines: Routine[]): Routine[] {
    const out = [...routines];
    const slots = new Map<string, number[]>();
    routines.forEach((r, i) => {
      const id = LaidDupPlan.periodizationOf(r)?.cycleId;
      if (id) slots.set(id, [...(slots.get(id) ?? []), i]);
    });
    for (const at of slots.values()) {
      const sorted = at.map((i) => routines[i]).sort(LaidDupPlan.compareCycleRoutines);
      at.forEach((index, k) => (out[index] = sorted[k]));
    }
    return out;
  }

  static planFor(
    routine: Routine,
    date: string,
    options?: { workouts?: readonly Workout[]; cycle?: readonly Routine[] },
  ): LaidDayPlan | null {
    const p = LaidDupPlan.periodizationOf(routine);
    if (!p) return null;
    const raw =
      p.weekMode === "rolling" && options?.workouts
        ? LaidDupPlan.effectiveRawWeek(options.cycle?.length ? options.cycle : [routine], options.workouts, date)
        : LaidDupPlan.weekOf(p.startMonday, date);
    const deloadsBefore = (p.deloadWeeks ?? []).filter((w) => w < Math.trunc(raw)).length;
    const effectiveWeek = Math.max(0, Math.min(LAID_WEEKS - 1, Math.trunc(raw) - deloadsBefore));
    return LaidDupPlan.day(p.day, raw, LaidDupPlan.maxesFor(p, effectiveWeek), {
      version: p.version,
      light: p.light,
      substitutions: p.substitutions,
      calibrationLifts: p.calibrationLifts,
      painFlags: p.painFlags,
      deloadWeeks: p.deloadWeeks,
    });
  }

  static status(
    routine: Routine,
    workouts: Workout[],
    week: number,
    today: string,
  ): { state: "done" | "missed" | "ahead"; date?: string } {
    const p = LaidDupPlan.periodizationOf(routine);
    if (!p) return { state: "ahead" };
    if (p.weekMode === "rolling") {
      const doneDates = workouts
        .filter((w) => {
          if (w.routineId !== routine.id) return false;
          const eff = w.programDate ?? w.date;
          if (eff < p.startMonday) return false;
          return w.exercises.some((e) => e.sets.some((s) => s.done && !s.warmup));
        })
        .map((w) => w.date)
        .sort();
      const matched = doneDates[week];
      return matched ? { state: "done", date: matched } : { state: "ahead" };
    }
    const monday = addCalendarDays(p.startMonday, week * 7);
    const sunday = addCalendarDays(monday, 6);
    const done = workouts
      .filter((w) => {
        if (w.routineId !== routine.id) return false;
        const effective = w.programDate ?? w.date;
        return effective >= monday && effective <= sunday;
      })
      .map((w) => w.date)
      .sort()[0];
    if (done) return { state: "done", date: done };
    const planned = routine.days.length ? Math.max(...routine.days) : 6;
    const plannedDate = addCalendarDays(monday, planned);
    const override = routine.occurrenceOverrides?.find((o) => o.from === plannedDate);
    if (override) {
      if (override.to === null) return { state: today < monday ? "ahead" : "missed" };
      return { state: override.to < today ? "missed" : "ahead" };
    }
    if (today > sunday) return { state: "missed" };
    if (today < monday) return { state: "ahead" };
    return { state: plannedDate < today ? "missed" : "ahead" };
  }

  static dayStatus(
    routine: Routine,
    workouts: Workout[],
    week: number,
    today: string,
  ): { state: "done" | "missed" | "ahead" | "ended"; date?: string } {
    const result = LaidDupPlan.status(routine, workouts, week, today);
    const p = LaidDupPlan.periodizationOf(routine);
    const total = LaidDupPlan.totalWeeks(p);
    if (result.state === "missed" && p && week === total - 1 && LaidDupPlan.weekOf(p.startMonday, today) >= total)
      return { state: "ended" };
    return result;
  }

  static weeklySets(): { base: number; added: number } {
    const maxes: LaidMaxes = { squat: 100, bench: 100, deadlift: 100, ohp: 100 };
    const total = (extras: boolean) =>
      LaidDupPlan.DAYS.reduce(
        (sum, day) => sum + LaidDupPlan.entries(day, maxes, { extras, light: false }).reduce((n, e) => n + e.sets.length, 0),
        0,
      );
    const base = total(false);
    return { base, added: total(true) - base };
  }

  static sessionsForExercise(workouts: Workout[], exerciseId: string, since = "0000-01-01", until = "9999-12-31"): number {
    const dates = new Set<string>();
    for (const w of workouts) {
      if (w.date < since || w.date > until) continue;
      if (w.exercises.some((e) => e.exerciseId === exerciseId && e.sets.some((s) => s.done && !s.warmup && s.reps > 0))) {
        dates.add(`${w.id}:${w.date}`);
      }
    }
    return dates.size;
  }

  static estimate(
    workouts: Workout[],
    lift: LaidLift,
    since = "0000-01-01",
    until = "9999-12-31",
    exerciseIdOverride?: string,
    maxReps = 12,
  ): number | null {
    const id = exerciseIdOverride || LAID_LIFT_EXERCISE[lift];
    const unique = new Map<string, Workout>();
    for (const w of workouts) {
      const prev = unique.get(w.id);
      if (
        !prev ||
        (w.revision ?? 0) > (prev.revision ?? 0) ||
        ((w.revision ?? 0) === (prev.revision ?? 0) && (w.updatedAt ?? "") > (prev.updatedAt ?? ""))
      ) {
        unique.set(w.id, w);
      }
    }
    let best: number | null = null;
    for (const w of unique.values()) {
      if (w.date < since || w.date > until) continue;
      for (const entry of w.exercises) {
        if (entry.exerciseId !== id) continue;
        for (const set of entry.sets) {
          if (set.reps > maxReps) continue;
          const rom = set.execution?.rom ?? entry.execution?.rom;
          if (rom === "shortened_partial" || rom === "lengthened_partial") continue;
          const value = estimatedOneRepMax(set, entry);
          if (value !== null && (best === null || value > best)) best = value;
        }
      }
    }
    return best === null ? null : Math.round(best * 10) / 10;
  }

  static estimates(workouts: Workout[], today: string, substitutions?: LaidSubstitutions): Record<LaidLift, number | null> {
    const since = addCalendarDays(today, -LaidDupPlan.ESTIMATE_DAYS);
    return {
      squat: LaidDupPlan.estimate(workouts, "squat", since, today, LaidDupPlan.liftExerciseId("squat", substitutions)),
      bench: LaidDupPlan.estimate(workouts, "bench", since, today, LaidDupPlan.liftExerciseId("bench", substitutions)),
      deadlift: LaidDupPlan.estimate(workouts, "deadlift", since, today, LaidDupPlan.liftExerciseId("deadlift", substitutions)),
      ohp: LaidDupPlan.estimate(workouts, "ohp", since, today, LaidDupPlan.liftExerciseId("ohp", substitutions)),
    };
  }

  static suggestion(
    p: RoutinePeriodization,
    workouts: Workout[],
    today: string,
    options: { maxJumpFactor?: number } = {},
  ): { lift: LaidLift; from: number; estimate: number; to: number }[] {
    const settingStart = addCalendarDays(p.startMonday, p.maxesFromWeek * 7);
    const window = addCalendarDays(today, -LaidDupPlan.SUGGEST_DAYS);
    const since = settingStart > window ? settingStart : window;
    const found: { lift: LaidLift; from: number; estimate: number; to: number }[] = [];
    for (const lift of ["squat", "bench", "deadlift", "ohp"] as const) {
      if (p.painFlags?.includes(lift) || p.calibrationLifts?.includes(lift)) continue;
      const estimate = LaidDupPlan.estimate(workouts, lift, since, today, LaidDupPlan.liftExerciseId(lift, p.substitutions), 10);
      const current = p.maxes[lift];
      if (estimate !== null && estimate >= current * 1.05) {
        const capped =
          options.maxJumpFactor && options.maxJumpFactor > 1
            ? Math.min(estimate, current * options.maxJumpFactor)
            : estimate;
        const to = Math.min(MAX_KG, Math.floor(capped / 2.5) * 2.5);
        if (to > current) found.push({ lift, from: current, estimate, to });
      }
    }
    return found;
  }

  /**
   * Авторегуляция TM для DUP v2 с двухшаговым гистерезисом (`ProgressionEngine.evaluateTmUpdate`).
   * Анализирует хронологию топ-сетов с недели `maxesFromWeek` и предлагает сдвиг только после 2 подряд
   * однонаправленных сессий (или 1 критического провала P_delta < -2.5).
   */
  static tmAutoregSuggestions(
    p: RoutinePeriodization,
    workouts: Workout[],
    today: string,
    options?: { energyStatus?: EnergyStatus; longLevers?: boolean },
  ): Array<{
    lift: LaidLift;
    fromMax: number;
    toMax: number;
    changePct: number;
    status: "increased" | "decreased";
    triggerDeloadFlag?: boolean;
  }> {
    if (p.version !== "v2" && p.version !== "v3") return [];
    const settingStart = addCalendarDays(p.startMonday, p.maxesFromWeek * 7);
    const results: Array<{
      lift: LaidLift;
      fromMax: number;
      toMax: number;
      changePct: number;
      status: "increased" | "decreased";
      triggerDeloadFlag?: boolean;
    }> = [];

    if (p.version === "v3") {
      const longLevers = options?.longLevers ?? true;
      const energyStatus: EnergyStatus = options?.energyStatus ?? "optimal_surplus";
      const liftsV3: Array<{ lift: LaidLift; day: LaidDay }> = [
        { lift: "squat", day: "legs1" },
        { lift: "bench", day: "push1" },
        { lift: "deadlift", day: "pull1" },
        { lift: "ohp", day: "push2" },
      ];
      for (const { lift, day } of liftsV3) {
        if (p.painFlags?.includes(lift) || p.calibrationLifts?.includes(lift)) continue;
        const exId = resolveLaidExerciseId(liftExerciseForDay(day, "v3"), p.substitutions);
        const liftWorkouts = workouts
          .filter(
            (w) =>
              w.date >= settingStart &&
              w.date <= today &&
              !DeloadEngine.isDeloadName(w.name) &&
              w.exercises.some(
                (e) =>
                  e.exerciseId === exId &&
                  e.sets.some((s) => s.done && !s.warmup && s.weight > 0 && s.reps >= 1 && s.reps <= 12),
              ),
          )
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-5);

        if (!liftWorkouts.length) continue;

        let workingTm = p.maxes[lift];
        let stalls = 0;
        let triggerDeloadFlag = false;
        for (const w of liftWorkouts) {
          const entry = w.exercises.find((e) => e.exerciseId === exId);
          if (!entry) continue;
          const topSet = entry.sets
            .filter((s) => s.done && !s.warmup && s.weight > 0 && s.reps >= 1)
            .sort((a, b) => b.weight - a.weight)[0];
          if (!topSet) continue;
          const rawWeekIdx = Math.max(0, LaidDupPlan.weekOf(p.startMonday, w.programDate ?? w.date));
          const v3Week = mesocycleWeekFromZeroBased(rawWeekIdx);
          if (v3Week === 6) continue;
          const stim = v3StimulusForWeek(day, v3Week);
          const dec = computeNextWeekLoad({
            workingTmKg: workingTm,
            week: v3Week,
            stimulus: stim,
            actualTopWeightKg: topSet.weight,
            actualReps: topSet.reps,
            actualRir: topSet.rir ?? 2,
            longLevers,
            energyStatus,
            consecutiveStalls: stalls,
          });
          workingTm = dec.nextWorkingTmKg;
          stalls = dec.nextConsecutiveStalls;
          if (dec.triggerDeloadFlag) triggerDeloadFlag = true;
        }
        const toMax = Math.max(20, Math.min(MAX_KG, roundPlate(workingTm, 2.5)));
        if (toMax !== p.maxes[lift]) {
          const changePct = Math.round(((toMax - p.maxes[lift]) / p.maxes[lift]) * 1000) / 1000;
          results.push({
            lift,
            fromMax: p.maxes[lift],
            toMax,
            changePct,
            status: toMax > p.maxes[lift] ? "increased" : "decreased",
            ...(triggerDeloadFlag ? { triggerDeloadFlag: true } : {}),
          });
        }
      }
      return results;
    }

    for (const lift of ["squat", "bench", "deadlift"] as const) {
      if (p.painFlags?.includes(lift) || p.calibrationLifts?.includes(lift)) continue;
      const exId = LaidDupPlan.liftExerciseId(lift, p.substitutions);
      const liftWorkouts = workouts
        .filter(
          (w) =>
            w.date >= settingStart &&
            w.date <= today &&
            !DeloadEngine.isDeloadName(w.name) &&
            w.exercises.some(
              (e) =>
                e.exerciseId === exId &&
                e.sets.some((s) => s.done && !s.warmup && s.weight > 0 && s.reps >= 1 && s.reps <= 8),
            ),
        )
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-6);

      if (!liftWorkouts.length) continue;

      let positiveStreak = 0;
      let negativeStreak = 0;
      const currentTm = Math.round(p.maxes[lift] * 0.9 * 2) / 2;
      let lastChangePct = 0;
      let lastStatus: "increased" | "decreased" | null = null;

      for (const w of liftWorkouts) {
        const entry = w.exercises.find((e) => e.exerciseId === exId);
        if (!entry) continue;
        // Топ-сет: самый тяжёлый рабочий подход сессии
        const topSet = entry.sets
          .filter((s) => s.done && !s.warmup && s.weight > 0 && s.reps >= 1)
          .sort((a, b) => b.weight - a.weight)[0];
        if (!topSet) continue;
        const weekIdx = Math.max(0, LaidDupPlan.weekOf(p.startMonday, w.programDate ?? w.date));
        const dayKey: LaidDay =
          lift === "squat" ? "legs1" : lift === "bench" ? "push1" : "pull1";
        const planned = LaidDupPlan.day(dayKey, weekIdx, p.maxes, {
          version: "v2",
          light: p.light,
          substitutions: p.substitutions,
          deloadWeeks: p.deloadWeeks,
        });
        if (planned.isDeload) continue;
        // Сверяем только если вес близок к плановому топ-сету (в пределах ±12%)
        if (planned.heavy.weightKg > 0 && Math.abs(topSet.weight - planned.heavy.weightKg) / planned.heavy.weightKg > 0.12) {
          continue;
        }
        const dec = ProgressionEngine.evaluateTmUpdate({
          currentTM: currentTm,
          targetReps: planned.heavy.reps,
          targetRIR: 2,
          actualReps: topSet.reps,
          actualRIR: topSet.rir,
          positiveStreak,
          negativeStreak,
        });
        positiveStreak = dec.stateUpdated.positiveStreak;
        negativeStreak = dec.stateUpdated.negativeStreak;
        if (dec.changePct !== 0 && (dec.status === "increased" || dec.status === "decreased")) {
          lastChangePct = dec.changePct;
          lastStatus = dec.status;
        }
      }

      if (lastStatus && lastChangePct !== 0) {
        const rawNext = p.maxes[lift] * (1 + lastChangePct);
        const toMax = Math.max(20, Math.min(MAX_KG, Math.round(rawNext / 2.5) * 2.5));
        if (toMax !== p.maxes[lift]) {
          results.push({
            lift,
            fromMax: p.maxes[lift],
            toMax,
            changePct: lastChangePct,
            status: lastStatus,
          });
        }
      }
    }
    return results;
  }

  static autoMaxes(
    p: RoutinePeriodization,
    workouts: Workout[],
    today: string,
    options: { maxJumpFactor?: number; minorMode?: boolean } = {},
  ): LaidAutoUpdate | null {
    if (options.minorMode) return null;
    const position = LaidDupPlan.position(LaidDupPlan.weekOf(p.startMonday, today));
    if (position.finished) return null;
    const applied = LaidDupPlan.suggestion(p, workouts, today, { maxJumpFactor: options.maxJumpFactor });
    if (!applied.length) return null;
    const maxes = { ...p.maxes };
    for (const item of applied) maxes[item.lift] = item.to;
    return { maxes, applied, fromWeek: position.week };
  }

  static autoNotice(update: LaidAutoUpdate, substitutions?: LaidSubstitutions): string {
    const list = update.applied
      .map((item) => `${LaidDupPlan.liftLabel(item.lift, substitutions)} ${formatKg(item.from)} → ${formatKg(item.to)} кг`)
      .join("; ");
    return `Максимумы обновлены автоматически: ${list}. Оценка — по подходам ${LaidDupPlan.windowText(LaidDupPlan.SUGGEST_DAYS)}, новые веса — с недели ${update.fromWeek + 1}.`;
  }

  static withMaxes(p: RoutinePeriodization, maxes: LaidMaxes, fromWeek: number): RoutinePeriodization {
    const week = Math.max(0, Math.min(LAID_WEEKS, Math.trunc(fromWeek)));
    const earlier = [...(p.earlier ?? []), { fromWeek: p.maxesFromWeek, maxes: p.maxes }]
      .filter((stage) => stage.fromWeek < week)
      .slice(-7);
    return { ...p, maxes: { ...maxes }, maxesFromWeek: week, earlier: earlier.length ? earlier : undefined };
  }

  static catalogSlots(extras: boolean, substitutions?: LaidSubstitutions, version?: LaidVersion): LaidSlotInfo[] {
    const map = new Map<string, LaidSlotInfo>();
    const addSlot = (originalId: string, role: LaidSlotInfo["role"], day: LaidDay, sets: number, lift?: LaidLift) => {
      const resolvedId = resolveLaidExerciseId(originalId, substitutions);
      const prev = map.get(originalId);
      if (prev) {
        if (!prev.days.includes(day)) prev.days.push(day);
        prev.weeklySets += sets;
        if (role === "lift" || role === "wave-aux") prev.role = role;
        if (lift) prev.lift = lift;
      } else {
        map.set(originalId, {
          originalId,
          resolvedId,
          role,
          ...(lift ? { lift } : {}),
          days: [day],
          weeklySets: sets,
          replaced: resolvedId !== originalId,
        });
      }
    };
    const targetDays = daysForVersion(version);
    for (const day of targetDays) {
      const lift = LAID_LIFT_OF[day];
      const originalId = liftExerciseForDay(day, version);
      const liftSetsCount = version === "v3" ? 3 : version === "v2" ? (day === "pull1" || day === "legs2" ? 3 : 4) : 5;
      addSlot(originalId, "lift", day, liftSetsCount, version === "v2" && day === "pull2" ? undefined : lift);
    }
    const allLayouts = layoutForVersion(version);
    for (const day of targetDays) {
      const layout = allLayouts[day];
      for (const x of layout.aux) addSlot(x.exerciseId, x.byWave ? "wave-aux" : "aux", day, x.sets);
      if (extras) for (const x of layout.extras) addSlot(x.exerciseId, "added", day, x.sets);
    }
    return [...map.values()];
  }

  static conflictingIdsForSubstitution(
    originalId: string,
    extras: boolean,
    substitutions?: LaidSubstitutions,
    version?: LaidVersion,
  ): string[] {
    const conflicts = new Set<string>();
    const allLayouts = layoutForVersion(version);
    for (const day of LaidDupPlan.DAYS) {
      const layout = allLayouts[day];
      const dayOriginals = [
        liftExerciseForDay(day, version),
        ...layout.aux.map((x) => x.exerciseId),
        ...(extras ? layout.extras.map((x) => x.exerciseId) : []),
      ];
      if (!dayOriginals.includes(originalId)) continue;
      for (const other of dayOriginals) {
        if (other !== originalId) conflicts.add(resolveLaidExerciseId(other, substitutions));
      }
    }
    return [...conflicts];
  }

  private static summarizeExercisesVolume(items: { exerciseId: string; sets: number; entry?: WorkoutExercise }[]): LaidVolumeSummary {
    const totals = Object.fromEntries(MUSCLES.map((m) => [m.id, 0])) as Record<Muscle, number>;
    let totalSets = 0;
    let axialSets = 0;
    for (const item of items) {
      totalSets += item.sets;
      if (isAxialExercise(item.exerciseId)) axialSets += item.sets;
      const def = (item.entry ? exerciseForEntry(item.entry) : undefined) ?? exerciseById(item.exerciseId);
      if (!def) continue;
      for (const p of def.primary) totals[p] += item.sets;
      for (const s of def.secondary) totals[s] += item.sets * 0.5;
    }
    const muscles = MUSCLES.map((m) => ({
      id: m.id,
      name: m.short,
      sets: Math.round(totals[m.id] * 10) / 10,
    })).filter((m) => m.sets > 0);
    return { totalSets, axialSets, muscles };
  }

  static weeklyMuscleVolume(options: {
    version?: LaidVersion;
    extras: boolean;
    substitutions?: LaidSubstitutions;
  }): LaidVolumeSummary {
    const maxes: LaidMaxes = { squat: 100, bench: 100, deadlift: 100, ohp: 100 };
    const items: { exerciseId: string; sets: number; entry: WorkoutExercise }[] = [];
    for (const day of daysForVersion(options.version)) {
      for (const entry of LaidDupPlan.entries(day, maxes, {
        version: options.version,
        extras: options.extras,
        light: false,
        substitutions: options.substitutions,
      })) {
        items.push({ exerciseId: entry.exerciseId, sets: entry.sets.filter((s) => !s.warmup).length, entry });
      }
    }
    return LaidDupPlan.summarizeExercisesVolume(items);
  }

  static cycleMuscleVolume(cycle: readonly Routine[]): LaidVolumeSummary {
    const items: { exerciseId: string; sets: number; entry: WorkoutExercise }[] = [];
    for (const r of cycle) {
      for (const entry of r.exercises) {
        items.push({ exerciseId: entry.exerciseId, sets: entry.sets.filter((s) => !s.warmup).length, entry });
      }
    }
    return LaidDupPlan.summarizeExercisesVolume(items);
  }

  static withSubstitutions(
    cycle: readonly Routine[],
    nextSubstitutions?: LaidSubstitutions,
    options?: {
      maxes?: LaidMaxes;
      fromWeek?: number;
      calibrationLifts?: readonly LaidLift[];
      painFlags?: readonly LaidLift[];
    },
  ): Routine[] {
    const normalized = LaidDupPlan.normalizeSubstitutions(nextSubstitutions);
    const out: Routine[] = [];
    for (const routine of cycle) {
      const prev = LaidDupPlan.periodizationOf(routine);
      if (!prev) continue;
      const oldSubs = prev.substitutions;
      const nextPeriodizationBase =
        options?.maxes &&
        (["squat", "bench", "deadlift", "ohp"] as const).some((l) => options.maxes![l] !== prev.maxes[l])
          ? LaidDupPlan.withMaxes(prev, options.maxes, options.fromWeek ?? 0)
          : { ...prev };
      const calLifts =
        options?.calibrationLifts !== undefined
          ? options.calibrationLifts.length
            ? [...new Set(options.calibrationLifts)]
            : undefined
          : prev.calibrationLifts;
      const pFlags =
        options?.painFlags !== undefined
          ? options.painFlags.length
            ? [...new Set(options.painFlags)]
            : undefined
          : prev.painFlags;
      const nextPeriodization: RoutinePeriodization = {
        ...nextPeriodizationBase,
        ...(normalized ? { substitutions: normalized } : {}),
        ...(calLifts ? { calibrationLifts: calLifts } : {}),
        ...(pFlags ? { painFlags: pFlags } : {}),
      };
      if (!normalized) delete nextPeriodization.substitutions;
      if (!calLifts) delete nextPeriodization.calibrationLifts;
      if (!pFlags) delete nextPeriodization.painFlags;

      const day = prev.day;
      const layout = layoutForVersion(prev.version)[day];
      const origLiftId = liftExerciseForDay(day, prev.version);
      const slotOriginals = [
        origLiftId,
        ...layout.aux.map((x) => x.exerciseId),
        ...layout.extras.map((x) => x.exerciseId),
      ];
      const remap = new Map<string, string>();
      for (const origId of slotOriginals) {
        const oldId = resolveLaidExerciseId(origId, oldSubs);
        const newId = resolveLaidExerciseId(origId, normalized);
        if (oldId !== newId) remap.set(oldId, newId);
      }

      const activeWeek = options?.fromWeek ?? 0;
      const newPlan = LaidDupPlan.day(day, activeWeek, LaidDupPlan.maxesFor(nextPeriodization, activeWeek), {
        version: nextPeriodization.version,
        light: nextPeriodization.light,
        substitutions: normalized,
        calibrationLifts: calLifts,
        painFlags: pFlags,
      });

      const seen = new Set<string>();
      const nextExercises: WorkoutExercise[] = [];
      for (const entry of routine.exercises) {
        const mappedId = remap.get(entry.exerciseId);
        const targetId = mappedId ?? entry.exerciseId;
        if (seen.has(targetId)) continue;
        seen.add(targetId);

        if (!mappedId) {
          if (entry.exerciseId === newPlan.liftExerciseId && options?.maxes) {
            nextExercises.push({ ...entry, sets: LaidDupPlan.liftSets(newPlan) });
          } else {
            nextExercises.push(entry);
          }
          continue;
        }

        const fresh = makeExerciseEntry(mappedId);
        if (mappedId === newPlan.liftExerciseId) {
          nextExercises.push({
            ...fresh,
            sets: LaidDupPlan.liftSets(newPlan),
          });
        } else {
          const def = exerciseById(mappedId);
          const isDuration = def?.recording.type === "duration";
          const workingCount = Math.max(1, entry.sets.filter((s) => !s.warmup).length || entry.sets.length);
          const fallbackReps = entry.repMin ?? (entry.sets.find((s) => !s.warmup)?.reps || 10);
          nextExercises.push({
            ...fresh,
            sets: makeSets(workingCount, 0, isDuration ? 0 : fallbackReps).map((s) => ({
              ...s,
              rir: null,
              ...(isDuration ? { durationSeconds: 45 } : {}),
            })),
            ...(isDuration
              ? {}
              : {
                  ...(entry.repMin !== undefined ? { repMin: entry.repMin } : {}),
                  ...(entry.repMax !== undefined ? { repMax: entry.repMax } : {}),
                }),
          });
        }
      }

      out.push({
        ...routine,
        exercises: nextExercises,
        periodization: nextPeriodization,
      });
    }
    return out;
  }

  static withDeloadWeek(cycle: readonly Routine[], rawWeek: number, enable: boolean): Routine[] {
    const target = Math.max(0, Math.min(12, Math.trunc(rawWeek)));
    const out: Routine[] = [];
    for (const routine of cycle) {
      const prev = LaidDupPlan.periodizationOf(routine);
      if (!prev) continue;
      const set = new Set(prev.deloadWeeks ?? []);
      if (enable) set.add(target);
      else set.delete(target);
      const nextDeloads = [...set].sort((a, b) => a - b).slice(0, 3);
      const nextP: RoutinePeriodization = { ...prev };
      if (nextDeloads.length) nextP.deloadWeeks = nextDeloads;
      else delete nextP.deloadWeeks;
      out.push({ ...routine, periodization: nextP });
    }
    return out;
  }

  static graduateCalibration(
    cycle: readonly Routine[],
    graduations: readonly LaidCalibrationGraduation[],
    fromWeek: number,
  ): Routine[] {
    if (!graduations.length || !cycle.length) return [];
    const first = LaidDupPlan.periodizationOf(cycle[0]);
    if (!first) return [];
    const nextMaxes: LaidMaxes = { ...first.maxes };
    const graduatedSet = new Set<LaidLift>();
    for (const item of graduations) {
      nextMaxes[item.lift] = item.suggestedTm;
      graduatedSet.add(item.lift);
    }
    const remainingCal = (first.calibrationLifts ?? []).filter((l) => !graduatedSet.has(l));
    return LaidDupPlan.withSubstitutions(cycle, first.substitutions, {
      maxes: nextMaxes,
      fromWeek,
      calibrationLifts: remainingCal,
      painFlags: first.painFlags,
    });
  }

  /** Последний выполненный рабочий подход по упражнению (без разгрузочных тренировок) для показа рабочего веса в плане и заменах. */
  static lastWorkingSetSummary(
    workouts: readonly Workout[],
    exerciseId: string,
    today?: string,
  ): LaidLastSetSummary | null {
    const def = exerciseById(exerciseId);
    const loadMode = def?.recording.loadMode;
    const isDuration = def?.recording.type === "duration";
    let best: { date: string; updatedAt: string; set: SetEntry } | null = null;
    for (const w of workouts) {
      if (today && w.date > today) continue;
      if (DeloadEngine.isDeloadName(w.name) || w.notes?.toLowerCase().includes("разгрузочная неделя")) continue;
      const entry = w.exercises.find((e) => e.exerciseId === exerciseId);
      if (!entry) continue;
      const workSet = entry.sets.find((s) => s.done && !s.warmup && (isDuration ? (s.durationSeconds ?? 0) > 0 : s.reps > 0));
      if (!workSet) continue;
      const updated = w.updatedAt ?? "";
      if (!best || w.date > best.date || (w.date === best.date && updated > best.updatedAt)) {
        best = { date: w.date, updatedAt: updated, set: workSet };
      }
    }
    if (!best) return null;
    const s = best.set;
    let label: string;
    if (isDuration) {
      label = `${s.durationSeconds ?? 30} с`;
    } else if (loadMode === "bodyweight") {
      label = `свой вес × ${s.reps}`;
    } else if (loadMode === "assisted_bodyweight") {
      label = `помощь ${formatKg(s.assistanceKg ?? 0)} кг × ${s.reps}`;
    } else if (loadMode === "per_implement") {
      label = s.weight > 0 ? `${formatKg(s.weight)} кг/гант. × ${s.reps}` : `× ${s.reps}`;
    } else {
      label = s.weight > 0 ? `${formatKg(s.weight)} кг × ${s.reps}` : `× ${s.reps}`;
    }
    return {
      weightKg: s.weight,
      reps: s.reps,
      rir: s.rir,
      ...(isDuration ? { durationSeconds: s.durationSeconds } : {}),
      ...(loadMode === "assisted_bodyweight" ? { assistanceKg: s.assistanceKg } : {}),
      date: best.date,
      label,
    };
  }

  /** Полный состав дня для конкретной недели цикла: вес (DUP или из истории), подходы × повторы, целевой RIR и отдых. */
  static dayExercisesPreview(
    routine: Routine,
    week: number,
    workouts: readonly Workout[],
    today?: string,
  ): LaidDayExercisePreview[] {
    const p = LaidDupPlan.periodizationOf(routine);
    if (!p) return [];
    const deloadsBefore = (p.deloadWeeks ?? []).filter((w) => w < week).length;
    const isWeekDeload = LaidDupPlan.isDeloadWeek(p, week);
    const effIdx = isWeekDeload ? Math.max(0, week - deloadsBefore - 1) : week - deloadsBefore;
    const effPos = LaidDupPlan.position(effIdx);
    const maxes = LaidDupPlan.maxesFor(p, effPos.week);
    const plan = LaidDupPlan.day(p.day, week, maxes, {
      version: p.version,
      light: p.light,
      substitutions: p.substitutions,
      calibrationLifts: p.calibrationLifts,
      painFlags: p.painFlags,
      deloadWeeks: p.deloadWeeks,
    });
    const subs = p.substitutions;
    const reverseSub = new Map<string, string>();
    if (subs) {
      for (const [orig, repl] of Object.entries(subs)) reverseSub.set(repl, orig);
    }

    return routine.exercises.map((entry) => {
      const def = exerciseForEntry(entry) ?? exerciseById(entry.exerciseId);
      const loadMode = def?.recording.loadMode;
      const isDuration = def?.recording.type === "duration";
      const spec = buildExerciseSpec(p.day, entry.exerciseId, subs, p.version);
      const guidance = buildExerciseGuidance(p.day, entry.exerciseId, plan, subs, { deload: isWeekDeload });
      const originalId = spec.replacedFrom ?? reverseSub.get(entry.exerciseId) ?? entry.exerciseId;
      const replacedFromName = spec.replacedFrom ? (exerciseById(spec.replacedFrom)?.name ?? spec.replacedFrom) : null;
      const isLift = entry.exerciseId === plan.liftExerciseId;
      const last = LaidDupPlan.lastWorkingSetSummary(workouts, entry.exerciseId, today);

      const workingSets = entry.sets.filter((s) => !s.warmup);
      const baseSetCount = Math.max(1, workingSets.length || entry.sets.length);
      const effectiveSetCount = isWeekDeload ? Math.max(1, Math.floor(baseSetCount * 0.5)) : baseSetCount;

      let setsRepsLabel: string;
      let weightLabel: string;
      let weightSource: LaidDayExercisePreview["weightSource"];

      if (isLift) {
        setsRepsLabel = `1×${plan.heavy.reps} + ${plan.work.sets}×${plan.work.reps}`;
        if (plan.prescriptionMode === "percent_1rm") {
          weightLabel = `${formatKg(plan.heavy.weightKg)} / ${formatKg(plan.work.weightKg)} кг`;
          weightSource = isWeekDeload ? "deload" : "plan";
        } else if (last && last.weightKg > 0) {
          const factor = p.version === "v2" ? 0.85 : 0.65;
          const shownKg = isWeekDeload ? Math.round(last.weightKg * factor * 2) / 2 : last.weightKg;
          weightLabel = isWeekDeload ? `${formatKg(shownKg)} кг (${Math.round(factor * 100)} %)` : `${formatKg(shownKg)} кг`;
          weightSource = isWeekDeload ? "deload" : "history";
        } else {
          weightLabel = plan.prescriptionMode === "calibration" ? "калибровка" : "по RIR";
          weightSource = "none";
        }
      } else {
        const waveReps = laidAuxReps(p.day, entry.exerciseId, plan.position.inWave, subs, p.version);
        if (isDuration) {
          const sec = workingSets[0]?.durationSeconds ?? 45;
          setsRepsLabel = `${effectiveSetCount} × ${sec} с`;
        } else if (waveReps !== null) {
          setsRepsLabel = `${effectiveSetCount} × ${waveReps}`;
        } else if (entry.repMin !== undefined && entry.repMax !== undefined) {
          setsRepsLabel =
            entry.repMin === entry.repMax
              ? `${effectiveSetCount} × ${entry.repMin}`
              : `${effectiveSetCount} × ${entry.repMin}–${entry.repMax}`;
        } else {
          const r = workingSets[0]?.reps || 10;
          setsRepsLabel = `${effectiveSetCount} × ${r}`;
        }

        const plannedKg = workingSets[0]?.weight ?? 0;
        const unit = loadMode === "per_implement" ? " кг/гант." : " кг";
        if (loadMode === "bodyweight") {
          weightLabel = "свой вес";
          weightSource = "bodyweight";
        } else if (isDuration) {
          weightLabel = last ? last.label : "по таймеру";
          weightSource = last ? "history" : "none";
        } else if (last && last.weightKg > 0) {
          if (isWeekDeload && DeloadEngine.isScalable(loadMode)) {
            const deloadKg = Math.round(last.weightKg * 0.65 * 2) / 2;
            weightLabel = `${formatKg(deloadKg)}${unit} (65 %)`;
            weightSource = "deload";
          } else {
            weightLabel = `${formatKg(last.weightKg)}${unit}`;
            weightSource = "history";
          }
        } else if (plannedKg > 0) {
          weightLabel = `${formatKg(plannedKg)}${unit}`;
          weightSource = "plan";
        } else {
          weightLabel = "подбери вес";
          weightSource = "none";
        }
      }

      const compactRir = isWeekDeload
        ? p.version === "v3"
          ? "RIR 4,0"
          : "RIR 3–4"
        : p.version === "v3"
          ? guidance.rirLabel
          : isLift && plan.prescriptionMode === "percent_1rm"
            ? plan.position.wave === 3
              ? "Топ 0,5–1 · раб. 2"
              : plan.position.wave === 2
                ? "Топ 1 · раб. 2–3"
                : "Топ 1–2 · раб. 2–3"
            : guidance.rirPlaceholder
              ? `RIR ${guidance.rirPlaceholder}`
              : "RIR 1–2";

      return {
        originalId,
        exerciseId: entry.exerciseId,
        name: entryName(entry),
        replacedFromName,
        role: spec.role,
        setsRepsLabel,
        weightLabel,
        weightSource,
        rirLabel: compactRir,
        restLabel: guidance.restLabel,
        isAdded: spec.added,
        isReplaced: !!spec.replacedFrom,
        ...(guidance.supersetTag ? { supersetTag: guidance.supersetTag } : {}),
        ...(guidance.lengthenedPartials ? { lengthenedPartials: true } : {}),
      };
    });
  }

  /** Прогресс по волнам (1 → 2 → 3) для графика внутри цикла Лейда: плановый пик тяжёлых подходов и фактический лучший e1RM по неделям. */
  static waveProgress(
    cycle: readonly Routine[],
    workouts: readonly Workout[],
    today: string,
  ): LaidWaveLiftProgress[] {
    if (!cycle.length || !cycle[0].periodization) return [];
    const first = cycle[0].periodization;
    const totalWeeks = LaidDupPlan.totalWeeks(first);
    const startMaxes = LaidDupPlan.maxesFor(first, 0);
    const state = LaidDupPlan.cycleState(cycle, workouts as Workout[], today);
    const currentMaxes = state.activeMaxes;
    const lifts: LaidLift[] = ["squat", "bench", "deadlift", "ohp"];

    return lifts.map((lift) => {
      const baseExId =
        first.version === "v3"
          ? lift === "deadlift"
            ? "trap-bar-deadlift"
            : lift === "ohp"
              ? "incline-bar"
              : LAID_LIFT_EXERCISE[lift]
          : first.version === "v2" && lift === "deadlift"
            ? "trap-bar-deadlift"
            : LAID_LIFT_EXERCISE[lift];
      const exerciseId = resolveLaidExerciseId(baseExId, first.substitutions);
      const liftDays = cycle.filter(
        (r) => r.periodization && LAID_LIFT_OF[r.periodization.day] === lift && !(first.version === "v2" && r.periodization.day === "pull2"),
      );
      const weeks: LaidWaveWeekPoint[] = [];
      const waveStats = new Map<1 | 2 | 3, { plannedPeak: number | null; bestE1rm: number | null; sessions: Set<string> }>([
        [1, { plannedPeak: null, bestE1rm: null, sessions: new Set() }],
        [2, { plannedPeak: null, bestE1rm: null, sessions: new Set() }],
        [3, { plannedPeak: null, bestE1rm: null, sessions: new Set() }],
      ]);

      let overallPlannedPeak: number | null = null;
      let overallBestE1rm: number | null = null;

      for (let week = 0; week < totalWeeks; week++) {
        const isDeload = LaidDupPlan.isDeloadWeek(first, week);
        const deloadsBefore = (first.deloadWeeks ?? []).filter((w) => w < week).length;
        const effIdx = isDeload ? Math.max(0, week - deloadsBefore - 1) : week - deloadsBefore;
        const pos = LaidDupPlan.position(effIdx);
        const maxes = LaidDupPlan.maxesFor(first, pos.week);

        let plannedTopKg: number | null = null;
        for (const r of liftDays) {
          const p = r.periodization!;
          const dayPlan = LaidDupPlan.day(p.day, week, maxes, {
            version: p.version,
            light: p.light,
            substitutions: p.substitutions,
            calibrationLifts: p.calibrationLifts,
            painFlags: p.painFlags,
            deloadWeeks: p.deloadWeeks,
          });
          if (dayPlan.prescriptionMode === "percent_1rm" && dayPlan.heavy.weightKg > 0) {
            if (plannedTopKg === null || dayPlan.heavy.weightKg > plannedTopKg) {
              plannedTopKg = dayPlan.heavy.weightKg;
            }
          }
        }

        const weekStartDate = addCalendarDays(first.startMonday, week * 7);
        const weekEndDate = addCalendarDays(weekStartDate, 6);
        let actualE1rm: number | null = null;
        let actualTopKg: number | null = null;

        for (const w of workouts) {
          const effDate = w.programDate ?? w.date;
          if (effDate < weekStartDate || effDate > weekEndDate || effDate > today) continue;
          let matchedSession = false;
          for (const entry of w.exercises) {
            if (entry.exerciseId !== exerciseId) continue;
            for (const set of entry.sets) {
              if (!set.done || set.warmup || set.weight <= 0 || set.reps < 1) continue;
              const rom = set.execution?.rom ?? entry.execution?.rom;
              if (rom === "shortened_partial" || rom === "lengthened_partial") continue;
              matchedSession = true;
              if (actualTopKg === null || set.weight > actualTopKg) actualTopKg = set.weight;
              if (set.reps <= 12) {
                const est = OneRepMaxFormulas.epley(set.weight, set.reps);
                if (est !== null && (actualE1rm === null || est > actualE1rm)) {
                  actualE1rm = Math.round(est * 10) / 10;
                }
              }
            }
          }
          if (matchedSession && !isDeload) {
            waveStats.get(pos.wave)!.sessions.add(w.id);
          }
        }

        if (!isDeload) {
          const ws = waveStats.get(pos.wave)!;
          if (plannedTopKg !== null && (ws.plannedPeak === null || plannedTopKg > ws.plannedPeak)) {
            ws.plannedPeak = plannedTopKg;
          }
          if (actualE1rm !== null && (ws.bestE1rm === null || actualE1rm > ws.bestE1rm)) {
            ws.bestE1rm = actualE1rm;
          }
        }
        if (plannedTopKg !== null && (overallPlannedPeak === null || plannedTopKg > overallPlannedPeak)) {
          overallPlannedPeak = plannedTopKg;
        }
        if (actualE1rm !== null && (overallBestE1rm === null || actualE1rm > overallBestE1rm)) {
          overallBestE1rm = actualE1rm;
        }

        weeks.push({
          week,
          weekNumber: week + 1,
          wave: pos.wave,
          isDeload,
          plannedTopKg,
          actualE1rm,
          actualTopKg,
        });
      }

      const deltaKg =
        overallBestE1rm !== null
          ? Math.round((overallBestE1rm - startMaxes[lift]) * 10) / 10
          : null;

      return {
        lift,
        name: LaidDupPlan.liftLabel(lift, first.substitutions),
        exerciseId,
        startMaxKg: startMaxes[lift],
        currentMaxKg: currentMaxes[lift],
        plannedPeakKg: overallPlannedPeak,
        bestE1rm: overallBestE1rm,
        deltaKg,
        weeks,
        waves: ([1, 2, 3] as const).map((wave) => {
          const ws = waveStats.get(wave)!;
          return {
            wave,
            title: LAID_WAVE_META[wave].title,
            plannedPeakKg: ws.plannedPeak,
            bestE1rm: ws.bestE1rm,
            sessionsDone: ws.sessions.size,
          };
        }),
      };
    });
  }
}
