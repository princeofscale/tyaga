import { ANATOMICAL_MUSCLES, CHEST_HEADS, DELTOID_HEADS, MUSCLES, type Muscle } from "../data/muscles";
import { trailingWindow } from "../lib/calendar";
import { exerciseById, exerciseForEntry } from "../lib/catalog";
import type { Exercise, Routine, SetEntry, Workout, WorkoutExercise } from "../lib/types";
import { AnalyticsFacts, type FactsOptions } from "./AnalyticsFacts";
import { LaidDupPlan, type LaidDay } from "./LaidDupPlan";
import { MuscleParticipation } from "./MuscleParticipation";
import { OneRepMaxFormulas } from "./OneRepMaxFormulas";
import { TrainingVolume } from "./TrainingVolume";

export type MovementLoadClass = "axial_compound" | "compound" | "isolation";

export interface SetBiomechanics {
  loadClass: MovementLoadClass;
  stimulus: number;
  fatigueCost: number;
  sfr: number;
  repZone: "strength" | "hypertrophy" | "endurance";
  isHard: boolean;
  isFailure: boolean;
  isJunk: boolean;
  rirAdjustedE1rm: number | null;
  calibratedLoadKg: number;
}

export interface BiomechanicsSignal {
  id: string;
  severity: "ok" | "info" | "warn";
  title: string;
  detail: string;
}

export interface ZoneBiomechanics {
  muscle: Muscle;
  muscleName: string;
  directSets: number;
  indirectSets: number;
  /** Эффективные стимулирующие подходы с учётом RIR и диапазона повторений (прямые + 0,5 × помощь). */
  effectiveSets: number;
  hardSets: number;
  failureSets: number;
  junkSets: number;
  avgRir: number | null;
}

export interface WeeklyBiomechanicsReport {
  startDate: string;
  endDate: string;
  workingSets: number;
  effectiveSetsTotal: number;
  /** Отдельный слой: подходы по честным диапазонам RIR (0–2 / 3–4 / 5+ / без RIR). */
  rirBands: {
    high: number;
    moderate: number;
    light: number;
    unknown: number;
  };
  /** Отдельный слой усталости: подходы со значимой осевой / стабилизирующей нагрузкой на корпус (не смешивается с гипертрофией). */
  structuralLoadSets: number;
  hardSets: number;
  failureSets: number;
  junkSets: number;
  unknownRirSets: number;
  avgRir: number | null;
  axialHardSets: number;
  avgSfr: number | null;
  repZones: {
    strength: number;
    hypertrophy: number;
    endurance: number;
  };
  zones: ZoneBiomechanics[];
  chestHeads: Record<"upper" | "mid" | "lower", { direct: number; assisting: number }>;
  deltoidHeads: Record<"anterior" | "middle" | "posterior", { direct: number; assisting: number }>;
  calvesSplit: { gastrocnemius: number; soleus: number };
  signals: BiomechanicsSignal[];
}

export interface LaidCycleAudit {
  weeklyAxialSets: number;
  weeklyHingeAndSquatSets: number;
  pullBeforeLegsPairs: string[];
  topSetFeedback: BiomechanicsSignal[];
  summary: string;
}

const AXIAL_EXERCISE_IDS = new Set([
  "squat",
  "deadlift-bar",
  "rdl",
  "db-rdl",
  "deadlift-stiff",
  "row-bent-bar",
  "row-yates",
  "ohp-bar",
  "push-press",
  "lunge-bar",
  "goblet",
  "bulgarian-split-squat",
]);

const AXIAL_FAMILIES = new Set(["squat", "hip-hinge", "spinal-extension"]);

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Биомеханический движок анализа нагрузки.
 * Честно оценивает вклад каждого подхода в стимул и системную/осевую усталость
 * на основе анатомической разметки, типа движения, повторений, RIR и калибровки тренажёра.
 */
export class BiomechanicsEngine {
  /** Классификация осевой и системной нагрузки упражнения. */
  static loadClass(exercise: Exercise | undefined): MovementLoadClass {
    if (!exercise) return "compound";
    if (
      AXIAL_EXERCISE_IDS.has(exercise.id) ||
      (AXIAL_FAMILIES.has(exercise.familyId) && exercise.recording.loadMode === "total_external")
    ) {
      return "axial_compound";
    }
    const primaryZones = new Set(exercise.primary);
    const hasAssist = exercise.secondary.length > 0;
    const isMultiJoint =
      exercise.jointActions.length >= 2 ||
      primaryZones.size >= 2 ||
      (hasAssist && exercise.recording.loadMode !== "machine_stack");
    return isMultiJoint ? "compound" : "isolation";
  }

  /** Коэффициент системной усталости по типу упражнения. */
  static systemicFactor(loadClass: MovementLoadClass): number {
    if (loadClass === "axial_compound") return 1.35;
    if (loadClass === "compound") return 1.05;
    return 0.75;
  }

  /** Полный биомеханический профиль одного подхода. */
  static setProfile(entry: WorkoutExercise, set: SetEntry, exercise = exerciseForEntry(entry)): SetBiomechanics {
    const loadClass = this.loadClass(exercise);
    const effort = OneRepMaxFormulas.setEffortProfile(set.reps, set.rir);
    const fatigueCost = round2(effort.fatigue * this.systemicFactor(loadClass));
    const sfr = fatigueCost > 0 ? round2(effort.stimulus / fatigueCost) : 0;
    const factor =
      exercise?.recording.loadMode === "machine_stack"
        ? TrainingVolume.machineEffectiveFactor(entry)
        : 1;
    const calibratedLoadKg = round1(set.weight * factor);
    const rirAdjustedE1rm =
      exercise?.recording.e1rmEligible && exercise.recording.type !== "duration" && set.weight > 0
        ? OneRepMaxFormulas.rirAdjustedEpley(set.weight, set.reps, set.rir)
        : null;

    return {
      loadClass,
      stimulus: effort.stimulus,
      fatigueCost,
      sfr,
      repZone: effort.repZone,
      isHard: AnalyticsFacts.isHard(set),
      isFailure: set.rir !== null && set.rir === 0,
      isJunk: set.rir !== null && set.rir >= 5,
      rirAdjustedE1rm: rirAdjustedE1rm === null ? null : OneRepMaxFormulas.round(rirAdjustedE1rm),
      calibratedLoadKg,
    };
  }

  /** 7-дневный биомеханический разбор: стимулирующий объём (с учётом RIR и повторов), пучки, осевая нагрузка и сигналы. */
  static analyzeWeek(
    workouts: Workout[],
    endDate: string,
    options: Pick<FactsOptions, "timeZone" | "now"> & { mapping?: "recorded" | "current" } = {},
  ): WeeklyBiomechanicsReport {
    const startDate = trailingWindow(endDate, 7).from;
    const facts = new AnalyticsFacts(workouts, {
      ...options,
      from: startDate,
      through: endDate,
      setKind: "working",
      completedOnly: true,
    }).sets();

    const zoneMap = new Map<
      Muscle,
      {
        directSets: number;
        indirectSets: number;
        effectiveSets: number;
        hardSets: number;
        failureSets: number;
        junkSets: number;
        rirSum: number;
        rirCount: number;
      }
    >();
    for (const m of MUSCLES) {
      zoneMap.set(m.id, {
        directSets: 0,
        indirectSets: 0,
        effectiveSets: 0,
        hardSets: 0,
        failureSets: 0,
        junkSets: 0,
        rirSum: 0,
        rirCount: 0,
      });
    }

    const chestHeads = {
      upper: { direct: 0, assisting: 0 },
      mid: { direct: 0, assisting: 0 },
      lower: { direct: 0, assisting: 0 },
    };
    const deltoidHeads = {
      anterior: { direct: 0, assisting: 0 },
      middle: { direct: 0, assisting: 0 },
      posterior: { direct: 0, assisting: 0 },
    };
    const calvesSplit = { gastrocnemius: 0, soleus: 0 };
    const repZones = { strength: 0, hypertrophy: 0, endurance: 0 };
    const rirBands = { high: 0, moderate: 0, light: 0, unknown: 0 };

    let effectiveSetsTotal = 0;
    let hardSets = 0;
    let failureSets = 0;
    let junkSets = 0;
    let unknownRirSets = 0;
    let rirSumAll = 0;
    let rirCountAll = 0;
    let axialHardSets = 0;
    let structuralLoadSets = 0;
    let sfrSum = 0;

    for (const fact of facts) {
      const exercise =
        options.mapping === "current"
          ? exerciseById(fact.entry.exerciseId)
          : fact.exercise;
      const profile = this.setProfile(fact.entry, fact.set, exercise);
      effectiveSetsTotal += profile.stimulus;
      sfrSum += profile.sfr;
      repZones[profile.repZone] += 1;
      if (profile.isHard) hardSets += 1;
      if (profile.isFailure) failureSets += 1;
      if (profile.isJunk) junkSets += 1;
      if (fact.set.rir === null) {
        unknownRirSets += 1;
        rirBands.unknown += 1;
      } else {
        rirSumAll += fact.set.rir;
        rirCountAll += 1;
        if (fact.set.rir <= 2) rirBands.high += 1;
        else if (fact.set.rir <= 4) rirBands.moderate += 1;
        else rirBands.light += 1;
      }
      if (profile.loadClass === "axial_compound") {
        structuralLoadSets += 1;
        if (profile.isHard) axialHardSets += 1;
      } else if (exercise?.muscles.some((m) => m.muscleId === "erector-spinae" && m.role === "stabilizer")) {
        structuralLoadSets += 0.5;
      }

      if (!exercise) continue;
      const primary =
        !exercise.primary.length && exercise.custom?.declaredZones?.length
          ? exercise.custom.declaredZones
          : exercise.primary;
      const secondary = exercise.secondary.filter((z) => !primary.includes(z));

      for (const z of primary) {
        const bucket = zoneMap.get(z);
        if (!bucket) continue;
        bucket.directSets += 1;
        bucket.effectiveSets += profile.stimulus;
        if (profile.isHard) bucket.hardSets += 1;
        if (profile.isFailure) bucket.failureSets += 1;
        if (profile.isJunk) bucket.junkSets += 1;
        if (fact.set.rir !== null) {
          bucket.rirSum += fact.set.rir;
          bucket.rirCount += 1;
        }
      }
      for (const z of secondary) {
        const bucket = zoneMap.get(z);
        if (!bucket) continue;
        bucket.indirectSets += 1;
        bucket.effectiveSets += profile.stimulus * 0.5;
        if (profile.isHard) bucket.hardSets += 0.5;
      }

      const rev = options.mapping === "current" ? 1 : (fact.entry.muscleModelRevision ?? 1);
      const roles = MuscleParticipation.roles(exercise, rev);
      for (const role of roles) {
        if (role.muscleId === "pectoralis-clavicular") {
          if (role.role === "primary") chestHeads.upper.direct += 1;
          else if (role.role === "assistant") chestHeads.upper.assisting += 1;
        } else if (role.muscleId === "pectoralis-sternal") {
          if (role.role === "primary") chestHeads.mid.direct += 1;
          else if (role.role === "assistant") chestHeads.mid.assisting += 1;
        } else if (role.muscleId === "pectoralis-abdominal") {
          if (role.role === "primary") chestHeads.lower.direct += 1;
          else if (role.role === "assistant") chestHeads.lower.assisting += 1;
        } else if (role.muscleId === "deltoid-anterior") {
          if (role.role === "primary") deltoidHeads.anterior.direct += 1;
          else if (role.role === "assistant") deltoidHeads.anterior.assisting += 1;
        } else if (role.muscleId === "deltoid-middle") {
          if (role.role === "primary") deltoidHeads.middle.direct += 1;
          else if (role.role === "assistant") deltoidHeads.middle.assisting += 1;
        } else if (role.muscleId === "deltoid-posterior") {
          if (role.role === "primary") deltoidHeads.posterior.direct += 1;
          else if (role.role === "assistant") deltoidHeads.posterior.assisting += 1;
        } else if (role.muscleId === "gastrocnemius" && role.role === "primary") {
          calvesSplit.gastrocnemius += 1;
        } else if (role.muscleId === "soleus" && role.role === "primary") {
          calvesSplit.soleus += 1;
        }
      }
    }

    const zones: ZoneBiomechanics[] = MUSCLES.map((m) => {
      const b = zoneMap.get(m.id)!;
      return {
        muscle: m.id,
        muscleName: m.name,
        directSets: b.directSets,
        indirectSets: b.indirectSets,
        effectiveSets: round1(b.effectiveSets),
        hardSets: round1(b.hardSets),
        failureSets: b.failureSets,
        junkSets: b.junkSets,
        avgRir: b.rirCount ? round1(b.rirSum / b.rirCount) : null,
      };
    });

    const signals: BiomechanicsSignal[] = [];
    const workingSets = facts.length;
    if (workingSets > 0) {
      if (rirCountAll >= 4 && failureSets / rirCountAll >= 0.45) {
        signals.push({
          id: "high-failure-ratio",
          severity: "warn",
          title: "Много подходов в отказ (RIR 0)",
          detail: `${failureSets} из ${rirCountAll} подходов с RIR сделаны в отказ. Держи базу в RIR 1–2 — стимул почти тот же, а восстановление заметно быстрее.`,
        });
      }
      if (rirCountAll >= 4 && junkSets / rirCountAll >= 0.25) {
        signals.push({
          id: "junk-volume",
          severity: "info",
          title: "Много лёгких подходов (RIR 5+)",
          detail: `${junkSets} подх. с запасом 5+ повторений дают более низкий стимул в среднем, чем RIR 0–3. Если это не разгрузка и не техническая работа — добавь вес или 2–3 повтора.`,
        });
      }
      if (axialHardSets >= 18) {
        signals.push({
          id: "axial-load",
          severity: "warn",
          title: "Высокая осевая нагрузка на поясницу",
          detail: `${axialHardSets} тяжёлых подходов с осевой нагрузкой (присед, тяги, жим стоя) за 7 дней. Следи за сном и техникой спины.`,
        });
      }
      const frontDeltWork = deltoidHeads.anterior.direct + deltoidHeads.anterior.assisting * 0.5;
      const rearDeltWork = deltoidHeads.posterior.direct + deltoidHeads.posterior.assisting * 0.5;
      if (frontDeltWork >= 8 && rearDeltWork < frontDeltWork * 0.35) {
        signals.push({
          id: "delt-imbalance",
          severity: "info",
          title: "Перекос плеч в переднюю дельту",
          detail: `Передняя дельта: ${round1(frontDeltWork)} экв. подх., задняя: ${round1(rearDeltWork)}. Добавь обратный пек-дек или тягу к лицу.`,
        });
      }
      const chestTotal = chestHeads.upper.direct + chestHeads.mid.direct + chestHeads.lower.direct;
      if (chestTotal >= 8 && chestHeads.upper.direct === 0) {
        signals.push({
          id: "chest-upper-gap",
          severity: "info",
          title: "Нет прямого акцента на верх груди",
          detail: "Вся прямая работа груди шла на середину/низ. 2–3 подхода жима на наклонной 30° сбалансируют ключичный пучок.",
        });
      }
      if (calvesSplit.soleus >= 4 && calvesSplit.gastrocnemius === 0) {
        signals.push({
          id: "calves-straight-knee-gap",
          severity: "info",
          title: "Икры только сидя (камбаловидная)",
          detail: "Для икроножной нужен вариант на прямых коленях — подъём на носки стоя.",
        });
      }
      if (!signals.length && rirCountAll >= 3) {
        signals.push({
          id: "balanced-week",
          severity: "ok",
          title: "Хороший баланс стимула и усталости",
          detail: `Средний RIR ${round1(rirSumAll / rirCountAll)}, эффективный объём ${round1(effectiveSetsTotal)} подх. — нагрузка распределена ровно.`,
        });
      }
    }

    return {
      startDate,
      endDate,
      workingSets,
      effectiveSetsTotal: round1(effectiveSetsTotal),
      rirBands,
      structuralLoadSets: round1(structuralLoadSets),
      hardSets,
      failureSets,
      junkSets,
      unknownRirSets,
      avgRir: rirCountAll ? round1(rirSumAll / rirCountAll) : null,
      axialHardSets,
      avgSfr: workingSets ? round2(sfrSum / workingSets) : null,
      repZones,
      zones,
      chestHeads,
      deltoidHeads,
      calvesSplit,
      signals,
    };
  }

  /** Биомеханический аудит цикла Дэвида Лейда (DUP): осевая нагрузка, соседство тяги и ног, обратная связь по топ-сетам. */
  static auditLaidCycle(
    cycle: readonly Routine[],
    workouts: Workout[],
    today: string,
  ): LaidCycleAudit {
    const slots = LaidDupPlan.slotsFromCycle(cycle);
    const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    const pullDays = new Set<LaidDay>(["pull1", "pull2"]);
    const legDays = new Set<LaidDay>(["legs1", "legs2"]);

    let weeklyAxialSets = 0;
    let weeklyHingeAndSquatSets = 0;
    for (const r of cycle) {
      for (const e of r.exercises) {
        const def = exerciseForEntry(e) ?? exerciseById(e.exerciseId);
        const setCount = e.sets.filter((s) => !s.warmup).length;
        if (this.loadClass(def) === "axial_compound") weeklyAxialSets += setCount;
        if (def && (def.familyId === "squat" || def.familyId === "hip-hinge")) {
          weeklyHingeAndSquatSets += setCount;
        }
      }
    }

    const pullBeforeLegsPairs: string[] = [];
    for (let i = 0; i < 7; i++) {
      const cur = slots[i];
      const next = slots[(i + 1) % 7];
      if (cur && next && pullDays.has(cur) && legDays.has(next)) {
        pullBeforeLegsPairs.push(
          `${LaidDupPlan.SHORT[cur]} (${dayNames[i]}) → ${LaidDupPlan.SHORT[next]} (${dayNames[(i + 1) % 7]})`,
        );
      }
    }

    const topSetFeedback: BiomechanicsSignal[] = [];
    const first = cycle[0]?.periodization;
    if (first) {
      const since = trailingWindow(today, 14).from;
      const cycleRoutineIds = new Set(cycle.map((r) => r.id));
      const recent = workouts.filter(
        (w) => w.date >= since && w.date <= today && w.routineId && cycleRoutineIds.has(w.routineId),
      );
      let easyTopSets = 0;
      let missedRepTopSets = 0;

      for (const w of recent) {
        const routine = cycle.find((r) => r.id === w.routineId);
        if (!routine) continue;
        const plan = LaidDupPlan.planFor(routine, w.programDate ?? w.date);
        if (!plan) continue;
        const liftEntry = w.exercises.find((e) => e.exerciseId === plan.liftExerciseId);
        const topSet = liftEntry?.sets.find((s) => s.done && !s.warmup);
        if (!topSet) continue;
        if (topSet.rir !== null && topSet.rir >= 3 && topSet.weight >= plan.heavy.weightKg) {
          easyTopSets += 1;
        }
        if (topSet.weight >= plan.heavy.weightKg && topSet.reps < plan.heavy.reps) {
          missedRepTopSets += 1;
        }
      }

      if (missedRepTopSets >= 2) {
        topSetFeedback.push({
          id: "laid-missed-reps",
          severity: "warn",
          title: "Топ-сеты тяжелее плана",
          detail: `В ${missedRepTopSets} базовых топ-сетах за 2 недели не добраны плановые повторения. Снизь рабочие максимумы на 5 % или включи облегчённый режим.`,
        });
      } else if (easyTopSets >= 2) {
        topSetFeedback.push({
          id: "laid-easy-topsets",
          severity: "info",
          title: "Запас на топ-сетах RIR 3+",
          detail: "Тяжёлые подходы идут с большим запасом — рабочие максимумы можно аккуратно поднять на 2,5–5 кг.",
        });
      }
    }

    const pullHasAxialHinge = cycle
      .filter((r) => {
        const d = LaidDupPlan.periodizationOf(r)?.day;
        return d ? pullDays.has(d) : false;
      })
      .some((r) =>
        r.exercises.some((e) => {
          const def = exerciseForEntry(e) ?? exerciseById(e.exerciseId);
          return this.loadClass(def) === "axial_compound" && def?.familyId === "hip-hinge";
        }),
      );

    if (pullBeforeLegsPairs.length > 0 && pullHasAxialHinge) {
      topSetFeedback.push({
        id: "laid-pull-before-legs",
        severity: "info",
        title: "Тяга сразу перед ногами",
        detail: `${pullBeforeLegsPairs.join(", ")}: тяговые движения с осевой нагрузкой грузят поясницу и бицепс бедра за день до приседа. Если спина не успевает остывать — выбери ритм 3+1+3 или переставь дни.`,
      });
    }

    const summary = `Осевая нагрузка цикла: ${weeklyAxialSets} подх./нед. (${weeklyHingeAndSquatSets} присед + тяги).`;
    return {
      weeklyAxialSets,
      weeklyHingeAndSquatSets,
      pullBeforeLegsPairs,
      topSetFeedback,
      summary,
    };
  }

  /** Справочник анатомических пучков (удобно для проверок и UI). */
  static readonly HEAD_CATALOG = {
    chest: CHEST_HEADS,
    deltoids: DELTOID_HEADS,
    anatomical: ANATOMICAL_MUSCLES,
  };
}
