import { addCalendarDays, localDate, type Exercise, type Muscle, type Workout } from "../lib/model";
import { AnalyticsFacts } from "./AnalyticsFacts";
import { OneRepMaxFormulas } from "./OneRepMaxFormulas";

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / MS_PER_DAY,
  );
}

export type ReadinessGroupId = "chest" | "back" | "legs" | "shoulders" | "arms";
export type ReadinessState = "ready" | "recovering" | "fatigued";

export type MuscleReadinessGroupV2Id =
  | "erectors"
  | "hamstrings"
  | "quads"
  | "glutes"
  | "chest"
  | "lats_upper_back"
  | "triceps"
  | "biceps"
  | "front_delts"
  | "side_rear_delts"
  | "calves"
  | "abs";

export type ReadinessStatusV2 = "fresh" | "usable" | "recovering" | "fatigued";

export interface MuscleReadinessV2Item {
  id: MuscleReadinessGroupV2Id;
  label: string;
  halfLifeHours: number;
  fatigueLoad: number;
  readinessPct: number;
  status: ReadinessStatusV2;
  canTrain: boolean;
  directSets10d: number;
  synergistSets10d: number;
}

export const READINESS_GROUPS_V2: ReadonlyArray<{
  id: MuscleReadinessGroupV2Id;
  label: string;
  halfLifeHours: number;
}> = [
  { id: "erectors", label: "Поясница", halfLifeHours: 42 },
  { id: "hamstrings", label: "Бицепс бедра", halfLifeHours: 38 },
  { id: "quads", label: "Квадрицепс", halfLifeHours: 36 },
  { id: "glutes", label: "Ягодицы", halfLifeHours: 32 },
  { id: "chest", label: "Грудь", halfLifeHours: 32 },
  { id: "lats_upper_back", label: "Спина / шир.", halfLifeHours: 28 },
  { id: "triceps", label: "Трицепс", halfLifeHours: 24 },
  { id: "biceps", label: "Бицепс", halfLifeHours: 20 },
  { id: "front_delts", label: "Передн. дельта", halfLifeHours: 20 },
  { id: "side_rear_delts", label: "Средн./задн. дельта", halfLifeHours: 16 },
  { id: "calves", label: "Икры", halfLifeHours: 16 },
  { id: "abs", label: "Пресс", halfLifeHours: 16 },
];

const HIGH_ECCENTRIC_IDS = new Set([
  "rdl",
  "db-rdl",
  "deadlift-stiff",
  "deadlift-bar",
  "squat",
  "bulgarian-split-squat",
  "lunge-bar",
  "incline-db",
  "incline-bar",
  "dip-weighted",
  "fly-db",
  "pullover",
  "curl-incline",
  "curl-incline-db",
  "overhead-triceps",
  "skullcrusher",
  "legcurl-seated",
  "hack-squat",
]);

const LOW_ECCENTRIC_IDS = new Set([
  "lateral",
  "lateral-cable",
  "lateral-cable-single",
  "rear-delt-fly",
  "facepull-er",
  "legext",
  "leg-extension",
  "pushdown",
  "extension-v-pushdown",
  "curl-cable",
  "curl-preacher",
  "curl-preacher-ez",
  "calf-standing",
  "calf-standing-machine",
  "calf-seated",
  "calf-legpress",
  "crunch",
  "cable-crunch",
  "plank",
]);

const ANATOMICAL_TO_V2: Record<string, MuscleReadinessGroupV2Id> = {
  "erector-spinae": "erectors",
  "biceps-femoris-long": "hamstrings",
  "biceps-femoris-short": "hamstrings",
  semitendinosus: "hamstrings",
  semimembranosus: "hamstrings",
  "quadriceps-vasti": "quads",
  "rectus-femoris": "quads",
  "gluteus-maximus": "glutes",
  "gluteus-medius": "glutes",
  "adductor-magnus": "glutes",
  "pectoralis-major": "chest",
  "pectoralis-clavicular": "chest",
  "pectoralis-sternal": "chest",
  "pectoralis-abdominal": "chest",
  "serratus-anterior": "chest",
  "latissimus-dorsi": "lats_upper_back",
  "teres-major": "lats_upper_back",
  "trapezius-upper": "lats_upper_back",
  "trapezius-middle": "lats_upper_back",
  "trapezius-lower": "lats_upper_back",
  rhomboids: "lats_upper_back",
  "triceps-brachii": "triceps",
  "biceps-brachii": "biceps",
  brachialis: "biceps",
  brachioradialis: "biceps",
  "deltoid-anterior": "front_delts",
  "deltoid-middle": "side_rear_delts",
  "deltoid-posterior": "side_rear_delts",
  infraspinatus: "side_rear_delts",
  "teres-minor": "side_rear_delts",
  supraspinatus: "side_rear_delts",
  gastrocnemius: "calves",
  soleus: "calves",
  "tibialis-anterior": "calves",
  "rectus-abdominis": "abs",
  obliques: "abs",
};

const COARSE_TO_V2: Record<Muscle, MuscleReadinessGroupV2Id[]> = {
  chest: ["chest"],
  back: ["lats_upper_back"],
  shoulders: ["front_delts", "side_rear_delts"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  quads: ["quads"],
  hamstrings: ["hamstrings"],
  glutes: ["glutes"],
  calves: ["calves"],
  core: ["abs"],
};

const SET_DAMAGE_CONSTANT = 6.5;
const SYNERGIST_ROLE_WEIGHT = 0.45;

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

  /** Индекс эксцентрического / стретч-повреждения упражнения: high 1.35, moderate 1.0, low 0.65. */
  static eccentricDamageFactor(exercise: Exercise | undefined): number {
    if (!exercise) return 1.0;
    if (HIGH_ECCENTRIC_IDS.has(exercise.id)) return 1.35;
    if (LOW_ECCENTRIC_IDS.has(exercise.id)) return 0.65;
    if (exercise.familyId === "hip-hinge" || exercise.familyId === "squat") return 1.35;
    if (
      exercise.recording.loadMode === "machine_stack" &&
      exercise.primary.length === 1 &&
      exercise.secondary.length === 0
    ) {
      return 0.65;
    }
    return 1.0;
  }

  /** Определяет роли 12 физиологических групп для упражнения (primary = 1.0, synergist = 0.45). */
  static muscleRolesV2(exercise: Exercise): Map<MuscleReadinessGroupV2Id, number> {
    const roles = new Map<MuscleReadinessGroupV2Id, number>();
    const assign = (group: MuscleReadinessGroupV2Id, weight: number) => {
      const prev = roles.get(group) ?? 0;
      if (weight > prev) roles.set(group, weight);
    };

    if (exercise.muscles && exercise.muscles.length > 0) {
      for (const m of exercise.muscles) {
        const group = ANATOMICAL_TO_V2[m.muscleId];
        if (!group) continue;
        if (m.role === "primary") {
          assign(group, 1.0);
        } else {
          assign(group, SYNERGIST_ROLE_WEIGHT);
        }
      }
    }

    // Fallback для кастомных/устаревших упражнений без детальной таблицы muscles
    if (roles.size === 0) {
      const primaryZones =
        !exercise.primary.length && exercise.custom?.declaredZones?.length
          ? exercise.custom.declaredZones
          : exercise.primary;
      for (const z of primaryZones) {
        for (const g of COARSE_TO_V2[z] ?? []) assign(g, 1.0);
      }
      for (const z of exercise.secondary) {
        for (const g of COARSE_TO_V2[z] ?? []) assign(g, SYNERGIST_ROLE_WEIGHT);
      }
    }

    return roles;
  }

  /**
   * Модуль 5 (v2): гранулярная готовность 12 групп мышц с мультидневным экспоненциальным
   * распадом за последние 10 дней (240 ч), учётом синергистов (0.45×), эксцентрики и RIR.
   */
  static fromWorkoutsV2(
    workouts: Workout[],
    today: string,
    timeZone?: string,
    now?: Date,
  ): MuscleReadinessV2Item[] {
    const windowStart = addCalendarDays(today, -10);
    const refTimeMs = now ? now.getTime() : Date.parse(`${today}T12:00:00Z`);
    const facts = new AnalyticsFacts(workouts, {
      from: windowStart,
      through: today,
      includeFuture: false,
      timeZone,
      now: now ?? new Date(refTimeMs),
      setKind: "working",
      completedOnly: true,
    }).sets();

    const fatigueByGroup = new Map<MuscleReadinessGroupV2Id, number>();
    const directSets = new Map<MuscleReadinessGroupV2Id, number>();
    const synergistSets = new Map<MuscleReadinessGroupV2Id, number>();
    const halfLifeByGroup = new Map<MuscleReadinessGroupV2Id, number>(
      READINESS_GROUPS_V2.map((g) => [g.id, g.halfLifeHours]),
    );

    for (const { workout, exercise, set } of facts) {
      if (!exercise || workout.date > today) continue;
      // Вычисляем Δt в часах: используем timestamp, если он совпадает с датой тренировки, иначе 12:00Z дня
      let workoutMs = Date.parse(`${workout.date}T12:00:00Z`);
      const tsCandidate = workout.updatedAt ?? workout.createdAt;
      if (tsCandidate && now) {
        const parsed = Date.parse(tsCandidate);
        if (Number.isFinite(parsed) && localDate(new Date(parsed), timeZone) === workout.date) {
          workoutMs = parsed;
        }
      }
      const deltaHours = Math.max(0, (refTimeMs - workoutMs) / MS_PER_HOUR);
      if (deltaHours > 240) continue;

      const roles = MuscleReadiness.muscleRolesV2(exercise);
      const eDmg = MuscleReadiness.eccentricDamageFactor(exercise);
      const mRir =
        set.rir === 0
          ? 1.35
          : set.rir !== null && Number.isFinite(set.rir) && set.rir <= 2
            ? 1.0
            : 0.7;

      for (const [groupId, roleWeight] of roles) {
        const halfLife = halfLifeByGroup.get(groupId) ?? 24;
        const unitDamage = SET_DAMAGE_CONSTANT * roleWeight * eDmg * mRir;
        const decayed = unitDamage * Math.pow(0.5, deltaHours / halfLife);
        fatigueByGroup.set(groupId, (fatigueByGroup.get(groupId) ?? 0) + decayed);
        if (roleWeight >= 1.0) {
          directSets.set(groupId, (directSets.get(groupId) ?? 0) + 1);
        } else {
          synergistSets.set(groupId, (synergistSets.get(groupId) ?? 0) + 1);
        }
      }
    }

    return READINESS_GROUPS_V2.map((g) => {
      const fatigueLoad = Math.round((fatigueByGroup.get(g.id) ?? 0) * 10) / 10;
      const readinessPct = Math.max(0, Math.min(100, Math.round(100 - fatigueLoad)));
      const status: ReadinessStatusV2 =
        readinessPct >= 85
          ? "fresh"
          : readinessPct >= 75
            ? "usable"
            : readinessPct >= 50
              ? "recovering"
              : "fatigued";
      return {
        id: g.id,
        label: g.label,
        halfLifeHours: g.halfLifeHours,
        fatigueLoad,
        readinessPct,
        status,
        canTrain: readinessPct >= 75,
        directSets10d: directSets.get(g.id) ?? 0,
        synergistSets10d: synergistSets.get(g.id) ?? 0,
      };
    });
  }
}
