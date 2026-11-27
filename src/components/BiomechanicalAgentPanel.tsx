import { useMemo, useState } from "react";
import { Camera, Check, Sparkles, ShieldAlert, SlidersHorizontal, Zap } from "lucide-react";
import { ANATOMICAL_MUSCLES, type Muscle } from "../data/muscles";
import { JOINT_ZONES, JOINT_ZONE_LABELS, REGION_META, type HypertrophyRegionId } from "../domain/BiomechanicsCatalogV3";
import { BiomechanicalMuscleAgent } from "../domain/BiomechanicalMuscleAgent";
import { BiomechanicsProfileStore } from "../domain/BiomechanicsProfile";
import { KinematicMuscleSolver } from "../domain/KinematicMuscleSolver";
import type {
  AgentResolveResponse,
  AnatomicalMuscleIdV4,
  ClarifyingChip,
  ExecutionProfileV4,
} from "../domain/KinematicTypesV4";
import { fmt } from "../lib/model";

const MUSCLE_NAME_BY_ID = new Map<string, string>(
  ANATOMICAL_MUSCLES.map((m) => [m.id, m.name]),
);

const QUICK_EXAMPLES = [
  "Hammer Strength Iso-Lateral High Row, узкий нейтральный хват, упор груди",
  "Pendulum Squat, полная амплитуда",
  "Жим ногами, стопы высоко и широко",
  "Тяга в тренажёре Хаммер",
  "Bayesian Cable Curl",
  "JM Press со штангой лёжа",
];

type Props = {
  initialQuery?: string;
  compact?: boolean;
  onApplyToExercise?: (payload: {
    zones: Muscle[];
    rationale: string;
    unilateral: boolean;
    equipment: "gym" | "dumbbells" | "bodyweight";
    loadMode: "total_external" | "per_implement" | "machine_stack" | "bodyweight";
  }) => void;
};

/**
 * Интерактивный UI-модуль ИИ-агента биомеханической разметки мышц «Тяга v4».
 * Поддерживает текстовый ввод, загрузку фото тренажёра, 1-tap уточняющие чипы
 * и мгновенный (<0.1 мс) оффлайн-пересчёт при смене техники ExecutionProfile.
 */
export default function BiomechanicalAgentPanel({
  initialQuery = "",
  compact = false,
  onApplyToExercise,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [brandHint, setBrandHint] = useState("");
  const [imageBase64, setImageBase64] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AgentResolveResponse | null>(null);
  const [applied, setApplied] = useState(false);
  const [execOverride, setExecOverride] = useState<ExecutionProfileV4>({});

  const agent = useMemo(() => new BiomechanicalMuscleAgent(), []);
  const longLevers = useMemo(() => BiomechanicsProfileStore.read().longLevers, []);

  const runResolve = async (textOverride?: string) => {
    const q = (textOverride ?? query).trim();
    if (!q) return;
    if (textOverride !== undefined) setQuery(textOverride);
    setBusy(true);
    setApplied(false);
    setExecOverride({});
    try {
      const res = await agent.resolve({
        queryText: q,
        locale: "ru",
        imageBase64,
        machineBrandHint: brandHint.trim() || undefined,
        longLevers,
      });
      setResult(res);
    } finally {
      setBusy(false);
    }
  };

  const applyChip = (chip: ClarifyingChip) => {
    if (!result) return;
    const refined = agent.applyClarifyingChip(result.descriptor, chip);
    const next: AgentResolveResponse = {
      ...result,
      descriptor: refined.descriptor,
      solved: refined.solved,
      verification: refined.verification,
      confidence: Math.min(0.95, Math.max(result.confidence, 0.86)),
      clarifyingQuestions: result.clarifyingQuestions.filter(
        (q) => !q.chips.some((c) => c.id === chip.id),
      ),
    };
    setResult(next);
    // Асинхронная фиксация персонализации (не блокирует UI)
    if (typeof fetch !== "undefined") {
      void fetch("/api/v4/biomechanics/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalSlug: next.canonicalSlug,
          updatedDescriptor: next.descriptor,
          executionPatch: chip.executionPatch,
        }),
      }).catch(() => {});
    }
  };

  const applyLiveExecution = (patch: Partial<ExecutionProfileV4>) => {
    if (!result) return;
    const merged: ExecutionProfileV4 = { ...execOverride, ...patch };
    setExecOverride(merged);
    const nextDesc = KinematicMuscleSolver.applyExecutionProfile(result.descriptor, patch);
    const refined = agent.applyClarifyingChip(nextDesc, { id: "live-exec", label: "live" });
    setResult({
      ...result,
      descriptor: refined.descriptor,
      solved: refined.solved,
      verification: refined.verification,
    });
  };

  const handlePhoto = (file: File | null) => {
    if (!file) {
      setImageBase64(undefined);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const rawUrl = reader.result;
      // Сжимаем фото до <= 1024px JPEG (~80-150 КБ), чтобы уложиться в лимит 500 КБ Worker
      const img = new Image();
      img.onload = () => {
        const maxSide = 1024;
        const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setImageBase64(rawUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        setImageBase64(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = () => setImageBase64(rawUrl);
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  };

  const muscleLabel = (id: AnatomicalMuscleIdV4) => MUSCLE_NAME_BY_ID.get(id) ?? id;

  const isPress =
    result &&
    ((result.descriptor.actions.shoulder_horizontal_adduction ?? 0) >= 0.4 ||
      (result.descriptor.actions.shoulder_flexion ?? 0) >= 0.65);
  const isRow =
    result &&
    ((result.descriptor.actions.shoulder_extension_sagittal ?? 0) >= 0.4 ||
      (result.descriptor.actions.scapular_retraction ?? 0) >= 0.4);
  const isLegPressOrSquat =
    result &&
    (result.descriptor.actions.knee_extension ?? 0) >= 0.6 &&
    (result.descriptor.actions.hip_extension ?? 0) >= 0.35;

  const handleApply = () => {
    if (!result || !onApplyToExercise) return;
    const zones = Object.entries(result.solved.zones10)
      .filter(([, w]) => w !== undefined && w >= 0.5)
      .map(([z]) => z as Muscle);
    const impl = result.descriptor.profile.implement;
    const equipment: "gym" | "dumbbells" | "bodyweight" =
      impl === "dumbbell" ? "dumbbells" : impl === "bodyweight" ? "bodyweight" : "gym";
    const loadMode: "total_external" | "per_implement" | "machine_stack" | "bodyweight" =
      impl === "dumbbell"
        ? "per_implement"
        : impl === "machine" || impl === "cable"
          ? "machine_stack"
          : impl === "bodyweight"
            ? "bodyweight"
            : "total_external";
    onApplyToExercise({
      zones,
      rationale: result.rationale,
      unilateral: result.descriptor.profile.laterality === "unilateral",
      equipment,
      loadMode,
    });
    setApplied(true);
  };

  return (
    <div className={`bma-panel${compact ? " is-compact" : ""}`}>
      <div className="bma-header">
        <span className="tel-eyebrow-pill">
          <Sparkles size={14} aria-hidden="true" />
          ИИ-агент биомеханики v4
        </span>
        <p className="bma-sub">
          Опиши тренажёр, угол, хват или загрузи фото таблички — агент выведет кинематику и точно определит основные и вспомогательные мышцы.
        </p>
      </div>

      <div className="bma-input-box">
        <div className="bma-row">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runResolve();
              }
            }}
            placeholder="Например: Hammer Strength High Row узкий нейтральный хват…"
            aria-label="Описание тренажёра или упражнения для ИИ-агента"
          />
          <button
            type="button"
            className="button primary bma-run-btn"
            disabled={busy || !query.trim()}
            onClick={() => void runResolve()}
          >
            <Zap size={15} aria-hidden="true" />
            {busy ? "Анализ…" : "Разобрать"}
          </button>
        </div>

        {!compact ? (
          <div className="bma-extras">
            <input
              type="text"
              className="bma-brand-input"
              value={brandHint}
              onChange={(e) => setBrandHint(e.target.value)}
              placeholder="Бренд / модель тренажёра (необязательно: Matrix, Technogym…)"
              aria-label="Бренд или модель тренажёра"
            />
            <label className={`bma-photo-btn${imageBase64 ? " has-photo" : ""}`}>
              <Camera size={14} aria-hidden="true" />
              <span>{imageBase64 ? "Фото загружено" : "Фото тренажёра"}</span>
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => handlePhoto(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        ) : null}

        {!result ? (
          <div className="bma-examples">
            {QUICK_EXAMPLES.slice(0, compact ? 3 : 6).map((ex) => (
              <button
                key={ex}
                type="button"
                className="bma-example-chip"
                onClick={() => void runResolve(ex)}
              >
                {ex}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {result ? (
        <div className="bma-result">
          <div className="bma-result-head">
            <div>
              <strong>{result.displayName}</strong>
              <p className="bma-rationale">{result.rationale}</p>
            </div>
            <div className="bma-badges">
              <span className="bma-meta-pill">
                SFR {fmt(longLevers ? result.solved.sfrLongLevers : result.solved.sfrBase)}
              </span>
              <span className="bma-meta-pill">
                Растяж. {result.solved.stretchScore}/3
              </span>
              <span className="bma-meta-pill is-source">
                {result.source === "llm_v4" || result.source === "vlm_v4"
                  ? "ИИ + Солвер"
                  : result.source === "d1_cache"
                    ? "Кэш D1"
                    : "Кинематика"}
              </span>
            </div>
          </div>

          {/* 1-tap уточняющие вопросы (Active Clarification) */}
          {result.clarifyingQuestions.length > 0 ? (
            <div className="bma-clarify-box">
              {result.clarifyingQuestions.map((q) => (
                <div className="bma-clarify-item" key={q.param}>
                  <span>{q.question}</span>
                  <div className="bma-clarify-chips">
                    {q.chips.map((chip) => (
                      <button
                        key={chip.id}
                        type="button"
                        className="bma-clarify-chip"
                        onClick={() => applyChip(chip)}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Живой пересчёт техники ExecutionProfile (<0.1 мс оффлайн) */}
          {(isPress || isRow || isLegPressOrSquat) ? (
            <div className="bma-live-exec">
              <span className="bma-live-label">
                <SlidersHorizontal size={13} aria-hidden="true" />
                Подкрутить технику подхода (живой пересчёт):
              </span>
              <div className="bma-clarify-chips">
                {isPress ? (
                  <>
                    {[
                      { label: "0° горизонт", angle: 0 },
                      { label: "30° наклон", angle: 30 },
                      { label: "60° плечи", angle: 60 },
                    ].map((opt) => (
                      <button
                        key={opt.angle}
                        type="button"
                        className={`bma-exec-chip${result.descriptor.geometry.benchAngleDeg === opt.angle ? " is-active" : ""}`}
                        onClick={() => applyLiveExecution({ benchAngle: opt.angle })}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </>
                ) : null}
                {isRow ? (
                  <>
                    <button
                      type="button"
                      className={`bma-exec-chip${result.descriptor.geometry.shoulderPlaneDeg <= 30 ? " is-active" : ""}`}
                      onClick={() => applyLiveExecution({ grip: "narrow neutral tucked 15°" })}
                    >
                      Локти 15° к поясу (широчайшие)
                    </button>
                    <button
                      type="button"
                      className={`bma-exec-chip${result.descriptor.geometry.shoulderPlaneDeg >= 60 ? " is-active" : ""}`}
                      onClick={() => applyLiveExecution({ grip: "wide pronated flared 75°" })}
                    >
                      Локти 75° к груди (верх спины)
                    </button>
                  </>
                ) : null}
                {isLegPressOrSquat ? (
                  <>
                    <button
                      type="button"
                      className={`bma-exec-chip${result.descriptor.geometry.stanceFootHeight === "low" ? " is-active" : ""}`}
                      onClick={() => applyLiveExecution({ stance: "low narrow" })}
                    >
                      Стопы низко (квадрицепс)
                    </button>
                    <button
                      type="button"
                      className={`bma-exec-chip${result.descriptor.geometry.stanceFootHeight === "high" ? " is-active" : ""}`}
                      onClick={() => applyLiveExecution({ stance: "high wide" })}
                    >
                      Стопы высоко и широко (ягодицы)
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Точный разбор: Основные / Вспомогательные / Стабилизаторы */}
          <div className="bma-muscles-grid">
            <div className="bma-muscle-group">
              <span className="bma-group-title is-primary">Основные (1,0×)</span>
              <div className="bma-tag-wrap">
                {result.solved.primaryMuscles.map((m) => (
                  <span key={m} className="bma-muscle-tag is-primary">
                    {muscleLabel(m)}
                  </span>
                ))}
              </div>
            </div>

            {result.solved.assistantMuscles.length > 0 ? (
              <div className="bma-muscle-group">
                <span className="bma-group-title is-assistant">Вспомогательные (0,5×)</span>
                <div className="bma-tag-wrap">
                  {result.solved.assistantMuscles.map((m) => (
                    <span key={m} className="bma-muscle-tag is-assistant">
                      {muscleLabel(m)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {result.solved.stabilizerMuscles.length > 0 ? (
              <div className="bma-muscle-group">
                <span className="bma-group-title is-stab">Стабилизаторы</span>
                <div className="bma-tag-wrap">
                  {result.solved.stabilizerMuscles.map((m) => (
                    <span key={m} className="bma-muscle-tag is-stab">
                      {muscleLabel(m)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* Регионы гипертрофии + Суставной профиль */}
          <div className="bma-foot-meta">
            <div className="bma-regions-line">
              {(Object.entries(result.solved.regions) as Array<[HypertrophyRegionId, 1.0 | 0.5]>).map(
                ([reg, w]) => (
                  <span key={reg} className={`bma-reg-chip${w === 1.0 ? " is-primary" : ""}`}>
                    {REGION_META[reg]?.label ?? reg} · {w === 1.0 ? "1,0" : "0,5"}
                  </span>
                ),
              )}
            </div>

            {JOINT_ZONES.some((z) => result.solved.jointRisk[z] >= 2) ? (
              <div className="bma-risk-line">
                <ShieldAlert size={13} aria-hidden="true" />
                <span>
                  Суставная нагрузка:{" "}
                  {JOINT_ZONES.filter((z) => result.solved.jointRisk[z] >= 2)
                    .map((z) => `${JOINT_ZONE_LABELS[z]} (${result.solved.jointRisk[z]}/3)`)
                    .join(" · ")}
                </span>
              </div>
            ) : null}
          </div>

          {onApplyToExercise ? (
            <button
              type="button"
              className="button primary full-width bma-apply-btn"
              onClick={handleApply}
            >
              <Check size={15} aria-hidden="true" />
              {applied ? "Разметка применена к упражнению" : "Применить разметку мышц к упражнению"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
