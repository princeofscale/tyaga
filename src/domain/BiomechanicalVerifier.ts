import {
  ANATOMICAL_MUSCLE_SET_V4,
  MUSCLE_TO_ZONE10,
  type AggregatedZone10,
  type AnatomicalMuscleIdV4,
  type AxialMultiplierV4,
  type InvariantViolation,
  type JointActionKey,
  type KinematicDescriptor,
  type MuscleAssignment,
  type SolverOutput,
  type VerificationResult,
} from "./KinematicTypesV4";

const ANTAGONIST_PAIRS: ReadonlyArray<readonly [JointActionKey, JointActionKey]> = [
  ["elbow_flexion", "elbow_extension"],
  ["knee_extension", "knee_flexion"],
  ["shoulder_horizontal_adduction", "shoulder_horizontal_abduction"],
  ["shoulder_flexion", "shoulder_extension_sagittal"],
  ["shoulder_abduction", "shoulder_adduction_frontal"],
  ["trunk_flexion", "spinal_isometric_extension"],
];

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Анти-галлюцинационный детерминированный верификатор биомеханики «Тяга v4».
 * Проверяет 15 жёстких физических/анатомических инвариантов (INV-01 .. INV-15).
 */
export class BiomechanicalVerifier {
  verifyAndCorrect(descriptor: KinematicDescriptor, rawOutput: SolverOutput): VerificationResult {
    const violations: InvariantViolation[] = [];
    const muscles: Partial<Record<AnatomicalMuscleIdV4, MuscleAssignment>> = {};
    const regions = { ...rawOutput.regions };
    let axial: AxialMultiplierV4 = rawOutput.axialLoadMultiplier;
    let stretchScore: 1 | 2 | 3 = rawOutput.stretchScore;
    let sfrBase = rawOutput.sfrBase;
    let sfrLongLevers = rawOutput.sfrLongLevers;

    const actions = descriptor.actions;
    const g = descriptor.geometry;
    const p = descriptor.profile;

    // INV-01: Все ключи muscles принадлежат замкнутому словарю 35 ANATOMICAL_MUSCLES
    for (const [id, assignment] of Object.entries(rawOutput.muscles)) {
      if (!assignment) continue;
      if (!ANATOMICAL_MUSCLE_SET_V4.has(id)) {
        violations.push({
          code: "INV-01_UNKNOWN_MUSCLE_ID",
          severity: "auto_correct",
          detail: `Удалена несуществующая мышца вне словаря 35 ANATOMICAL_MUSCLES: "${id}"`,
        });
        continue;
      }
      muscles[id as AnatomicalMuscleIdV4] = { ...assignment };
    }

    // INV-02: Запрет одновременных первичных антагонистов (>= 0.7) в одном суставе
    for (const [a, b] of ANTAGONIST_PAIRS) {
      if ((actions[a] ?? 0) >= 0.7 && (actions[b] ?? 0) >= 0.7) {
        violations.push({
          code: "INV-02_ANTAGONIST_CONFLICT",
          severity: "hard_reject_retry",
          detail: `Физически невозможная одновременная первичная активность антагонистов: ${a} и ${b}`,
        });
      }
    }

    // INV-03: Наличие хотя бы одного суставного действия с весом >= 0.5
    const maxAction = Math.max(0, ...Object.values(actions).filter((v): v is number => typeof v === "number"));
    if (maxAction < 0.5) {
      violations.push({
        code: "INV-03_EMPTY_KINEMATICS",
        severity: "hard_reject_retry",
        detail: "В KinematicDescriptor отсутствует суставное действие с весом >= 0.5",
      });
    }

    // INV-11: Границы анатомических углов
    if (
      g.benchAngleDeg < -30 ||
      g.benchAngleDeg > 90 ||
      g.shoulderPlaneDeg < 0 ||
      g.shoulderPlaneDeg > 90 ||
      g.torsoAngleDeg < 0 ||
      g.torsoAngleDeg > 90
    ) {
      violations.push({
        code: "INV-11_IMPOSSIBLE_ANGLES",
        severity: "hard_reject_retry",
        detail: `Нефизичные углы геометрии: bench=${g.benchAngleDeg}, plane=${g.shoulderPlaneDeg}, torso=${g.torsoAngleDeg}`,
      });
    }

    // INV-04: Парадокс Ломбарда — ингибиция rectus-femoris при синхронном hip_extension >= 0.35 и knee_extension >= 0.5
    if ((actions.hip_extension ?? 0) >= 0.35 && (actions.knee_extension ?? 0) >= 0.5) {
      const rf = muscles["rectus-femoris"];
      if ((rf && (rf.role !== "stabilizer" || rf.weight > 0)) || regions.quads_rectus_femoris !== undefined) {
        violations.push({
          code: "INV-04_BIARTICULAR_RF_INHIBITION",
          severity: "auto_correct",
          detail: "rectus-femoris понижена в stabilizer (0.0) при совместном разгибании бедра и колена",
        });
        muscles["rectus-femoris"] = { role: "stabilizer", weight: 0.0, score: 0.25 };
        delete regions.quads_rectus_femoris;
      }
    }

    // INV-05: Активная недостаточность gastrocnemius при согнутом колене >= 65°
    if ((actions.ankle_plantarflexion ?? 0) >= 0.5 && g.kneeFlexionDeg >= 65) {
      const gastroc = muscles.gastrocnemius;
      const soleus = muscles.soleus;
      if (
        (gastroc && (gastroc.role !== "stabilizer" || gastroc.weight > 0)) ||
        !soleus ||
        soleus.role !== "primary" ||
        regions.calves_gastroc !== undefined
      ) {
        violations.push({
          code: "INV-05_GASTROC_ACTIVE_INSUFFICIENCY",
          severity: "auto_correct",
          detail: "gastrocnemius переведена в stabilizer (0.0), soleus установлена в primary (1.0) при колене >= 65°",
        });
        muscles.gastrocnemius = { role: "stabilizer", weight: 0.0, score: 0.15 };
        muscles.soleus = { role: "primary", weight: 1.0, score: 1.0 };
        delete regions.calves_gastroc;
        regions.calves_soleus = 1.0;
      }
    }

    // INV-06: Консистентность растяжения хамстрингов сидя
    if ((actions.knee_flexion ?? 0) >= 0.7 && g.hipFlexionDeg >= 60 && p.rom !== "shortened_partial" && stretchScore < 3) {
      violations.push({
        code: "INV-06_SEATED_HAM_STRETCH",
        severity: "auto_correct",
        detail: "stretchScore повышен до 3 для сгибаний колена с согнутым бедром (>= 60°)",
      });
      stretchScore = 3;
    }

    // INV-07: Специфичность длинной головки трицепса над головой
    if ((actions.elbow_extension ?? 0) >= 0.75 && g.shoulderFlexionDeg >= 75 && regions.triceps_long_head !== 1.0) {
      violations.push({
        code: "INV-07_TRICEPS_OVERHEAD_LONG_HEAD",
        severity: "auto_correct",
        detail: "triceps_long_head повышен до 1.0 при разгибании локтя с плечом >= 75°",
      });
      regions.triceps_long_head = 1.0;
    }

    // INV-08: Обязательная стабилизация erector-spinae при free_standing и наклоне корпуса <= 55°
    if (p.supportType === "free_standing" && g.torsoAngleDeg <= 55 && !muscles["erector-spinae"]) {
      violations.push({
        code: "INV-08_SPINAL_STABILIZATION_REQUIRED",
        severity: "auto_correct",
        detail: "Добавлена обязательная стабилизация erector-spinae для свободной стойки в наклоне",
      });
      muscles["erector-spinae"] = { role: "stabilizer", weight: 0.0, score: 0.35 };
    }

    // INV-09: Монотонность осевой нагрузки для базовых движений ног со штангой/трап-грифом стоя
    if (
      p.supportType === "free_standing" &&
      (p.implement === "barbell" || p.implement === "trap_bar") &&
      ((actions.knee_extension ?? 0) >= 0.6 || (actions.hip_extension ?? 0) >= 0.6) &&
      axial < 1.0
    ) {
      violations.push({
        code: "INV-09_FREE_AXIAL_FLOOR",
        severity: "auto_correct",
        detail: "axialLoadMultiplier повышен до >= 1.0 для свободного базового движения ног со штангой",
      });
      axial = (actions.knee_extension ?? 0) >= 0.8 || (actions.hip_extension ?? 0) >= 0.8 ? 1.5 : 1.0;
    }

    // INV-10: Ограничение осевой нагрузки для тренажёров с упором или направляющими
    if ((p.supportType === "chest_or_back_supported" || p.supportType === "machine_guided") && axial > 0.5) {
      violations.push({
        code: "INV-10_SUPPORTED_AXIAL_CAP",
        severity: "auto_correct",
        detail: "axialLoadMultiplier ограничен <= 0.5 для упражнения с внешней опорой/направляющими",
      });
      axial = 0.15;
    }

    // INV-12 и INV-13: Квантование весов в {1.0, 0.5, 0.0} и соответствие role <-> weight
    for (const [key, item] of Object.entries(muscles) as Array<[AnatomicalMuscleIdV4, MuscleAssignment]>) {
      const validWeight = item.weight === 1.0 || item.weight === 0.5 || item.weight === 0.0;
      if (!validWeight) {
        violations.push({
          code: "INV-12_WEIGHT_QUANTIZATION",
          severity: "auto_correct",
          detail: `Вес мышцы ${key} (${item.weight}) квантован в {1.0, 0.5, 0.0}`,
        });
        item.weight = item.score >= 0.75 ? 1.0 : item.score >= 0.42 ? 0.5 : 0.0;
      }
      const expectedWeight: 1.0 | 0.5 | 0.0 =
        item.role === "primary" ? 1.0 : item.role === "assistant" ? 0.5 : 0.0;
      if (item.weight !== expectedWeight) {
        violations.push({
          code: "INV-13_ROLE_WEIGHT_MISMATCH",
          severity: "auto_correct",
          detail: `Синхронизирован вес мышцы ${key} под роль ${item.role}`,
        });
        item.weight = expectedWeight;
      }
    }

    // INV-14: Границы и монотонность SFR: 1.0 <= sfrLongLevers <= sfrBase <= 10.0
    const clampedBase = round1(Math.max(1.0, Math.min(10.0, sfrBase)));
    const clampedLL = round1(Math.max(1.0, Math.min(clampedBase, sfrLongLevers)));
    if (clampedBase !== sfrBase || clampedLL !== sfrLongLevers) {
      violations.push({
        code: "INV-14_SFR_BOUNDS",
        severity: "auto_correct",
        detail: `SFR приведён к инварианту 1.0 <= sfrLongLevers (${clampedLL}) <= sfrBase (${clampedBase}) <= 10.0`,
      });
      sfrBase = clampedBase;
      sfrLongLevers = clampedLL;
    }

    // Пересобираем списки ролей и zones10 из исправленных muscles
    const primaryMuscles: AnatomicalMuscleIdV4[] = [];
    const assistantMuscles: AnatomicalMuscleIdV4[] = [];
    const stabilizerMuscles: AnatomicalMuscleIdV4[] = [];
    const zones10: Partial<Record<AggregatedZone10, 1.0 | 0.5 | 0.0>> = {};

    for (const [id, item] of Object.entries(muscles) as Array<[AnatomicalMuscleIdV4, MuscleAssignment]>) {
      if (item.role === "primary") primaryMuscles.push(id);
      else if (item.role === "assistant") assistantMuscles.push(id);
      else stabilizerMuscles.push(id);

      const z = MUSCLE_TO_ZONE10[id];
      const prev = zones10[z];
      if (prev === undefined || item.weight > prev) zones10[z] = item.weight;
    }

    primaryMuscles.sort();
    assistantMuscles.sort();
    stabilizerMuscles.sort();

    // INV-15: Наличие минимум одной мышцы в роли primary
    if (primaryMuscles.length === 0) {
      violations.push({
        code: "INV-15_NO_PRIMARY_MUSCLE",
        severity: "hard_reject_retry",
        detail: "В итоговой разметке отсутствует хотя бы одна первичная мышца (primary)",
      });
    }

    const hasHardReject = violations.some((v) => v.severity === "hard_reject_retry");
    const status: VerificationResult["status"] = hasHardReject
      ? "hard_reject_retry"
      : violations.length > 0
        ? "auto_corrected"
        : "valid";

    return {
      passed: !hasHardReject,
      status,
      violations,
      correctedResult: {
        ...rawOutput,
        muscles,
        primaryMuscles,
        assistantMuscles,
        stabilizerMuscles,
        zones10,
        regions,
        axialLoadMultiplier: axial,
        stretchScore,
        sfrBase,
        sfrLongLevers,
      },
    };
  }
}
