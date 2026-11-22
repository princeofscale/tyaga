import { addCalendarDays, localDate, type Muscle, type Workout } from "../lib/model";
import { AnalyticsFacts } from "./AnalyticsFacts";
import { OneRepMaxFormulas } from "./OneRepMaxFormulas";

const MS_PER_DAY = 86_400_000;
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / MS_PER_DAY,
  );
}

export type ReadinessGroupId = "chest" | "back" | "legs" | "shoulders" | "arms";
export type ReadinessState = "ready" | "recovering" | "fatigued";

export type MuscleReadinessItem = {
  id: ReadinessGroupId;
  label: string;
  daysAgo: number | null;
  lastSets: number;
  lastDate: string | null;
  /** 0..1 визуальная заполненность готовности с учётом объёма и RIR. */
  ratio: number;
  state: ReadinessState;
  statusText: string;
  /** Эффективная усталостная нагрузка последней сессии (учитывает RIR и повторы). */
  effectiveLoad: number;
  /** Средний RIR последней прямой сессии (null, если не заполнялся). */
  avgRir: number | null;
  /** Косвенные (синергистские) подходы за последние 48 ч. */
  synergistSets: number;
};

const GROUPS: Array<{ id: ReadinessGroupId; label: string; muscles: Muscle[]; recoveryDays: number }> = [
  { id: "chest", label: "Грудь", muscles: ["chest"], recoveryDays: 3 },
  { id: "back", label: "Спина", muscles: ["back"], recoveryDays: 3 },
  { id: "legs", label: "Ноги", muscles: ["quads", "hamstrings", "glutes", "calves"], recoveryDays: 3 },
  { id: "shoulders", label: "Плечи", muscles: ["shoulders"], recoveryDays: 2 },
  { id: "arms", label: "Руки", muscles: ["biceps", "triceps"], recoveryDays: 2 },
];

/**
 * Показывает, какие мышечные группы свежие, а какие недавно получили нагрузку.
 * Основано на выполненных рабочих подходах (дедуплицированных через AnalyticsFacts),
 * с модуляцией восстановления по объёму и усилию (RIR + повторения).
 */
export class MuscleReadiness {
  static fromWorkouts(
    workouts: Workout[],
    today: string,
    timeZone?: string,
  ): MuscleReadinessItem[] {
    const windowStart = addCalendarDays(today, -30);
    const facts = new AnalyticsFacts(workouts, {
      from: windowStart,
      through: today,
      includeFuture: true,
      timeZone,
      setKind: "working",
      completedOnly: true,
    }).sets();

    const perDateGroup = new Map<
      string,
      {
        groupId: ReadinessGroupId;
        date: string;
        sets: number;
        fatigueUnits: number;
        rirSum: number;
        rirCount: number;
      }
    >();
    const recentSynergist = new Map<ReadinessGroupId, number>();

    for (const { workout, exercise, set } of facts) {
      if (!exercise || workout.date > today) continue;
      const primaryZones =
        !exercise.primary.length && exercise.custom?.declaredZones?.length
          ? exercise.custom.declaredZones
          : exercise.primary;
      const primarySet = new Set<Muscle>(primaryZones);
      const secondarySet = new Set<Muscle>(
        exercise.secondary.filter((z) => !primarySet.has(z)),
      );
      const effort = OneRepMaxFormulas.setEffortProfile(set.reps, set.rir);

      for (const group of GROUPS) {
        if (group.muscles.some((m) => primarySet.has(m))) {
          const key = `${group.id}:${workout.date}`;
          const cur = perDateGroup.get(key) ?? {
            groupId: group.id,
            date: workout.date,
            sets: 0,
            fatigueUnits: 0,
            rirSum: 0,
            rirCount: 0,
          };
          cur.sets += 1;
          cur.fatigueUnits += effort.fatigue;
          if (set.rir !== null) {
            cur.rirSum += set.rir;
            cur.rirCount += 1;
          }
          perDateGroup.set(key, cur);
        } else if (
          group.muscles.some((m) => secondarySet.has(m)) &&
          daysBetween(workout.date, today) <= 2
        ) {
          recentSynergist.set(group.id, (recentSynergist.get(group.id) ?? 0) + 1);
        }
      }
    }

    const latest = new Map<
      ReadinessGroupId,
      { date: string; sets: number; fatigueUnits: number; avgRir: number | null }
    >();
    for (const entry of perDateGroup.values()) {
      const prev = latest.get(entry.groupId);
      if (!prev || entry.date > prev.date) {
        latest.set(entry.groupId, {
          date: entry.date,
          sets: entry.sets,
          fatigueUnits: entry.fatigueUnits,
          avgRir: entry.rirCount ? Math.round((entry.rirSum / entry.rirCount) * 10) / 10 : null,
        });
      }
    }

    return GROUPS.map((group) => {
      const hit = latest.get(group.id);
      const synergistSets = recentSynergist.get(group.id) ?? 0;
      if (!hit) {
        return {
          id: group.id,
          label: group.label,
          daysAgo: null,
          lastSets: 0,
          lastDate: null,
          ratio: 1,
          state: "ready",
          statusText: "Готовы",
          effectiveLoad: 0,
          avgRir: null,
          synergistSets,
        };
      }

      const daysAgo = Math.max(0, daysBetween(hit.date, today));
      // Модуляция окна восстановления: 1–2 лёгких подхода (fatigueUnits ~1–2) остывают быстрее,
      // а 10+ тяжёлых подходов в отказ (fatigueUnits >= 11) удлиняют восстановление на +1 день.
      const loadShift =
        hit.fatigueUnits >= 10
          ? 0.85
          : hit.fatigueUnits >= 7
            ? 0.4
            : hit.fatigueUnits <= 2.2
              ? -0.5
              : 0;
      const effectiveRecoveryDays = Math.max(1.5, group.recoveryDays + loadShift);
      const ratio = Math.min(1, Math.max(0.18, daysAgo / effectiveRecoveryDays));
      const state: ReadinessState =
        daysAgo >= effectiveRecoveryDays
          ? "ready"
          : daysAgo === 0 || (daysAgo === 1 && hit.fatigueUnits >= 10)
            ? "fatigued"
            : "recovering";
      const statusText =
        daysAgo === 0
          ? "Сегодня"
          : daysAgo === 1
            ? "Вчера"
            : `${daysAgo} дн.`;
      return {
        id: group.id,
        label: group.label,
        daysAgo,
        lastSets: hit.sets,
        lastDate: hit.date,
        ratio: Math.round(ratio * 100) / 100,
        state,
        statusText,
        effectiveLoad: Math.round(hit.fatigueUnits * 10) / 10,
        avgRir: hit.avgRir,
        synergistSets,
      };
    });
  }

  static forNow(workouts: Workout[], timeZone?: string, now = new Date()): MuscleReadinessItem[] {
    return MuscleReadiness.fromWorkouts(workouts, localDate(now, timeZone), timeZone);
  }
}
