import {
  estimatedOneRepMax,
  exerciseForEntry,
  entryName,
  progressKey,
  weekStart,
  addCalendarDays,
  localDate,
  type Workout,
  type WorkoutExercise,
  type SetEntry,
} from "../lib/model";

export interface ExercisePR {
  exerciseId: string;
  name: string;
  key: string;
  bestWeight: {
    weight: number;
    reps: number;
    date: string;
    workoutName: string;
  };
  bestE1rm: {
    e1rm: number;
    weight: number;
    reps: number;
    date: string;
    workoutName: string;
  } | null;
  bestSetVolume: {
    volume: number;
    weight: number;
    reps: number;
    date: string;
    workoutName: string;
  };
  totalSets: number;
  totalReps: number;
  totalVolume: number;
  workoutCount: number;
  lastTrained: string;
}

export interface ActivityHeatmapDay {
  date: string;
  dayOfWeek: number; // 0 = Mon, 6 = Sun
  weekIndex: number;
  workoutsCount: number;
  totalVolume: number;
  workingSets: number;
  names: string[];
  intensity: 0 | 1 | 2 | 3;
}

export interface VolumeTrends {
  recentVolume: number;
  priorVolume: number;
  growthPct: number;
  weeklyAverages: { weekStart: string; volume: number; sets: number }[];
}

export interface BalanceRatios {
  pushSets: number;
  pullSets: number;
  upperSets: number;
  lowerSets: number;
  pushPullRatio: number | null;
  upperLowerRatio: number | null;
  pushPullStatus: "balanced" | "push-dominant" | "pull-dominant" | "no-data";
  upperLowerStatus: "balanced" | "upper-dominant" | "lower-dominant" | "no-data";
}

export class PersonalRecordsCalculator {
  constructor(private workouts: Workout[]) {}

  /** Calculates all personal records (1RM, max weight, set volume) across workout history. */
  calculateRecords(): ExercisePR[] {
    const recordMap = new Map<string, ExercisePR>();

    for (const w of this.workouts) {
      for (const we of w.exercises) {
        const key = progressKey(we);
        const name = entryName(we);
        const spec = exerciseForEntry(we)?.recording;
        const workingSets = we.sets.filter((s) => s.done && !s.warmup);

        if (!workingSets.length) continue;

        let pr = recordMap.get(key);
        if (!pr) {
          pr = {
            exerciseId: we.exerciseId,
            name,
            key,
            bestWeight: { weight: 0, reps: 0, date: w.date, workoutName: w.name },
            bestE1rm: null,
            bestSetVolume: { volume: 0, weight: 0, reps: 0, date: w.date, workoutName: w.name },
            totalSets: 0,
            totalReps: 0,
            totalVolume: 0,
            workoutCount: 0,
            lastTrained: w.date,
          };
          recordMap.set(key, pr);
        }

        pr.workoutCount++;
        if (w.date >= pr.lastTrained) {
          pr.lastTrained = w.date;
        }

        for (const s of workingSets) {
          pr.totalSets++;
          const reps = spec?.type === "duration" ? (s.durationSeconds ?? 0) : s.reps;
          pr.totalReps += reps;

          const load = spec?.loadMode === "assisted_bodyweight"
            ? (s.assistanceKg ?? 0)
            : s.weight;
          const setVolume = load * reps;
          pr.totalVolume += setVolume;

          // Max weight PR
          if (load > pr.bestWeight.weight || (load === pr.bestWeight.weight && reps > pr.bestWeight.reps)) {
            pr.bestWeight = {
              weight: load,
              reps,
              date: w.date,
              workoutName: w.name,
            };
          }

          // Best single-set volume
          if (setVolume > pr.bestSetVolume.volume) {
            pr.bestSetVolume = {
              volume: setVolume,
              weight: load,
              reps,
              date: w.date,
              workoutName: w.name,
            };
          }

          // Estimated 1RM
          const e1rm = estimatedOneRepMax(s, we);
          if (e1rm !== null) {
            if (!pr.bestE1rm || e1rm > pr.bestE1rm.e1rm) {
              pr.bestE1rm = {
                e1rm: Math.round(e1rm * 10) / 10,
                weight: s.weight,
                reps: s.reps,
                date: w.date,
                workoutName: w.name,
              };
            }
          }
        }
      }
    }

    return Array.from(recordMap.values()).sort(
      (a, b) => b.totalVolume - a.totalVolume || b.totalSets - a.totalSets,
    );
  }

  /** Calculates training streak in consecutive weeks. */
  calculateStreak(timeZone?: string): { currentWeekStreak: number; bestWeekStreak: number; totalWeeks: number } {
    if (!this.workouts.length) {
      return { currentWeekStreak: 0, bestWeekStreak: 0, totalWeeks: 0 };
    }

    const today = localDate(new Date(), timeZone);
    const thisWeek = weekStart(new Date(), timeZone);

    const weekSet = new Set<string>();
    for (const w of this.workouts) {
      if (w.exercises.some((e) => e.sets.some((s) => s.done))) {
        const d = new Date(w.date + "T12:00:00");
        weekSet.add(weekStart(d, timeZone));
      }
    }

    const sortedWeeks = Array.from(weekSet).sort();
    if (!sortedWeeks.length) {
      return { currentWeekStreak: 0, bestWeekStreak: 0, totalWeeks: 0 };
    }

    // Check consecutive weeks backward from this week or last week
    let currentStreak = 0;
    let checkWeek = thisWeek;

    if (!weekSet.has(checkWeek)) {
      // If haven't trained yet this week, check if trained last week
      const lastWeek = addCalendarDays(checkWeek, -7);
      if (weekSet.has(lastWeek)) {
        checkWeek = lastWeek;
      }
    }

    while (weekSet.has(checkWeek)) {
      currentStreak++;
      checkWeek = addCalendarDays(checkWeek, -7);
    }

    // Calculate best all-time streak
    let bestStreak = 0;
    let runningStreak = 0;
    let expectedWeek = "";

    for (const w of sortedWeeks) {
      if (!expectedWeek) {
        runningStreak = 1;
      } else if (w === expectedWeek) {
        runningStreak++;
      } else {
        runningStreak = 1;
      }
      bestStreak = Math.max(bestStreak, runningStreak);
      expectedWeek = addCalendarDays(w, 7);
    }

    return {
      currentWeekStreak: currentStreak,
      bestWeekStreak: Math.max(bestStreak, currentStreak),
      totalWeeks: weekSet.size,
    };
  }

  /** Calculates volume trends (recent 4 weeks vs prior 4 weeks) and weekly volume averages. */
  calculateVolumeTrends(timeZone?: string): VolumeTrends {
    const today = localDate(new Date(), timeZone);
    const day28 = addCalendarDays(today, -28);
    const day56 = addCalendarDays(today, -56);

    let recentVolume = 0;
    let priorVolume = 0;

    const weeklyMap = new Map<string, { volume: number; sets: number }>();

    for (const w of this.workouts) {
      const vol = w.exercises.reduce(
        (sum, e) =>
          sum +
          e.sets
            .filter((s) => s.done)
            .reduce((sVol, s) => sVol + s.weight * s.reps, 0),
        0,
      );
      const setsCount = w.exercises.reduce(
        (sum, e) => sum + e.sets.filter((s) => s.done && !s.warmup).length,
        0,
      );

      if (w.date > day28 && w.date <= today) {
        recentVolume += vol;
      } else if (w.date > day56 && w.date <= day28) {
        priorVolume += vol;
      }

      // Group into 12 recent weeks
      const d = new Date(w.date + "T12:00:00");
      const wStart = weekStart(d, timeZone);
      if (wStart >= addCalendarDays(today, -84)) {
        const cur = weeklyMap.get(wStart) ?? { volume: 0, sets: 0 };
        cur.volume += vol;
        cur.sets += setsCount;
        weeklyMap.set(wStart, cur);
      }
    }

    const growthPct =
      priorVolume > 0
        ? Math.round(((recentVolume - priorVolume) / priorVolume) * 100)
        : recentVolume > 0
          ? 100
          : 0;

    const weeklyAverages = Array.from(weeklyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([wStart, data]) => ({
        weekStart: wStart,
        volume: Math.round(data.volume),
        sets: data.sets,
      }));

    return {
      recentVolume: Math.round(recentVolume),
      priorVolume: Math.round(priorVolume),
      growthPct,
      weeklyAverages,
    };
  }

  /** Calculates Push vs Pull and Upper vs Lower muscle balance ratios. */
  calculateRatios(): BalanceRatios {
    let pushSets = 0;
    let pullSets = 0;
    let upperSets = 0;
    let lowerSets = 0;

    for (const w of this.workouts) {
      for (const we of w.exercises) {
        const ex = exerciseForEntry(we);
        if (!ex) continue;
        const count = we.sets.filter((s) => s.done && !s.warmup).length;
        if (!count) continue;

        const isPush =
          ex.primary.some((p) => ["chest", "triceps", "shoulders"].includes(p)) ||
          ex.muscles.some((m) =>
            ["pectoralis-major", "triceps-brachii", "deltoid-anterior"].includes(m.muscleId) &&
            m.role === "primary",
          );

        const isPull =
          ex.primary.some((p) => ["back", "biceps"].includes(p)) ||
          ex.muscles.some((m) =>
            ["latissimus-dorsi", "biceps-brachii", "trapezius-upper", "deltoid-posterior"].includes(m.muscleId) &&
            m.role === "primary",
          );

        const isUpper = ex.primary.some((p) =>
          ["chest", "back", "shoulders", "biceps", "triceps", "core"].includes(p),
        );
        const isLower = ex.primary.some((p) =>
          ["quads", "hamstrings", "glutes", "calves"].includes(p),
        );

        if (isPush) pushSets += count;
        if (isPull) pullSets += count;
        if (isUpper) upperSets += count;
        if (isLower) lowerSets += count;
      }
    }

    let pushPullRatio: number | null = null;
    let pushPullStatus: BalanceRatios["pushPullStatus"] = "no-data";
    if (pushSets === 0 && pullSets === 0) {
      pushPullRatio = null;
      pushPullStatus = "no-data";
    } else if (pullSets === 0) {
      pushPullRatio = null;
      pushPullStatus = "push-dominant";
    } else if (pushSets === 0) {
      pushPullRatio = 0;
      pushPullStatus = "pull-dominant";
    } else {
      pushPullRatio = Math.round((pushSets / pullSets) * 100) / 100;
      pushPullStatus =
        pushPullRatio > 1.35
          ? "push-dominant"
          : pushPullRatio < 0.75
            ? "pull-dominant"
            : "balanced";
    }

    let upperLowerRatio: number | null = null;
    let upperLowerStatus: BalanceRatios["upperLowerStatus"] = "no-data";
    if (upperSets === 0 && lowerSets === 0) {
      upperLowerRatio = null;
      upperLowerStatus = "no-data";
    } else if (lowerSets === 0) {
      upperLowerRatio = null;
      upperLowerStatus = "upper-dominant";
    } else if (upperSets === 0) {
      upperLowerRatio = 0;
      upperLowerStatus = "lower-dominant";
    } else {
      upperLowerRatio = Math.round((upperSets / lowerSets) * 100) / 100;
      upperLowerStatus =
        upperLowerRatio > 1.8
          ? "upper-dominant"
          : upperLowerRatio < 0.75
            ? "lower-dominant"
            : "balanced";
    }

    return {
      pushSets,
      pullSets,
      upperSets,
      lowerSets,
      pushPullRatio,
      upperLowerRatio,
      pushPullStatus,
      upperLowerStatus,
    };
  }

  /** Generates data for a GitHub-style activity calendar heatmap (e.g. 16 weeks). */
  calculateHeatmap(weeksCount = 16, timeZone?: string): ActivityHeatmapDay[] {
    const today = localDate(new Date(), timeZone);
    const thisWeekStart = weekStart(new Date(), timeZone);
    const startWeek = addCalendarDays(thisWeekStart, -(weeksCount - 1) * 7);

    // Map workouts by date
    const dateMap = new Map<string, { workouts: Workout[]; volume: number; workingSets: number }>();
    for (const w of this.workouts) {
      if (w.date >= startWeek && w.date <= today) {
        const cur = dateMap.get(w.date) ?? { workouts: [], volume: 0, workingSets: 0 };
        cur.workouts.push(w);
        cur.volume += w.exercises.reduce(
          (sum, e) =>
            sum +
            e.sets
              .filter((s) => s.done)
              .reduce((sVol, s) => sVol + s.weight * s.reps, 0),
          0,
        );
        cur.workingSets += w.exercises.reduce(
          (sum, e) => sum + e.sets.filter((s) => s.done && !s.warmup).length,
          0,
        );
        dateMap.set(w.date, cur);
      }
    }

    const days: ActivityHeatmapDay[] = [];
    const totalDays = weeksCount * 7;

    for (let i = 0; i < totalDays; i++) {
      const date = addCalendarDays(startWeek, i);
      if (date > today) {
        // Future days in current week
        const dayOfWeek = i % 7;
        const weekIndex = Math.floor(i / 7);
        days.push({
          date,
          dayOfWeek,
          weekIndex,
          workoutsCount: 0,
          totalVolume: 0,
          workingSets: 0,
          names: [],
          intensity: 0,
        });
        continue;
      }

      const dayOfWeek = i % 7;
      const weekIndex = Math.floor(i / 7);
      const data = dateMap.get(date);

      let intensity: 0 | 1 | 2 | 3 = 0;
      if (data && data.workingSets > 0) {
        if (data.workingSets <= 6) intensity = 1;
        else if (data.workingSets <= 14) intensity = 2;
        else intensity = 3;
      }

      days.push({
        date,
        dayOfWeek,
        weekIndex,
        workoutsCount: data ? data.workouts.length : 0,
        totalVolume: data ? Math.round(data.volume) : 0,
        workingSets: data ? data.workingSets : 0,
        names: data ? data.workouts.map((w) => w.name) : [],
        intensity,
      });
    }

    return days;
  }
}
