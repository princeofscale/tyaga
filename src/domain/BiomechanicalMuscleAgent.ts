import { BiomechanicalVerifier } from "./BiomechanicalVerifier";
import { KinematicMuscleSolver, makeDescriptor } from "./KinematicMuscleSolver";
import { SEED_KINEMATICS_74 } from "./KinematicSeed74";
import {
  SOLVER_VERSION_V4,
  type AgentResolveRequest,
  type AgentResolveResponse,
  type ClarifyingChip,
  type ClarifyingParam,
  type ClarifyingQuestion,
  type KinematicDescriptor,
} from "./KinematicTypesV4";

interface ParsedOfflineResult {
  canonicalSlug: string;
  displayName: string;
  rationale: string;
  confidence: number;
  missingParams: ClarifyingParam[];
  descriptor: KinematicDescriptor;
  source: "seed_v3" | "offline_kinematic";
}

function slugify(text: string): string {
  const clean = text
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return (clean || "custom-exercise").slice(0, 64);
}

/**
 * Гибридный ИИ-агент биомеханической разметки мышц «Тяга v4».
 * - Онлайн: вызывает POST /api/v4/biomechanics/resolve (Cloudflare Worker + D1 кэш + LLM/VLM).
 * - Оффлайн / фолбэк: Tier 0 (74 seed) + Tier 4 (RU/EN биомеханический NLP-парсер) ->
 *   KinematicMuscleSolver (<0.1 мс) -> BiomechanicalVerifier (15 инвариантов).
 */
export class BiomechanicalMuscleAgent {
  private readonly solver: KinematicMuscleSolver;
  private readonly verifier: BiomechanicalVerifier;

  constructor(
    solver: KinematicMuscleSolver = new KinematicMuscleSolver(),
    verifier: BiomechanicalVerifier = new BiomechanicalVerifier(),
  ) {
    this.solver = solver;
    this.verifier = verifier;
  }

  /** Применяет 1-tap уточняющий чип локально (<0.1 мс) без сетевого вызова. */
  applyClarifyingChip(
    descriptor: KinematicDescriptor,
    chip: ClarifyingChip,
  ): { descriptor: KinematicDescriptor; solved: AgentResolveResponse["solved"]; verification: AgentResolveResponse["verification"] } {
    let next: KinematicDescriptor = {
      actions: { ...descriptor.actions, ...(chip.descriptorPatch?.actions ?? {}) },
      geometry: { ...descriptor.geometry, ...(chip.descriptorPatch?.geometry ?? {}) },
      profile: { ...descriptor.profile, ...(chip.descriptorPatch?.profile ?? {}) },
    };
    if (chip.executionPatch) {
      next = KinematicMuscleSolver.applyExecutionProfile(next, chip.executionPatch);
    }
    const raw = this.solver.solveKinematics(next);
    const verified = this.verifier.verifyAndCorrect(next, raw);
    return {
      descriptor: next,
      solved: verified.correctedResult,
      verification: {
        passed: verified.passed,
        status: verified.status,
        violations: verified.violations,
      },
    };
  }

  /** Строит не более 2 кнопочных уточняющих вопросов (Active 1-Tap Clarification). */
  static buildClarifyingQuestions(missingParams: readonly ClarifyingParam[]): ClarifyingQuestion[] {
    const out: ClarifyingQuestion[] = [];
    for (const param of missingParams.slice(0, 2)) {
      if (param === "pullVector") {
        out.push({
          param,
          question: "Направление тяги рукоятей?",
          chips: [
            {
              id: "pull-high",
              label: "Сверху вниз (широчайшие)",
              descriptorPatch: {
                actions: { shoulder_adduction_frontal: 0.95, shoulder_extension_sagittal: 0.8, scapular_retraction: 0.55, elbow_flexion: 0.55 },
                geometry: { shoulderPlaneDeg: 25 },
              },
            },
            {
              id: "pull-horiz",
              label: "Горизонтально к корпусу",
              descriptorPatch: {
                actions: { shoulder_extension_sagittal: 0.9, scapular_retraction: 0.8, elbow_flexion: 0.55 },
                geometry: { shoulderPlaneDeg: 35 },
              },
            },
            {
              id: "pull-low",
              label: "Снизу вверх к груди",
              descriptorPatch: {
                actions: { scapular_retraction: 0.95, shoulder_horizontal_abduction: 0.85, elbow_flexion: 0.55 },
                geometry: { shoulderPlaneDeg: 70 },
              },
            },
          ],
        });
      } else if (param === "shoulderPlaneDeg") {
        out.push({
          param,
          question: "Положение локтей в тяге?",
          chips: [
            {
              id: "elbows-tucked",
              label: "Прижаты 15–30° (широчайшие)",
              executionPatch: { grip: "narrow neutral tucked 20°" },
            },
            {
              id: "elbows-flared",
              label: "Разведены 60–75° (верх спины)",
              executionPatch: { grip: "wide pronated flared 70°" },
            },
          ],
        });
      } else if (param === "benchAngleDeg") {
        out.push({
          param,
          question: "Угол спинки / скамьи?",
          chips: [
            { id: "bench-flat", label: "Горизонтально 0°", executionPatch: { benchAngle: 0 } },
            { id: "bench-inc", label: "Наклон 30° (верх груди)", executionPatch: { benchAngle: 30 } },
            { id: "bench-steep", label: "Высокий 60°+ (плечи)", executionPatch: { benchAngle: 60 } },
          ],
        });
      } else if (param === "stanceFootHeight") {
        out.push({
          param,
          question: "Постановка стоп на платформе?",
          chips: [
            { id: "stance-low", label: "Низко (квадрицепс)", executionPatch: { stance: "low narrow" } },
            { id: "stance-mid", label: "По центру (баланс)", executionPatch: { stance: "mid shoulder" } },
            { id: "stance-high", label: "Высоко и широко (ягодицы)", executionPatch: { stance: "high wide" } },
          ],
        });
      } else if (param === "forearmRotation") {
        out.push({
          param,
          question: "Какой хват используется?",
          chips: [
            { id: "grip-sup", label: "Супинированный (бицепс)", executionPatch: { grip: "supinated" } },
            { id: "grip-neu", label: "Нейтральный / молотки", executionPatch: { grip: "neutral" } },
            { id: "grip-pro", label: "Прямой пронированный", executionPatch: { grip: "pronated" } },
          ],
        });
      }
    }
    return out;
  }

  /** Оффлайн-резолвер (Tier 0 + Tier 4 RU/EN NLP -> Solver -> Verifier). */
  resolveOffline(req: AgentResolveRequest): AgentResolveResponse {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const parsed = this.parseOfflineQuery(req.queryText, req.machineBrandHint);
    const descriptor = KinematicMuscleSolver.applyExecutionProfile(parsed.descriptor, req.executionProfile);
    const raw = this.solver.solveKinematics(descriptor);
    const verified = this.verifier.verifyAndCorrect(descriptor, raw);
    const questions =
      parsed.confidence < 0.8 ? BiomechanicalMuscleAgent.buildClarifyingQuestions(parsed.missingParams) : [];

    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    return {
      canonicalSlug: parsed.canonicalSlug,
      displayName: parsed.displayName,
      rationale: parsed.rationale,
      source: parsed.source,
      confidence: parsed.confidence,
      descriptor,
      solved: verified.correctedResult,
      verification: {
        passed: verified.passed,
        status: verified.status,
        violations: verified.violations,
      },
      clarifyingQuestions: questions,
      latencyMs: Math.round(elapsed * 100) / 100,
      solverVersion: SOLVER_VERSION_V4,
    };
  }

  /** Онлайн-вызов Cloudflare Worker с бесшовным откатом на оффлайн-солвер при отсутствии сети. */
  async resolve(req: AgentResolveRequest): Promise<AgentResolveResponse> {
    if (typeof fetch === "undefined") {
      return this.resolveOffline(req);
    }
    try {
      const res = await fetch("/api/v4/biomechanics/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) return this.resolveOffline(req);
      const data = (await res.json()) as AgentResolveResponse;
      if (!data?.descriptor || !data?.solved) return this.resolveOffline(req);
      return data;
    } catch {
      return this.resolveOffline(req);
    }
  }

  /**
   * Tier 0 + Tier 4: детерминированный RU/EN NLP-парсер брендовых тренажёров,
   * сленговых названий и произвольных описаний в KinematicDescriptor.
   */
  parseOfflineQuery(queryText: string, brandHint?: string): ParsedOfflineResult {
    const trimmed = queryText.trim();
    const full = `${trimmed} ${brandHint ?? ""}`.toLowerCase().replace(/\s+/g, " ");

    // Tier 0: точное совпадение с 74 ID
    if (SEED_KINEMATICS_74[trimmed.toLowerCase()]) {
      const id = trimmed.toLowerCase();
      return {
        canonicalSlug: id,
        displayName: trimmed,
        rationale: "Канонический кинематический профиль из базового каталога Тяга v4.",
        confidence: 0.98,
        missingParams: [],
        descriptor: SEED_KINEMATICS_74[id],
        source: "seed_v3",
      };
    }

    // === Специализированные и брендовые тренажёры вне каталога 74 ID ===

    // 1. Pendulum Squat (TC5)
    if (/(pendulum|маятников)/.test(full) && /(squat|присед)/.test(full)) {
      return {
        canonicalSlug: "pendulum-squat",
        displayName: trimmed || "Pendulum Squat",
        rationale: "Рычажная дуга с упором спины: максимальное сгибание колена (глубокое растяжение квадрицепса) при нулевой осевой компрессии позвоночника.",
        confidence: 0.94,
        missingParams: [],
        descriptor: makeDescriptor(
          { knee_extension: 1.0, hip_extension: 0.6 },
          { torsoAngleDeg: 50, hipFlexionDeg: 110, kneeFlexionDeg: 130 },
          { supportType: "machine_guided", loadVector: "lever_arc", peakTorqueZone: "lengthened", implement: "machine" },
        ),
        source: "offline_kinematic",
      };
    }

    // 2. Belt Squat
    if (/(belt squat|поясн.*присед|присед.*пояс)/.test(full)) {
      return {
        canonicalSlug: "belt-squat",
        displayName: trimmed || "Belt Squat",
        rationale: "Нагрузка подвешена на тазовом поясе — полная разгрузка поясницы (axial 0.15) при высоком стимуле квадрицепсов и ягодичных.",
        confidence: 0.94,
        missingParams: [],
        descriptor: makeDescriptor(
          { knee_extension: 1.0, hip_extension: 0.85 },
          { torsoAngleDeg: 75, hipFlexionDeg: 115, kneeFlexionDeg: 120 },
          { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "belt" },
        ),
        source: "offline_kinematic",
      };
    }

    // 3. Hammer Strength Iso-Lateral High Row (TC4)
    if (/(high row|верхн.*тяга.*хаммер|iso-?lateral.*high.*row)/.test(full)) {
      const neutral = /(нейтр|neutral|узк|narrow)/.test(full);
      const wide = /(широк|wide|flared|развед)/.test(full);
      return {
        canonicalSlug: "hammer-strength-iso-lateral-high-row",
        displayName: trimmed || "Hammer Strength Iso-Lateral High Row",
        rationale: "Тяга рычагов сверху вниз с упором груди: сагиттальное разгибание плеча грузит широчайшие и большую круглую без нагрузки на поясницу.",
        confidence: 0.92,
        missingParams: [],
        descriptor: makeDescriptor(
          {
            shoulder_extension_sagittal: wide ? 0.65 : 1.0,
            shoulder_adduction_frontal: wide ? 0.65 : 0.85,
            scapular_retraction: wide ? 0.95 : 0.65,
            elbow_flexion: 0.55,
          },
          {
            shoulderPlaneDeg: wide ? 65 : 20,
            forearmRotation: neutral ? "neutral" : "pronated",
            torsoAngleDeg: 80,
          },
          { supportType: "chest_or_back_supported", loadVector: "lever_arc", peakTorqueZone: "lengthened", laterality: "unilateral", implement: "machine" },
        ),
        source: "offline_kinematic",
      };
    }

    // 4. Bayesian Cable Curl (TC6a)
    if (/(bayesian|байес)/.test(full)) {
      return {
        canonicalSlug: "bayesian-cable-curl",
        displayName: trimmed || "Bayesian Cable Curl",
        rationale: "Плечо разогнуто назад (~30°) с выровненным вектором троса: пиковый момент в глубоком растяжении двуглавой мышцы плеча.",
        confidence: 0.94,
        missingParams: [],
        descriptor: makeDescriptor(
          { elbow_flexion: 1.0 },
          { shoulderFlexionDeg: -30, forearmRotation: "supinated" },
          { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "lengthened", laterality: "unilateral", implement: "cable" },
        ),
        source: "offline_kinematic",
      };
    }

    // 5. JM Press (TC6b)
    if (/(jm press|джи-?эм|джм)/.test(full)) {
      return {
        canonicalSlug: "jm-press",
        displayName: trimmed || "JM Press",
        rationale: "Гибрид узкого жима и французского жима: предельное разгибание локтя под нагрузкой штанги с плечом ~85° (акцент трицепс + высокий локтевой стресс).",
        confidence: 0.92,
        missingParams: [],
        descriptor: makeDescriptor(
          { elbow_extension: 1.0, shoulder_horizontal_adduction: 0.55 },
          { benchAngleDeg: 0, shoulderFlexionDeg: 85, shoulderPlaneDeg: 25, forearmRotation: "pronated" },
          { supportType: "lying", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "barbell" },
        ),
        source: "offline_kinematic",
      };
    }

    // 6. Nautilus / Machine Pullover
    if (/(nautilus|машин|тренаж)/.test(full) && /(pullover|пуловер)/.test(full)) {
      return {
        canonicalSlug: "machine-pullover",
        displayName: trimmed || "Machine Pullover",
        rationale: "Кулачковый тренажёр пуловер изолирует разгибание плеча в сагиттальной плоскости без участия сгибателей предплечья.",
        confidence: 0.91,
        missingParams: [],
        descriptor: makeDescriptor(
          { shoulder_extension_sagittal: 1.0 },
          { shoulderPlaneDeg: 10, shoulderFlexionDeg: 145, torsoAngleDeg: 85 },
          { supportType: "machine_guided", loadVector: "cam_variable", peakTorqueZone: "lengthened", implement: "machine" },
        ),
        source: "offline_kinematic",
      };
    }

    // 7. Meadows Row
    if (/(meadows|медоуз)/.test(full)) {
      return {
        canonicalSlug: "meadows-row",
        displayName: trimmed || "Meadows Row",
        rationale: "Односторонняя тяга конца грифа (T-bar/landmine) с отведением локтя ~55°: мощный стимул верха спины, задней дельты и широчайших.",
        confidence: 0.9,
        missingParams: [],
        descriptor: makeDescriptor(
          { scapular_retraction: 0.95, shoulder_horizontal_abduction: 0.75, shoulder_extension_sagittal: 0.75, elbow_flexion: 0.55 },
          { shoulderPlaneDeg: 55, forearmRotation: "pronated", torsoAngleDeg: 35 },
          { supportType: "free_standing", loadVector: "lever_arc", peakTorqueZone: "lengthened", laterality: "unilateral", implement: "barbell" },
        ),
        source: "offline_kinematic",
      };
    }

    // 8. Неоднозначная «Тяга в тренажёре Хаммер» без указания вектора и угла локтей (TC9)
    const isRowQuery = /(тяга|row|хаммер|hammer)/.test(full) && !/(станов|deadlift|румын|rdl|жим|press|присед|squat)/.test(full);
    if (isRowQuery) {
      const hasVector = /(верхн|сверх|high|low|сниз|горизонт|к поясу|к груди|pulldown|подтяг)/.test(full);
      const hasPlane = /(узк|narrow|прижат|tuck|широк|wide|развед|flared|нейтр|neutral|\d{2}\s*°)/.test(full);
      const isSupported = /(упор|груд|хаммер|hammer|тренаж|machine|chest)/.test(full);
      const isFlared = /(широк|wide|развед|flared|к груди)/.test(full);
      const isTucked = /(узк|narrow|прижат|tuck|к поясу|нейтр|neutral)/.test(full);
      const missing: ClarifyingParam[] = [];
      if (!hasVector) missing.push("pullVector");
      if (!hasPlane) missing.push("shoulderPlaneDeg");

      const planeDeg = isFlared ? 75 : isTucked ? 20 : 45;
      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || "Тяга в тренажёре",
        rationale:
          missing.length > 0
            ? "Предварительная оценка тягового движения: уточни вектор рукоятей и угол локтей в 1 клик для точного баланса широчайших и верха спины."
            : isTucked
              ? "Сагиттальная тяга с прижатыми локтями акцентирует широчайшие и большую круглую мышцу."
              : "Тяга с отведёнными локтями и ретракцией лопаток смещает фокус на верх спины и заднюю дельту.",
        confidence: missing.length === 2 ? 0.58 : missing.length === 1 ? 0.72 : 0.88,
        missingParams: missing,
        descriptor: makeDescriptor(
          isFlared
            ? { scapular_retraction: 0.95, shoulder_horizontal_abduction: 0.9, shoulder_extension_sagittal: 0.35, elbow_flexion: 0.55 }
            : isTucked
              ? { shoulder_extension_sagittal: 1.0, scapular_retraction: 0.65, elbow_flexion: 0.55 }
              : { scapular_retraction: 0.95, shoulder_extension_sagittal: 0.9, elbow_flexion: 0.55 },
          {
            shoulderPlaneDeg: planeDeg,
            forearmRotation: /(нейтр|neutral)/.test(full) ? "neutral" : /(обратн|supin)/.test(full) ? "supinated" : "pronated",
            torsoAngleDeg: isSupported ? 80 : 45,
          },
          {
            supportType: isSupported ? "chest_or_back_supported" : "seated_unsupported",
            loadVector: /(хаммер|hammer|рычаг|lever)/.test(full) ? "lever_arc" : "cable_aligned",
            peakTorqueZone: "mid",
            implement: /(гантел|db|dumbbell)/.test(full) ? "dumbbell" : /(блок|кабел|cable)/.test(full) ? "cable" : "machine",
          },
        ),
        source: "offline_kinematic",
      };
    }

    // 9. Обобщённые жимы (грудь / плечи)
    if (/(жим|press|брус|dip|сведен|развод|fly|pec)/.test(full) && !/(ног|leg|икр|calf)/.test(full)) {
      const isFly = /(сведен|развод|fly|pec|бабочк|кроссовер)/.test(full);
      const isOverhead = /(стоя|сидя.*плеч|дельт|армей|overhead|ohp|shoulder)/.test(full);
      const isIncline = /(наклон|верх|incline|30|45)/.test(full);
      const isDecline = /(вниз|обратн.*наклон|decline|брус|dip)/.test(full);
      const benchAngle = isOverhead ? 80 : isIncline ? 30 : isDecline ? -15 : 0;
      const hasAngleHint = isOverhead || isIncline || isDecline || /(горизонт|flat|лёжа|лежа)/.test(full);
      const isMachine = /(тренаж|хаммер|hammer|смит|smith|machine|рычаг|technogym|matrix)/.test(full);

      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || "Жимовое упражнение",
        rationale: isOverhead
          ? "Вертикальный жим (угол 80°): первичный стимул на переднюю дельту с ассистенцией средней дельты и трицепса."
          : isIncline
            ? "Жим на наклонной 30° смещает первичный акцент на ключичный пучок (верх груди)."
            : "Горизонтальное приведение плеча акцентирует грудинный отдел большой грудной мышцы.",
        confidence: hasAngleHint ? 0.88 : 0.72,
        missingParams: hasAngleHint ? [] : ["benchAngleDeg"],
        descriptor: makeDescriptor(
          isFly
            ? { shoulder_horizontal_adduction: 1.0 }
            : isOverhead
              ? { shoulder_flexion: 1.0, shoulder_abduction: 0.55, elbow_extension: 0.6 }
              : { shoulder_horizontal_adduction: 1.0, elbow_extension: 0.6 },
          { benchAngleDeg: benchAngle, shoulderPlaneDeg: 45 },
          {
            supportType: isMachine ? "machine_guided" : "lying",
            loadVector: isMachine ? "lever_arc" : "gravity_vertical",
            peakTorqueZone: "lengthened",
            implement: isMachine ? "machine" : /(гантел|db|dumbbell)/.test(full) ? "dumbbell" : "barbell",
          },
        ),
        source: "offline_kinematic",
      };
    }

    // 10. Ноги: жим ногами / присед / разгибания / сгибания / икры
    if (/(жим ног|leg ?press)/.test(full)) {
      const hasStance = /(высок|high|низк|low|широк|wide|узк|narrow)/.test(full);
      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || "Жим ногами",
        rationale: "Синхронное разгибание колена и бедра в направляющих (rectus-femoris ингибирована парадоксом Ломбарда).",
        confidence: hasStance ? 0.9 : 0.75,
        missingParams: hasStance ? [] : ["stanceFootHeight"],
        descriptor: makeDescriptor(
          { knee_extension: 1.0, hip_extension: 0.85 },
          {
            torsoAngleDeg: 45,
            hipFlexionDeg: 115,
            kneeFlexionDeg: 110,
            stanceFootHeight: /(высок|high)/.test(full) ? "high" : /(низк|low)/.test(full) ? "low" : "mid",
            stanceWidth: /(широк|wide)/.test(full) ? "wide" : /(узк|narrow)/.test(full) ? "narrow" : "shoulder",
          },
          { supportType: "machine_guided", loadVector: "lever_arc", peakTorqueZone: "lengthened", implement: "machine" },
        ),
        source: "offline_kinematic",
      };
    }

    if (/(разгибани.*ног|leg ?ext)/.test(full)) {
      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || "Разгибание ног",
        rationale: "Изолированное разгибание колена при фиксированном бедре: единственная кинематика с первичным стимулом на прямую мышцу бедра.",
        confidence: 0.94,
        missingParams: [],
        descriptor: SEED_KINEMATICS_74["leg-extension"],
        source: "offline_kinematic",
      };
    }

    if (/(сгибани.*ног|leg ?curl|бицепс бедра)/.test(full)) {
      const seated = /(сидя|seated)/.test(full);
      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || "Сгибание ног",
        rationale: seated
          ? "Сгибание колена при согнутом бедре (85°) растягивает двусуставные мышцы задней поверхности бедра (stretchScore 3)."
          : "Сгибание колена при разогнутом бедре фокусируется на короткой головке и полусухожильной в укороченной позиции.",
        confidence: 0.9,
        missingParams: [],
        descriptor: seated ? SEED_KINEMATICS_74["legcurl-seated"] : SEED_KINEMATICS_74["legcurl-prone"],
        source: "offline_kinematic",
      };
    }

    if (/(икр|носки|calf|голен)/.test(full)) {
      const seated = /(сидя|seated|согнут)/.test(full);
      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || "Подъём на носки",
        rationale: seated
          ? "Согнутое колено (90°) переводит икроножную в активную недостаточность — работает изолированно камбаловидная (soleus)."
          : "Прямое колено максимально растягивает и нагружает икроножную мышцу (gastrocnemius).",
        confidence: 0.92,
        missingParams: [],
        descriptor: seated ? SEED_KINEMATICS_74["calf-seated"] : SEED_KINEMATICS_74["calf-standing-machine"],
        source: "offline_kinematic",
      };
    }

    if (/(трицепс|разгибан.*рук|pushdown|француз|skull)/.test(full)) {
      const overhead = /(головы|overhead|француз|skull)/.test(full);
      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || "Разгибание на трицепс",
        rationale: overhead
          ? "Плечо согнуто (≥90°): длинная головка трицепса работает в глубоком растяжении (Maeo 2023)."
          : "Плечо у корпуса: акцент на латеральную и медиальную головки трицепса.",
        confidence: 0.9,
        missingParams: [],
        descriptor: overhead ? SEED_KINEMATICS_74["extension-overhead-cable"] : SEED_KINEMATICS_74["extension-v-pushdown"],
        source: "offline_kinematic",
      };
    }

    if (/(бицепс|сгибан.*рук|curl|молот|hammer|скотт|preacher)/.test(full)) {
      const neutral = /(молот|hammer|нейтр|neutral)/.test(full);
      const pronated = /(обратн|reverse|прон|pronat)/.test(full);
      const hasGrip = neutral || pronated || /(супин|supin|штан|ez|скотт|preacher|наклон)/.test(full);
      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || "Сгибание рук",
        rationale: neutral
          ? "Нейтральный хват смещает первичный механический момент на плечевую (brachialis) и плечелучевую мышцы."
          : "Супинированный хват максимизирует плечо рычага двуглавой мышцы плеча.",
        confidence: hasGrip ? 0.88 : 0.74,
        missingParams: hasGrip ? [] : ["forearmRotation"],
        descriptor: makeDescriptor(
          { elbow_flexion: 1.0 },
          {
            shoulderFlexionDeg: /(наклон|incline)/.test(full) ? -30 : /(скотт|preacher)/.test(full) ? 45 : 5,
            forearmRotation: pronated ? "pronated" : neutral ? "neutral" : "supinated",
          },
          {
            supportType: /(скотт|preacher|тренаж|machine)/.test(full) ? "chest_or_back_supported" : "seated_unsupported",
            loadVector: /(блок|кабел|cable)/.test(full) ? "cable_aligned" : "gravity_vertical",
            peakTorqueZone: /(скотт|preacher|наклон|incline)/.test(full) ? "lengthened" : "mid",
            implement: /(блок|кабел|cable)/.test(full) ? "cable" : /(ez|крив)/.test(full) ? "ez_bar" : "dumbbell",
          },
        ),
        source: "offline_kinematic",
      };
    }

    if (/(махи|отведен.*сторон|lateral|средн.*дельт)/.test(full)) {
      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || "Отведение плеча в сторону",
        rationale: "Изолированное отведение плеча во фронтально-лопаточной плоскости нагружает среднюю дельту.",
        confidence: 0.92,
        missingParams: [],
        descriptor: /(блок|кабел|cable|тренаж|machine)/.test(full)
          ? SEED_KINEMATICS_74["lateral-cable-single"]
          : SEED_KINEMATICS_74.lateral,
        source: "offline_kinematic",
      };
    }

    if (/(задн.*дельт|face ?pull|обратн.*развед|rear delt)/.test(full)) {
      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || "Задняя дельта",
        rationale: "Горизонтальное отведение плеча и наружная ротация изолированно грузят заднюю дельту и вращательную манжету.",
        confidence: 0.92,
        missingParams: [],
        descriptor: SEED_KINEMATICS_74["rear-delt-fly"],
        source: "offline_kinematic",
      };
    }

    if (/(станов|deadlift|румын|rdl|хип-?траст|ягодичн|мостик|hip thrust)/.test(full)) {
      const thrust = /(хип-?траст|ягодичн|мостик|thrust|bridge)/.test(full);
      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || (thrust ? "Хип-траст" : "Тазодоминантная тяга"),
        rationale: thrust
          ? "Горизонтальный вектор разгибания бедра с пиком нагрузки в укороченной позиции большой ягодичной."
          : "Разгибание бедра в глубоком сгибании грузит длинную головку бицепса бедра, полуперепончатую и ягодицы.",
        confidence: 0.88,
        missingParams: [],
        descriptor: thrust ? SEED_KINEMATICS_74["barbell-hip-thrust"] : SEED_KINEMATICS_74.rdl,
        source: "offline_kinematic",
      };
    }

    if (/(присед|squat|выпад|lunge|гакк|hack)/.test(full)) {
      const machine = /(гакк|hack|смит|smith|тренаж|machine)/.test(full);
      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || "Приседание",
        rationale: "Синхронное разгибание колена и бедра: первичный стимул на широкие мышцы бедра и большую ягодичную.",
        confidence: 0.86,
        missingParams: [],
        descriptor: machine ? SEED_KINEMATICS_74["hack-squat"] : SEED_KINEMATICS_74.squat,
        source: "offline_kinematic",
      };
    }

    if (/(пресс|скруч|crunch|планк|ролик|ab|кор|дровосек)/.test(full)) {
      return {
        canonicalSlug: slugify(trimmed),
        displayName: trimmed || "Упражнение на кор",
        rationale: "Сгибание/антиразгибание туловища нагружает прямую и косые мышцы живота.",
        confidence: 0.88,
        missingParams: [],
        descriptor: SEED_KINEMATICS_74["cable-crunch"],
        source: "offline_kinematic",
      };
    }

    // Неопознанный общий ввод -> безопасный базовый жим/тяга с низкой уверенностью и вопросами
    return {
      canonicalSlug: slugify(trimmed),
      displayName: trimmed || "Новое упражнение",
      rationale: "Низкая уверенность распознавания — уточни параметры выполнения в 1 клик или опиши траекторию движения.",
      confidence: 0.45,
      missingParams: ["benchAngleDeg", "shoulderPlaneDeg"],
      descriptor: makeDescriptor(
        { shoulder_horizontal_adduction: 0.85, elbow_extension: 0.5 },
        { benchAngleDeg: 0, shoulderPlaneDeg: 45 },
        { supportType: "machine_guided", loadVector: "lever_arc", peakTorqueZone: "mid", implement: "machine" },
      ),
      source: "offline_kinematic",
    };
  }
}
