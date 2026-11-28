import type { HypertrophyRegionId, JointZone } from "./BiomechanicsCatalogV3";
import {
  MUSCLE_TO_ZONE10,
  type AggregatedZone10,
  type AnatomicalMuscleIdV4,
  type AxialMultiplierV4,
  type ExecutionProfileV4,
  type KinematicDescriptor,
  type MuscleAssignment,
  type MuscleRoleV4,
  type SolverOutput,
} from "./KinematicTypesV4";

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const STABILIZER_ONLY = new Set<AnatomicalMuscleIdV4>(["serratus-anterior", "supraspinatus"]);

function addScore(
  scores: Partial<Record<AnatomicalMuscleIdV4, number>>,
  id: AnatomicalMuscleIdV4,
  val: number,
) {
  if (val <= 0) return;
  scores[id] = Math.max(scores[id] ?? 0, Math.min(1, val));
}

function addRegion(
  regions: Partial<Record<HypertrophyRegionId, 1.0 | 0.5>>,
  region: HypertrophyRegionId,
  weight: 1.0 | 0.5,
) {
  const prev = regions[region];
  if (prev === undefined || weight > prev) regions[region] = weight;
}

/**
 * Первопринципный оффлайн-солвер биомеханики «Тяга v4» (O(1), <0.1 мс).
 * Выводит 35 анатомических мышц, 18+3 гипертрофических региона, 5-зонные риски JointGuard,
 * axialLoadMultiplier, stretchScore и SFR строго из физического KinematicDescriptor.
 */
export class KinematicMuscleSolver {
  /** Мгновенное (<0.1 мс) наложение параметров техники ExecutionProfile поверх базового дескриптора. */
  static applyExecutionProfile(
    base: KinematicDescriptor,
    exec?: ExecutionProfileV4 | null,
  ): KinematicDescriptor {
    if (!exec) return base;
    const next: KinematicDescriptor = {
      actions: { ...base.actions },
      geometry: { ...base.geometry },
      profile: { ...base.profile },
    };

    if (typeof exec.benchAngle === "number" && Number.isFinite(exec.benchAngle)) {
      next.geometry.benchAngleDeg = clamp(Math.round(exec.benchAngle), -30, 90);
      // При крутом наклоне >=55° жим переходит в вертикальный жим плечами
      if (next.geometry.benchAngleDeg >= 55 && (next.actions.shoulder_horizontal_adduction ?? 0) > 0) {
        next.actions.shoulder_flexion = Math.max(next.actions.shoulder_flexion ?? 0, 0.9);
        next.actions.shoulder_abduction = Math.max(next.actions.shoulder_abduction ?? 0, 0.5);
        next.actions.shoulder_horizontal_adduction = 0.45;
      } else if (next.geometry.benchAngleDeg <= 45 && (next.actions.shoulder_horizontal_adduction ?? 0) > 0) {
        next.actions.shoulder_horizontal_adduction = Math.max(next.actions.shoulder_horizontal_adduction ?? 0, 0.9);
        delete next.actions.shoulder_flexion;
        delete next.actions.shoulder_abduction;
      }
    }

    if (typeof exec.torsoAngle === "number" && Number.isFinite(exec.torsoAngle)) {
      next.geometry.torsoAngleDeg = clamp(Math.round(exec.torsoAngle), 0, 90);
    }

    if (exec.rom) {
      next.profile.rom = exec.rom;
      if (exec.rom === "lengthened_partial") next.profile.peakTorqueZone = "lengthened";
      if (exec.rom === "shortened_partial") next.profile.peakTorqueZone = "shortened";
    }

    const gripText = `${exec.grip ?? ""} ${exec.attachment ?? ""}`.toLowerCase();
    if (gripText.trim()) {
      const isIsoCurl =
        (next.actions.elbow_flexion ?? 0) >= 0.8 &&
        (next.actions.shoulder_extension_sagittal ?? 0) < 0.4 &&
        (next.actions.shoulder_adduction_frontal ?? 0) < 0.4 &&
        (next.actions.scapular_retraction ?? 0) < 0.4;
      // Вращение предплечья (на сгибаниях на бицепс «обратный/reverse» = пронированный хват, а «широкий» не меняет супинацию)
      if (isIsoCurl) {
        if (/(pronat|прон|overhand|reverse|обратн)/.test(gripText)) {
          next.geometry.forearmRotation = "pronated";
        } else if (/(neutral|нейтр|v-grip|v-рук|молот|hammer|parallel|параллел|канат|rope)/.test(gripText)) {
          next.geometry.forearmRotation = "neutral";
        } else if (/(supinat|супин|underhand)/.test(gripText)) {
          next.geometry.forearmRotation = "supinated";
        }
      } else {
        if (/(supinat|обратн|супин|underhand|reverse)/.test(gripText)) {
          next.geometry.forearmRotation = "supinated";
        } else if (/(neutral|нейтр|v-grip|v-рук|молот|hammer|parallel|параллел|канат|rope)/.test(gripText)) {
          next.geometry.forearmRotation = "neutral";
        } else if (/(pronat|прон|прям|overhand|wide|широк)/.test(gripText)) {
          next.geometry.forearmRotation = "pronated";
        }
      }

      // Плоскость локтей в тягах
      const degMatch = gripText.match(/(\d{1,3})\s*°/);
      if (degMatch) {
        next.geometry.shoulderPlaneDeg = clamp(Number(degMatch[1]), 0, 90);
      } else if (/(flared|развед|груд|chest|face|лиц|wide|широк)/.test(gripText)) {
        next.geometry.shoulderPlaneDeg = 75;
      } else if (/(tuck|прижат|пояс|waist|narrow|узк|v-grip)/.test(gripText)) {
        next.geometry.shoulderPlaneDeg = 15;
      }

      // Если это горизонтальная тяга, синхронизируем веса действий при смене угла локтей
      const isRow =
        (next.actions.shoulder_extension_sagittal ?? 0) >= 0.5 ||
        (next.actions.scapular_retraction ?? 0) >= 0.5 ||
        (next.actions.shoulder_horizontal_abduction ?? 0) >= 0.5;
      if (isRow && !(next.actions.shoulder_adduction_frontal ?? 0)) {
        if (next.geometry.shoulderPlaneDeg >= 60) {
          next.actions.shoulder_horizontal_abduction = 0.9;
          next.actions.scapular_retraction = 0.95;
          next.actions.shoulder_extension_sagittal = 0.3;
        } else if (next.geometry.shoulderPlaneDeg <= 30) {
          next.actions.shoulder_extension_sagittal = 0.95;
          next.actions.scapular_retraction = 0.72;
          next.actions.shoulder_horizontal_abduction = 0.25;
        }
      }
    }

    const stanceText = (exec.stance ?? "").toLowerCase();
    if (stanceText.trim()) {
      if (/(high|высок|верх)/.test(stanceText)) next.geometry.stanceFootHeight = "high";
      else if (/(low|низк|нижн)/.test(stanceText)) next.geometry.stanceFootHeight = "low";
      else if (/(mid|средн)/.test(stanceText)) next.geometry.stanceFootHeight = "mid";

      if (/(wide|широк|сумо|sumo)/.test(stanceText)) next.geometry.stanceWidth = "wide";
      else if (/(narrow|узк)/.test(stanceText)) next.geometry.stanceWidth = "narrow";
      else if (/(shoulder|плеч)/.test(stanceText)) next.geometry.stanceWidth = "shoulder";
    }

    return next;
  }

  /** Главная чистая физико-анатомическая функция расчёта O(1). */
  solveKinematics(descriptor: KinematicDescriptor): SolverOutput {
    const a = descriptor.actions;
    const g = descriptor.geometry;
    const p = descriptor.profile;

    const scores: Partial<Record<AnatomicalMuscleIdV4, number>> = {};
    const regions: Partial<Record<HypertrophyRegionId, 1.0 | 0.5>> = {};

    // =========================================================================
    // 1. ЖИМЫ / ПРИВЕДЕНИЕ ПЛЕЧА (угол скамьи benchAngleDeg: Chaves 2020, Rodríguez-Ridao 2020)
    // =========================================================================
    const had = a.shoulder_horizontal_adduction ?? 0;
    const sFlex = a.shoulder_flexion ?? 0;
    const isPressLike = had >= 0.4 || (sFlex >= 0.65 && (a.elbow_extension ?? 0) >= 0.4);

    if (isPressLike) {
      const ang = g.benchAngleDeg;
      const drive = Math.max(had, sFlex);
      if (ang <= -10) {
        addScore(scores, "pectoralis-sternal", 1.0 * drive);
        addScore(scores, "pectoralis-abdominal", 0.9 * drive);
        addScore(scores, "deltoid-anterior", 0.5 * drive);
      } else if (ang < 20) {
        const t = clamp(ang / 20, 0, 1);
        addScore(scores, "pectoralis-sternal", (1.0 - 0.15 * t) * drive);
        addScore(scores, "pectoralis-abdominal", (0.65 - 0.2 * t) * drive);
        addScore(scores, "pectoralis-clavicular", (0.55 + 0.25 * t) * drive);
        if ((a.elbow_extension ?? 0) >= 0.3) {
          addScore(scores, "deltoid-anterior", 0.55 * drive);
        }
      } else if (ang <= 45) {
        addScore(scores, "pectoralis-clavicular", 1.0 * drive);
        addScore(scores, "pectoralis-sternal", 0.62 * drive);
        addScore(scores, "deltoid-anterior", 0.62 * drive);
      } else if (ang < 65) {
        addScore(scores, "deltoid-anterior", 1.0 * drive);
        addScore(scores, "pectoralis-clavicular", 0.58 * drive);
        addScore(scores, "deltoid-middle", 0.52 * drive);
      } else {
        addScore(scores, "deltoid-anterior", 1.0 * drive);
        addScore(scores, "deltoid-middle", 0.56 * drive);
        addScore(scores, "serratus-anterior", 0.35);
      }

      if ((a.elbow_extension ?? 0) >= 0.4 && (a.elbow_extension ?? 0) < 0.85) {
        addScore(scores, "triceps-brachii", 0.62);
      }
    }

    // =========================================================================
    // 2. ТЯГИ / ПЛОСКОСТЬ ЛОКТЕЙ (shoulderPlaneDeg: Ackland 2008, Vasconcelos 2023)
    // =========================================================================
    const sExt = a.shoulder_extension_sagittal ?? 0;
    const sAdd = a.shoulder_adduction_frontal ?? 0;
    const sHabd = a.shoulder_horizontal_abduction ?? 0;
    const sER = a.shoulder_external_rotation ?? 0;
    const scapRet = a.scapular_retraction ?? 0;
    const scapElev = a.scapular_elevation ?? 0;

    if (sExt > 0 || sAdd > 0) {
      const pullDrive = Math.max(sExt, sAdd);
      const latCoeff =
        sAdd >= 0.7
          ? 1.0
          : g.shoulderPlaneDeg <= 35
            ? 1.0
            : g.shoulderPlaneDeg <= 50
              ? 0.85
              : 0.55;
      addScore(scores, "latissimus-dorsi", pullDrive * latCoeff);
      addScore(scores, "teres-major", pullDrive * latCoeff * 0.92);
      // Пуловер: длинная головка трицепса ассистирует разгибанию плеча
      if (sExt >= 0.85 && (a.elbow_flexion ?? 0) < 0.2) {
        addScore(scores, "triceps-brachii", 0.52);
      }
    }

    if (sHabd > 0 || sER > 0) {
      const planeCoeff =
        g.shoulderPlaneDeg >= 70 ? 1.0 : g.shoulderPlaneDeg >= 45 ? 0.78 : 0.35;
      const rdDrive = Math.max(sHabd * planeCoeff, sER * 0.95);
      addScore(scores, "deltoid-posterior", rdDrive);
      if (sER >= 0.4 || sHabd >= 0.6) {
        addScore(scores, "infraspinatus", Math.max(0.55, sER));
        addScore(scores, "teres-minor", Math.max(0.55, sER));
      }
    }

    if (scapRet > 0) {
      const retCoeff = g.shoulderPlaneDeg >= 45 ? 1.0 : 0.65;
      addScore(scores, "trapezius-middle", scapRet * retCoeff);
      addScore(scores, "rhomboids", scapRet * retCoeff);
      addScore(scores, "trapezius-lower", scapRet * retCoeff * 0.78);
    }

    if (scapElev > 0) {
      addScore(scores, "trapezius-upper", scapElev);
      addScore(scores, "trapezius-middle", scapElev * 0.55);
    }

    // =========================================================================
    // 3. ОТВЕДЕНИЕ ПЛЕЧА (Средняя дельта)
    // =========================================================================
    const sAbd = a.shoulder_abduction ?? 0;
    if (sAbd > 0) {
      if (sAbd >= 0.75) {
        addScore(scores, "deltoid-middle", sAbd);
        addScore(scores, "supraspinatus", 0.35);
      } else {
        addScore(scores, "deltoid-middle", Math.min(0.62, sAbd));
      }
    }

    // =========================================================================
    // 4. СГИБАНИЕ ЛОКТЯ (forearmRotation: Murray 1995/2000, Marcolin 2018)
    // =========================================================================
    const eFlex = a.elbow_flexion ?? 0;
    if (eFlex > 0) {
      const isIsoCurl = eFlex >= 0.8 && sExt < 0.4 && sAdd < 0.4 && scapRet < 0.4;
      if (isIsoCurl) {
        if (g.forearmRotation === "supinated") {
          addScore(scores, "biceps-brachii", 1.0);
          addScore(scores, "brachialis", g.shoulderFlexionDeg <= -15 ? 0.35 : 0.55);
          addScore(scores, "brachioradialis", 0.38);
        } else if (g.forearmRotation === "neutral") {
          addScore(scores, "brachialis", 1.0);
          addScore(scores, "brachioradialis", 0.95);
          addScore(scores, "biceps-brachii", 0.55);
        } else {
          // pronated (reverse curl)
          addScore(scores, "brachioradialis", 1.0);
          addScore(scores, "brachialis", 0.92);
          addScore(scores, "biceps-brachii", 0.3);
        }
      } else if (eFlex >= 0.35) {
        // Тяговые упражнения: сгибатели как ассистенты
        if (g.forearmRotation === "supinated") {
          addScore(scores, "biceps-brachii", 0.6);
          addScore(scores, "brachialis", 0.4);
        } else if (g.forearmRotation === "neutral") {
          addScore(scores, "brachialis", 0.58);
          addScore(scores, "brachioradialis", 0.52);
          addScore(scores, "biceps-brachii", 0.35);
        } else {
          addScore(scores, "biceps-brachii", 0.5);
          addScore(scores, "brachialis", 0.5);
        }
      }
    }

    // =========================================================================
    // 5. РАЗГИБАНИЕ ЛОКТЯ (Трицепс: Maeo 2023)
    // =========================================================================
    const eExt = a.elbow_extension ?? 0;
    if (eExt >= 0.75) {
      addScore(scores, "triceps-brachii", 1.0);
    } else if (eExt >= 0.4) {
      addScore(scores, "triceps-brachii", 0.62);
    }

    // =========================================================================
    // 6. НОГИ: РАЗГИБАНИЕ КОЛЕНА И БЕДРА (Парадокс Ломбарда + Stance: Kubo 2019, Plotkin 2023, Da Silva 2008)
    // =========================================================================
    const kExt = a.knee_extension ?? 0;
    const hExt = a.hip_extension ?? 0;
    const kFlex = a.knee_flexion ?? 0;
    const hAbd = a.hip_abduction ?? 0;

    if (kExt > 0 && hExt <= 0.15) {
      // Изолированное разгибание ног (leg-extension) — единственное primary для rectus-femoris!
      addScore(scores, "rectus-femoris", 1.0 * kExt);
      addScore(scores, "quadriceps-vasti", 0.62 * kExt);
    } else if (kExt > 0 && hExt > 0.15) {
      // Присед / жим ногами / выпады / Pendulum Squat / Trap Bar
      addScore(scores, "rectus-femoris", 0.25); // Строго стабилизатор (INV-04)

      const isHighWide = g.stanceFootHeight === "high" && g.stanceWidth === "wide";
      const isLow = g.stanceFootHeight === "low";
      const isPendulumLike =
        p.loadVector === "lever_arc" && p.supportType === "machine_guided" && kExt >= 0.9 && hExt <= 0.65;

      if (isHighWide) {
        addScore(scores, "gluteus-maximus", 1.0);
        addScore(scores, "adductor-magnus", 0.85);
        addScore(scores, "quadriceps-vasti", 0.62);
        addScore(scores, "biceps-femoris-long", 0.55);
        addScore(scores, "semimembranosus", 0.5);
      } else if (isLow) {
        addScore(scores, "quadriceps-vasti", 1.0);
        addScore(scores, "gluteus-maximus", 0.65);
        addScore(scores, "adductor-magnus", 0.45);
      } else if (isPendulumLike) {
        addScore(scores, "quadriceps-vasti", 1.0);
        addScore(scores, "gluteus-maximus", 0.68);
        addScore(scores, "adductor-magnus", 0.62);
        addScore(scores, "biceps-femoris-long", 0.25);
      } else {
        addScore(scores, "quadriceps-vasti", kExt >= 0.7 ? 1.0 : 0.6);
        addScore(scores, "gluteus-maximus", hExt >= 0.65 ? 1.0 : 0.65);
        addScore(scores, "adductor-magnus", hExt >= 0.65 ? 0.7 : 0.45);
      }
      // Становая трэп-грифом (высокое разгибание бедра + умеренное колено)
      if (p.implement === "trap_bar" && hExt >= 0.85) {
        addScore(scores, "biceps-femoris-long", 0.55);
      }
    } else if (hExt > 0 && kExt <= 0.15) {
      // Чистый хиндж / ягодичный мост
      const isShortenedGlute = p.peakTorqueZone === "shortened" && g.hipFlexionDeg <= 75;
      const isSpinalIso = (a.spinal_isometric_extension ?? 0) >= 0.85 && p.implement === "bodyweight";
      if (isShortenedGlute) {
        addScore(scores, "gluteus-maximus", 1.0);
        addScore(scores, "gluteus-medius", 0.55);
        addScore(scores, "biceps-femoris-long", 0.35);
      } else if (isSpinalIso) {
        addScore(scores, "erector-spinae", 1.0);
        addScore(scores, "gluteus-maximus", 0.58);
        addScore(scores, "biceps-femoris-long", 0.55);
      } else {
        // RDL / Deadlift / SLDL
        addScore(scores, "biceps-femoris-long", 1.0 * hExt);
        addScore(scores, "semimembranosus", 0.92 * hExt);
        addScore(scores, "semitendinosus", 0.85 * hExt);
        addScore(scores, "gluteus-maximus", hExt >= 0.85 ? 1.0 : 0.62);
      }
    }

    if (kFlex >= 0.5) {
      // Сгибания ног сидя / лёжа (Maeo 2021)
      addScore(scores, "biceps-femoris-short", 1.0 * kFlex);
      addScore(scores, "semitendinosus", 1.0 * kFlex);
      addScore(scores, "biceps-femoris-long", g.hipFlexionDeg >= 60 ? 0.95 * kFlex : 0.65 * kFlex);
      addScore(scores, "semimembranosus", g.hipFlexionDeg >= 60 ? 0.85 * kFlex : 0.55 * kFlex);
    }

    if (hAbd >= 0.5) {
      addScore(scores, "gluteus-medius", hAbd);
    }

    // =========================================================================
    // 7. ИКРЫ: АКТИВНАЯ НЕДОСТАТОЧНОСТЬ GASTROCNEMIUS (Kinoshita / Kassiano 2023)
    // =========================================================================
    const plantar = a.ankle_plantarflexion ?? 0;
    if (plantar >= 0.5) {
      if (g.kneeFlexionDeg >= 65) {
        addScore(scores, "soleus", 1.0);
        addScore(scores, "gastrocnemius", 0.15); // INV-05
      } else {
        addScore(scores, "gastrocnemius", 1.0);
        addScore(scores, "soleus", 0.62);
      }
    }

    // =========================================================================
    // 8. КОР И РАЗГИБАТЕЛИ ПОЗВОНОЧНИКА
    // =========================================================================
    const tFlex = a.trunk_flexion ?? 0;
    const tAnti = a.trunk_anti_extension ?? 0;
    const tRot = a.trunk_rotation ?? 0;
    const sIso = a.spinal_isometric_extension ?? 0;

    if (tFlex >= 0.5) {
      addScore(scores, "rectus-abdominis", tFlex);
      addScore(scores, "obliques", 0.55);
      // Подъём ног в висе: сгибание бедра дополнительно грузит прямую бедра (0.5)
      if (g.hipFlexionDeg >= 95 && p.supportType === "free_standing") {
        addScore(scores, "rectus-femoris", 0.55);
      }
    }
    if (tAnti >= 0.5) {
      addScore(scores, "rectus-abdominis", tAnti);
      addScore(scores, "obliques", 0.6);
      if (sExt >= 0.35) addScore(scores, "latissimus-dorsi", 0.55);
    }
    if (tRot >= 0.5) {
      addScore(scores, "obliques", tRot);
      addScore(scores, "rectus-abdominis", 0.55);
    }
    if (sIso >= 0.5) {
      if (sIso >= 0.85) addScore(scores, "erector-spinae", 1.0);
      else addScore(scores, "erector-spinae", 0.55);
    } else if (p.supportType === "free_standing" && g.torsoAngleDeg <= 55) {
      // INV-08 обязательная стабилизация
      addScore(scores, "erector-spinae", 0.35);
    }

    // =========================================================================
    // 9. КВАНТОВАНИЕ РОЛЕЙ (1.0 / 0.5 / 0.0) И ПРОЕКЦИЯ В 10 ЗОН UI
    // =========================================================================
    const muscles: Partial<Record<AnatomicalMuscleIdV4, MuscleAssignment>> = {};
    const primaryMuscles: AnatomicalMuscleIdV4[] = [];
    const assistantMuscles: AnatomicalMuscleIdV4[] = [];
    const stabilizerMuscles: AnatomicalMuscleIdV4[] = [];
    const zones10: Partial<Record<AggregatedZone10, 1.0 | 0.5 | 0.0>> = {};

    for (const [id, rawScore] of Object.entries(scores) as Array<[AnatomicalMuscleIdV4, number]>) {
      if (rawScore < 0.15) continue;
      let role: MuscleRoleV4;
      let weight: 1.0 | 0.5 | 0.0;
      if (STABILIZER_ONLY.has(id) || rawScore < 0.42) {
        role = "stabilizer";
        weight = 0.0;
      } else if (rawScore >= 0.75) {
        role = "primary";
        weight = 1.0;
      } else {
        role = "assistant";
        weight = 0.5;
      }
      muscles[id] = { role, weight, score: round2(rawScore) };
      if (role === "primary") primaryMuscles.push(id);
      else if (role === "assistant") assistantMuscles.push(id);
      else stabilizerMuscles.push(id);

      const z = MUSCLE_TO_ZONE10[id];
      const prev = zones10[z];
      if (prev === undefined || weight > prev) zones10[z] = weight;
    }

    primaryMuscles.sort();
    assistantMuscles.sort();
    stabilizerMuscles.sort();

    // =========================================================================
    // 10. ПРОЕКЦИЯ В 18+3 ГИПЕРТРОФИЧЕСКИХ РЕГИОНОВ (HypertrophyAuditEngine)
    // =========================================================================
    const wOf = (m: AnatomicalMuscleIdV4): 1.0 | 0.5 | 0.0 => muscles[m]?.weight ?? 0;

    if (wOf("pectoralis-clavicular") >= 0.5) addRegion(regions, "chest_upper", wOf("pectoralis-clavicular") as 1.0 | 0.5);
    const midLow = Math.max(wOf("pectoralis-sternal"), wOf("pectoralis-abdominal"));
    if (midLow >= 0.5) addRegion(regions, "chest_mid_lower", midLow as 1.0 | 0.5);

    const latW = Math.max(wOf("latissimus-dorsi"), wOf("teres-major"));
    if (latW >= 0.5) addRegion(regions, "lats", latW as 1.0 | 0.5);

    const ubW = Math.max(wOf("trapezius-middle"), wOf("trapezius-upper"), wOf("rhomboids"));
    if (ubW >= 0.5) addRegion(regions, "upper_back", ubW as 1.0 | 0.5);

    if (wOf("deltoid-anterior") >= 0.5) addRegion(regions, "delt_front", wOf("deltoid-anterior") as 1.0 | 0.5);
    if (wOf("deltoid-middle") >= 0.5) addRegion(regions, "delt_mid", wOf("deltoid-middle") as 1.0 | 0.5);
    if (wOf("deltoid-posterior") >= 0.5) addRegion(regions, "delt_rear", wOf("deltoid-posterior") as 1.0 | 0.5);

    if (wOf("biceps-brachii") >= 0.5) addRegion(regions, "biceps_stretch", wOf("biceps-brachii") as 1.0 | 0.5);
    const brW = Math.max(wOf("brachialis"), wOf("brachioradialis"));
    if (brW >= 0.5) addRegion(regions, "brachialis", brW as 1.0 | 0.5);

    // Трицепс: длинная головка vs лат./мед. по shoulderFlexionDeg (Maeo 2023)
    const triW = wOf("triceps-brachii");
    if (triW === 1.0) {
      if (g.shoulderFlexionDeg >= 75) {
        addRegion(regions, "triceps_long_head", 1.0);
        addRegion(regions, "triceps_lateral_medial", 0.5);
      } else {
        addRegion(regions, "triceps_lateral_medial", 1.0);
        addRegion(regions, "triceps_long_head", 0.5);
      }
    } else if (triW === 0.5) {
      if (sExt >= 0.85 && eExt < 0.2) {
        addRegion(regions, "triceps_long_head", 0.5);
      } else {
        addRegion(regions, "triceps_lateral_medial", 0.5);
      }
    }

    if (wOf("quadriceps-vasti") >= 0.5) addRegion(regions, "quads_vasti", wOf("quadriceps-vasti") as 1.0 | 0.5);
    if (wOf("rectus-femoris") >= 0.5) addRegion(regions, "quads_rectus_femoris", wOf("rectus-femoris") as 1.0 | 0.5);

    if (kFlex >= 0.5) {
      addRegion(regions, "hams_knee_flexion", 1.0);
      if (g.hipFlexionDeg >= 60) addRegion(regions, "hams_hinge", 0.5);
    } else {
      const hamHingeW = Math.max(wOf("biceps-femoris-long"), wOf("semimembranosus"));
      if (hamHingeW >= 0.5) addRegion(regions, "hams_hinge", hamHingeW as 1.0 | 0.5);
    }

    const gluteW = wOf("gluteus-maximus");
    if (gluteW >= 0.5) {
      if (p.peakTorqueZone === "shortened" && g.hipFlexionDeg <= 75 && kExt <= 0.15) {
        addRegion(regions, "glutes_shortened", 1.0);
        if (p.implement === "barbell") addRegion(regions, "glutes_stretched", 0.5);
      } else {
        addRegion(regions, "glutes_stretched", gluteW as 1.0 | 0.5);
      }
    }

    if (wOf("gastrocnemius") >= 0.5) addRegion(regions, "calves_gastroc", wOf("gastrocnemius") as 1.0 | 0.5);
    if (wOf("soleus") >= 0.5) addRegion(regions, "calves_soleus", wOf("soleus") as 1.0 | 0.5);

    const coreW = Math.max(wOf("rectus-abdominis"), wOf("obliques"));
    if (coreW >= 0.5) addRegion(regions, "core_abs", coreW as 1.0 | 0.5);
    if (wOf("erector-spinae") >= 0.5) addRegion(regions, "spinal_erectors", wOf("erector-spinae") as 1.0 | 0.5);

    // =========================================================================
    // 11. ОСЕВАЯ НАГРУЗКА, 5-ЗОННЫЕ РИСКИ JOINTGUARD, STRETCHSCORE И SFR
    // =========================================================================
    const axialLoadMultiplier = this.computeAxial(descriptor);
    const { jointRisk, longLeverRiskDelta } = this.computeJointRisks(descriptor, axialLoadMultiplier);
    const stretchScore = this.computeStretchScore(descriptor);
    const { sfrBase, sfrLongLevers } = this.computeSfr(
      descriptor,
      axialLoadMultiplier,
      jointRisk,
      longLeverRiskDelta,
      stretchScore,
    );

    return {
      muscles,
      primaryMuscles,
      assistantMuscles,
      stabilizerMuscles,
      zones10,
      regions,
      axialLoadMultiplier,
      jointRisk,
      longLeverRiskDelta,
      resistanceProfile: p.peakTorqueZone,
      stretchScore,
      sfrBase,
      sfrLongLevers,
    };
  }

  private computeAxial(d: KinematicDescriptor): AxialMultiplierV4 {
    const a = d.actions;
    const g = d.geometry;
    const p = d.profile;

    if (p.implement === "belt") return 0.15;
    if (p.supportType === "chest_or_back_supported" || p.supportType === "machine_guided") {
      // Стоячий тренажёр на икры или гакк-присед с вертикальной загрузкой
      if (p.loadVector === "gravity_vertical" && p.implement === "machine" && (a.knee_extension ?? 0) >= 0.7 && g.torsoAngleDeg >= 50) {
        return 0.5;
      }
      if ((a.ankle_plantarflexion ?? 0) >= 0.7 && g.kneeFlexionDeg < 45 && p.implement === "machine") {
        return 0.5;
      }
      return 0.15;
    }

    const isFree = p.supportType === "free_standing";
    const heavyLower = (a.knee_extension ?? 0) >= 0.65 || (a.hip_extension ?? 0) >= 0.65;
    const heavyBentRow =
      isFree && (a.scapular_retraction ?? 0) >= 0.6 && g.torsoAngleDeg <= 45 && p.implement === "barbell";

    if (isFree && (p.implement === "barbell" || p.implement === "trap_bar")) {
      if (heavyLower && p.laterality === "bilateral" && (g.torsoAngleDeg <= 65 || (a.knee_extension ?? 0) >= 0.85)) {
        return 1.5;
      }
      if (heavyBentRow && g.torsoAngleDeg <= 30) return 1.5;
      if (heavyBentRow || (a.shoulder_flexion ?? 0) >= 0.85 || (a.scapular_elevation ?? 0) >= 0.8 || heavyLower) {
        return 1.0;
      }
      return 0.5;
    }

    if (isFree && p.implement === "dumbbell") {
      if (heavyLower || (a.shoulder_flexion ?? 0) >= 0.7 || (a.shoulder_extension_sagittal ?? 0) >= 0.7) return 0.5;
      return 0.15;
    }

    if (p.supportType === "lying" && p.implement === "barbell" && ((a.shoulder_horizontal_adduction ?? 0) >= 0.6 || (a.hip_extension ?? 0) >= 0.7)) {
      return 0.5;
    }

    if (isFree && p.implement === "bodyweight" && ((a.shoulder_adduction_frontal ?? 0) >= 0.7 || (a.shoulder_horizontal_adduction ?? 0) >= 0.7 || (a.spinal_isometric_extension ?? 0) >= 0.7)) {
      return 0.5;
    }

    return 0.15;
  }

  private computeJointRisks(
    d: KinematicDescriptor,
    axial: AxialMultiplierV4,
  ): {
    jointRisk: Record<JointZone, 0 | 1 | 2 | 3>;
    longLeverRiskDelta: Record<JointZone, 0 | 1>;
  } {
    const a = d.actions;
    const g = d.geometry;
    const p = d.profile;

    let lumbar: 0 | 1 | 2 | 3 = 0;
    let shoulder: 0 | 1 | 2 | 3 = 0;
    let elbow: 0 | 1 | 2 | 3 = 0;
    let knee: 0 | 1 | 2 | 3 = 0;
    let wrist: 0 | 1 | 2 | 3 = 0;

    let llLumbar: 0 | 1 = 0;
    let llShoulder: 0 | 1 = 0;
    let llElbow: 0 | 1 = 0;
    let llKnee: 0 | 1 = 0;
    let llWrist: 0 | 1 = 0;

    // 1. Поясница
    if (p.supportType === "chest_or_back_supported" || p.implement === "belt") {
      lumbar = 0;
    } else if (axial >= 1.5) {
      lumbar = p.implement === "trap_bar" ? 2 : 3;
      if (p.implement !== "trap_bar") llLumbar = 1;
    } else if (axial >= 1.0) {
      lumbar = 2;
      if (p.implement === "barbell" && (a.scapular_elevation ?? 0) < 0.8) llLumbar = 1;
    } else if (
      (a.trunk_anti_extension ?? 0) >= 0.75 ||
      ((a.hip_extension ?? 0) >= 0.7 && p.supportType === "free_standing")
    ) {
      lumbar = 2;
      if ((a.trunk_anti_extension ?? 0) >= 0.75) llLumbar = 1;
    } else if (axial >= 0.5 || p.supportType === "free_standing" && ((a.knee_extension ?? 0) >= 0.5 || (a.trunk_flexion ?? 0) >= 0.6)) {
      lumbar = 1;
    }

    // 2. Переднее плечо
    const isPress = (a.shoulder_horizontal_adduction ?? 0) >= 0.5 || (a.shoulder_flexion ?? 0) >= 0.7;
    if (isPress && g.benchAngleDeg <= -10 && (p.implement === "bodyweight" || p.implement === "barbell")) {
      shoulder = 3;
      llShoulder = 1;
    } else if (isPress && p.implement === "barbell") {
      shoulder = 2;
      llShoulder = 1;
    } else if ((a.shoulder_horizontal_adduction ?? 0) >= 0.7 && p.implement === "dumbbell" && (a.elbow_extension ?? 0) < 0.2) {
      shoulder = 2;
      llShoulder = 1;
    } else if ((a.elbow_flexion ?? 0) >= 0.8 && g.shoulderFlexionDeg <= -15) {
      shoulder = 2;
      llShoulder = 1;
    } else if (
      isPress ||
      (a.shoulder_abduction ?? 0) >= 0.7 ||
      (a.shoulder_adduction_frontal ?? 0) >= 0.7 ||
      (a.shoulder_extension_sagittal ?? 0) >= 0.6
    ) {
      shoulder = p.supportType === "free_standing" && (a.shoulder_adduction_frontal ?? 0) >= 0.8 ? 2 : 1;
    }

    // 3. Локоть
    const isRigidBar = p.implement === "barbell" || p.implement === "ez_bar";
    if ((a.elbow_extension ?? 0) >= 0.75 && isRigidBar && g.shoulderFlexionDeg >= 75) {
      elbow = 3;
      llElbow = 1;
    } else if (isRigidBar && ((a.elbow_flexion ?? 0) >= 0.75 || (a.shoulder_horizontal_adduction ?? 0) >= 0.7)) {
      elbow = 2;
      if ((a.elbow_flexion ?? 0) >= 0.75) llElbow = 1;
    } else if ((a.elbow_extension ?? 0) >= 0.75 && p.implement === "dumbbell" && g.shoulderFlexionDeg >= 90) {
      elbow = 2;
      llElbow = 1;
    } else if ((a.elbow_flexion ?? 0) >= 0.4 || (a.elbow_extension ?? 0) >= 0.4) {
      elbow = 1;
    }

    // 4. Колено
    if ((a.knee_extension ?? 0) >= 0.7) {
      if (p.supportType === "free_standing" && p.implement === "barbell" && p.laterality === "bilateral") {
        knee = 3;
        llKnee = 1;
      } else if (p.implement === "bodyweight" && p.supportType === "free_standing") {
        knee = 1;
      } else {
        knee = 2;
        if (p.loadVector === "lever_arc" || (p.supportType === "machine_guided" && g.kneeFlexionDeg >= 115) || p.implement === "barbell") {
          llKnee = 1;
        }
      }
    } else if ((a.knee_flexion ?? 0) >= 0.7 || ((a.hip_extension ?? 0) >= 0.7 && (a.knee_extension ?? 0) >= 0.3)) {
      knee = 1;
    }

    // 5. Запястье
    if (p.implement === "barbell" && (a.elbow_flexion ?? 0) >= 0.75 && g.forearmRotation === "supinated") {
      wrist = 3;
      llWrist = 1;
    } else if (isRigidBar && (isPress || (a.elbow_extension ?? 0) >= 0.75 || (a.elbow_flexion ?? 0) >= 0.75)) {
      wrist = 2;
    } else if (p.implement === "dumbbell" && (isPress || (a.elbow_flexion ?? 0) >= 0.7)) {
      wrist = 1;
    }

    return {
      jointRisk: {
        lumbar,
        shoulder_anterior: shoulder,
        elbow,
        knee_patellar: knee,
        wrist,
      },
      longLeverRiskDelta: {
        lumbar: llLumbar,
        shoulder_anterior: llShoulder,
        elbow: llElbow,
        knee_patellar: llKnee,
        wrist: llWrist,
      },
    };
  }

  private computeStretchScore(d: KinematicDescriptor): 1 | 2 | 3 {
    const a = d.actions;
    const g = d.geometry;
    const p = d.profile;

    if (p.rom === "lengthened_partial") return 3;
    if (p.rom === "shortened_partial") return 1;

    // Активная недостаточность икроножной сидя
    if ((a.ankle_plantarflexion ?? 0) >= 0.5 && g.kneeFlexionDeg >= 65) return 1;

    // Двусуставные и высокорастянутые позиции (stretchScore = 3)
    if ((a.knee_flexion ?? 0) >= 0.7 && g.hipFlexionDeg >= 60) return 3;
    if ((a.elbow_extension ?? 0) >= 0.75 && g.shoulderFlexionDeg >= 90 && p.peakTorqueZone === "lengthened") return 3;
    if ((a.elbow_flexion ?? 0) >= 0.8 && (g.shoulderFlexionDeg <= -15 || p.peakTorqueZone === "lengthened")) return 3;
    if ((a.ankle_plantarflexion ?? 0) >= 0.5 && g.kneeFlexionDeg < 45) return 3;
    if ((a.hip_extension ?? 0) >= 0.8 && (a.knee_extension ?? 0) <= 0.15 && p.peakTorqueZone === "lengthened") return 3;
    if ((a.knee_extension ?? 0) >= 0.8 && p.peakTorqueZone === "lengthened" && g.kneeFlexionDeg >= 115) return 3;

    if (p.peakTorqueZone === "lengthened") {
      // Гантели, трос, брусья, глубокие рычаги дают более выраженное растяжение, чем штанга с ограничением груди
      if (
        p.implement === "dumbbell" ||
        p.implement === "cable" ||
        (p.loadVector === "lever_arc" && p.supportType === "machine_guided") ||
        (a.trunk_anti_extension ?? 0) >= 0.75
      ) {
        return 3;
      }
      return 2;
    }

    if (p.peakTorqueZone === "shortened") {
      // Разгибание ног сидя (leg-extension) — всё равно даёт 2 за счёт растяжения прямой бедра в начале
      if ((a.knee_extension ?? 0) >= 0.8 && (a.hip_extension ?? 0) <= 0.15) return 2;
      return 1;
    }

    return 2;
  }

  private computeSfr(
    d: KinematicDescriptor,
    axial: AxialMultiplierV4,
    risk: Record<JointZone, 0 | 1 | 2 | 3>,
    llDelta: Record<JointZone, 0 | 1>,
    stretchScore: 1 | 2 | 3,
  ): { sfrBase: number; sfrLongLevers: number } {
    const a = d.actions;
    const p = d.profile;

    const stabScore =
      p.supportType === "machine_guided"
        ? 0.95
        : p.supportType === "chest_or_back_supported"
          ? 0.9
          : p.supportType === "lying"
            ? 0.65
            : p.supportType === "seated_unsupported"
              ? 0.45
              : 0.12;

    const activeCount = Object.values(a).filter((v) => typeof v === "number" && v >= 0.4).length;
    const majorLower = (a.knee_extension ?? 0) >= 0.65 || (a.hip_extension ?? 0) >= 0.65;
    const cns = clamp(
      0.35 +
        (activeCount - 1) * 0.35 +
        (majorLower && p.supportType === "free_standing" ? 1.25 : 0) +
        (p.implement === "barbell" && p.supportType === "free_standing" ? 0.55 : 0),
      0.3,
      3.2,
    );

    const sBase = majorLower ? 7.6 : activeCount >= 2 ? 7.0 : 6.4;
    const S = sBase + 0.65 * stretchScore + 0.85 * stabScore;
    const maxRisk = Math.max(risk.lumbar, risk.shoulder_anterior, risk.elbow, risk.knee_patellar, risk.wrist);
    const fBase = 0.7 + 1.85 * axial + 0.6 * cns + 0.35 * maxRisk;

    const llSum =
      llDelta.lumbar +
      llDelta.shoulder_anterior +
      llDelta.elbow +
      llDelta.knee_patellar +
      llDelta.wrist;
    const freeAxial = p.supportType === "free_standing" && axial >= 1.0 ? 1 : 0;
    const fLL = fBase + 0.9 * llSum + 0.85 * freeAxial;

    const calc = (F: number) => round1(clamp(11.2 * (S / (S + 1.45 * F)), 1.0, 10.0));
    const sfrBase = calc(fBase);
    const sfrLongLevers = Math.min(sfrBase, calc(fLL));
    return { sfrBase, sfrLongLevers };
  }
}

/** Удобный конструктор дескриптора с безопасными значениями по умолчанию. */
export function makeDescriptor(
  actions: KinematicDescriptor["actions"],
  geometry: Partial<KinematicDescriptor["geometry"]> = {},
  profile: Partial<KinematicDescriptor["profile"]> = {},
): KinematicDescriptor {
  return {
    actions,
    geometry: {
      shoulderPlaneDeg: 35,
      shoulderFlexionDeg: 15,
      forearmRotation: "pronated",
      benchAngleDeg: 0,
      torsoAngleDeg: 90,
      hipFlexionDeg: 15,
      kneeFlexionDeg: 15,
      stanceFootHeight: "mid",
      stanceWidth: "shoulder",
      ...geometry,
    },
    profile: {
      supportType: "free_standing",
      loadVector: "gravity_vertical",
      peakTorqueZone: "mid",
      laterality: "bilateral",
      implement: "barbell",
      rom: "full",
      ...profile,
    },
  };
}
