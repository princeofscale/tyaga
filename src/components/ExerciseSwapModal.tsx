import { useState, useMemo } from "react";
import { ArrowLeftRight, Search, X, Sparkles, ChevronRight, Shield, RotateCcw } from "lucide-react";
import type { Exercise, Workout } from "../lib/types";
import { EXERCISES } from "../lib/catalog";
import { ExerciseAlternativesFinder, type DetectedEquipment } from "../domain/ExerciseAlternatives";
import { ExerciseLabels } from "../domain/ExerciseLabels";
import { BiomechanicsEngine } from "../domain/BiomechanicsEngine";
import { LaidDupPlan } from "../domain/LaidDupPlan";
import {
  AVOID_REASON_LABELS,
  INJURY_DISCLAIMER,
  INJURY_ZONES,
  SWAP_SCOPE_META,
  SubstitutionPolicy,
  type AvoidReason,
  type InjuryZone,
  type SwapScope,
} from "../domain/SubstitutionPolicy";
import Modal from "./Modal";
import { matchesSearch } from "../lib/search";

function isWeightedEligible(e: Exercise): boolean {
  return (
    e.recording.type !== "duration" &&
    e.recording.loadMode !== "bodyweight" &&
    e.recording.loadMode !== "assisted_bodyweight"
  );
}

export default function ExerciseSwapModal({
  currentExercise,
  onSwap,
  onSwapWithScope,
  onClose,
  title = "Заменить упражнение",
  subtitle,
  excludeIds,
  avoidedIds,
  requireWeighted = false,
  showCompatibilityFor,
  showScopePicker = false,
  defaultScope = "today",
  personal,
  originalExercise,
  onReset,
  workouts,
  today,
}: {
  currentExercise: Exercise;
  onSwap: (newExercise: Exercise) => void;
  onSwapWithScope?: (newExercise: Exercise, scope: SwapScope, avoidReason?: AvoidReason) => void;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  excludeIds?: readonly string[];
  avoidedIds?: ReadonlySet<string>;
  requireWeighted?: boolean;
  /** Если передано — на карточках кандидатов показывается класс совместимости DUP (A / B / C). */
  showCompatibilityFor?: Exercise;
  /** 4-уровневый выбор области действия замены (сегодня / волна / программа / не предлагать). */
  showScopePicker?: boolean;
  defaultScope?: SwapScope;
  personal?: Exercise[];
  originalExercise?: Exercise;
  onReset?: () => void;
  /** История тренировок: показывает знакомый рабочий вес на тренажёре/упражнении прямо в списке замен. */
  workouts?: readonly Workout[];
  today?: string;
}) {
  const [search, setSearch] = useState("");
  const [selectedEquip, setSelectedEquip] = useState<"all" | DetectedEquipment>("all");
  const isCurrentAxial = useMemo(
    () => BiomechanicsEngine.loadClass(currentExercise) === "axial_compound",
    [currentExercise],
  );
  const [injuryZone, setInjuryZone] = useState<InjuryZone | null>(null);
  const [scope, setScope] = useState<SwapScope>(defaultScope);
  const [avoidReason, setAvoidReason] = useState<AvoidReason>("pain");

  const pool = useMemo(() => {
    const excluded = new Set(excludeIds ?? []);
    const merged = personal?.length ? [...EXERCISES, ...personal] : EXERCISES;
    const seen = new Set<string>();
    return merged.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      if (e.id === currentExercise.id) return false;
      if (excluded.has(e.id)) return false;
      if (avoidedIds?.has(e.id)) return false;
      if (requireWeighted && !isWeightedEligible(e)) return false;
      return true;
    });
  }, [excludeIds, avoidedIds, personal, currentExercise.id, requireWeighted]);

  const suggested = useMemo(
    () => ExerciseAlternativesFinder.findAlternatives(currentExercise, pool, 22),
    [currentExercise, pool],
  );

  const equipFilters: { id: "all" | DetectedEquipment; label: string }[] = [
    { id: "all", label: "Все" },
    { id: "machine", label: "Тренажёр" },
    { id: "cable", label: "Блок" },
    { id: "dumbbell", label: "Гантели" },
    { id: "barbell", label: "Штанга" },
    ...(requireWeighted ? [] : [{ id: "bodyweight" as const, label: "Свой вес" }]),
  ];

  const filteredSuggested = useMemo(() => {
    return suggested
      .filter((a) => {
        if (selectedEquip !== "all" && !ExerciseLabels.matches(a.exercise, selectedEquip)) return false;
        if (injuryZone && !SubstitutionPolicy.isZoneFriendly(a.exercise, injuryZone)) return false;
        return true;
      })
      .slice(0, 12);
  }, [suggested, selectedEquip, injuryZone]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    return pool
      .filter(
        (e) =>
          ExerciseLabels.matches(e, selectedEquip) &&
          (!injuryZone || SubstitutionPolicy.isZoneFriendly(e, injuryZone)) &&
          matchesSearch(`${e.name} ${e.nameEn} ${(e.aliases ?? []).join(" ")}`, search),
      )
      .slice(0, 14);
  }, [search, pool, selectedEquip, injuryZone]);

  const historyLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (!workouts?.length) return map;
    const ids = search.trim()
      ? searchResults.map((e) => e.id)
      : filteredSuggested.map((a) => a.exercise.id);
    for (const id of ids) {
      const last = LaidDupPlan.lastWorkingSetSummary(workouts, id, today);
      if (last) map.set(id, last.label);
    }
    return map;
  }, [workouts, today, search, searchResults, filteredSuggested]);

  function commitSwap(exercise: Exercise) {
    if (showScopePicker && onSwapWithScope) {
      onSwapWithScope(exercise, scope, scope === "avoid" ? avoidReason : undefined);
    } else {
      onSwap(exercise);
    }
    onClose();
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="exercise-swap-dialog-v2">
        {/* Compact current exercise strip */}
        <div className="swap-current-strip">
          <div className="swap-current-copy">
            <span className="swap-banner-tag">Меняем</span>
            <strong className="swap-ex-name">{currentExercise.name}</strong>
            <span className="swap-ex-meta">
              {ExerciseLabels.meta(currentExercise)}
              {subtitle ? ` · ${subtitle}` : ""}
            </span>
          </div>
          {originalExercise && originalExercise.id !== currentExercise.id && onReset ? (
            <button
              type="button"
              className="swap-reset-btn"
              onClick={() => {
                onReset();
                onClose();
              }}
            >
              <RotateCcw size={13} aria-hidden="true" />
              <span>Вернуть: {originalExercise.name}</span>
            </button>
          ) : null}
        </div>

        {/* Search Bar right at top for immediate typing ("бабочка", "пек-дек", etc.) */}
        <div className="swap-search-field">
          <Search size={16} className="search-icon" aria-hidden="true" />
          <input
            type="search"
            placeholder="Поиск по каталогу (например, бабочка, пек-дек, жим ногами)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => setSearch("")}
              aria-label="Очистить"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Equipment Filter Chips */}
        <div className="swap-equip-filters" role="group" aria-label="Фильтр по снаряду">
          {equipFilters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`swap-filter-pill ${selectedEquip === f.id ? "active" : ""}`}
              aria-pressed={selectedEquip === f.id}
              onClick={() => setSelectedEquip(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* 4-Level Swap Scope Picker (when swapping in an active workout) */}
        {showScopePicker ? (
          <div className="swap-scope-picker" role="group" aria-label="Область действия замены">
            <span className="swap-section-sub">Как применить замену</span>
            <div className="swap-scope-grid">
              {(["today", "block", "program", "avoid"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scope === s}
                  className={`swap-scope-btn${scope === s ? " active" : ""}`}
                  onClick={() => setScope(s)}
                >
                  <b>{SWAP_SCOPE_META[s].label}</b>
                  <small>{SWAP_SCOPE_META[s].sub}</small>
                </button>
              ))}
            </div>
            {scope === "avoid" ? (
              <div className="swap-avoid-reasons" role="group" aria-label="Причина исключения">
                {(["pain", "equipment", "dislike", "other"] as const).map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    aria-pressed={avoidReason === reason}
                    className={`swap-filter-pill${avoidReason === reason ? " active" : ""}`}
                    onClick={() => setAvoidReason(reason)}
                  >
                    {AVOID_REASON_LABELS[reason]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Collapsible Injury / Discomfort Zone Filters */}
        <details className="laid-disclosure swap-injury-disclosure" open={!!injuryZone}>
          <summary>
            <span className="swap-injury-label">
              <Shield size={14} aria-hidden="true" />
              <span>Беречь зону (при дискомфорте / травме)</span>
            </span>
            {injuryZone ? (
              <span className="laid-custom-badge is-filled">
                {INJURY_ZONES.find((z) => z.id === injuryZone)?.short}
              </span>
            ) : null}
          </summary>
          <div className="swap-injury-body">
            <div className="swap-injury-bar" role="group" aria-label="Щадящий фильтр по зоне">
              {INJURY_ZONES.map((z) => {
                const active = injuryZone === z.id;
                return (
                  <button
                    key={z.id}
                    type="button"
                    className={`swap-filter-pill swap-filter-spine${active ? " active" : ""}`}
                    aria-pressed={active}
                    title={z.hint}
                    onClick={() => setInjuryZone(active ? null : z.id)}
                  >
                    {z.short}
                  </button>
                );
              })}
            </div>
            {injuryZone ? <p className="tiny muted swap-disclaimer">{INJURY_DISCLAIMER}</p> : null}
          </div>
        </details>

        {/* Alternatives List */}
        {search.trim() ? (
          <div className="swap-results-section">
            <div className="swap-section-headline">
              <span>Результаты поиска ({searchResults.length})</span>
            </div>
            {searchResults.length === 0 ? (
              <p className="tiny muted empty-swap-msg">Ничего не найдено</p>
            ) : (
              <div className="swap-cards-grid">
                {searchResults.map((e) => {
                  const lowAxial = isCurrentAxial && BiomechanicsEngine.loadClass(e) !== "axial_compound";
                  const compat = showCompatibilityFor
                    ? SubstitutionPolicy.classify(showCompatibilityFor, e, { hasOwnHistory: historyLabels.has(e.id) })
                    : null;
                  const lastLabel = historyLabels.get(e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className="swap-card-btn"
                      onClick={() => commitSwap(e)}
                    >
                      <div className="swap-card-body">
                        <div className="swap-card-top">
                          <b className="swap-card-title">{e.name}</b>
                          <span className="swap-equip-badge">{ExerciseLabels.equipment(e)}</span>
                          {compat ? <span className={`swap-class-badge class-${compat.subClass.toLowerCase()}`}>{compat.badge}</span> : null}
                        </div>
                        <span className="swap-card-sub">
                          {ExerciseLabels.muscles(e.primary)}
                          {lowAxial ? " · без осевой" : ""}
                          {lastLabel ? ` · прошлый: ${lastLabel}` : ""}
                        </span>
                      </div>
                      <div className="swap-card-action">
                        <ChevronRight size={18} aria-hidden="true" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="swap-results-section">
            <div className="swap-section-headline">
              <Sparkles size={15} className="text-accent" aria-hidden="true" />
              <span>Похожие по мышцам ({filteredSuggested.length})</span>
            </div>
            {filteredSuggested.length === 0 ? (
              <p className="tiny muted empty-swap-msg">Нет подходящих вариантов для выбранного снаряда — попробуй поиск выше</p>
            ) : (
              <div className="swap-cards-grid">
                {filteredSuggested.map((alt) => {
                  const lowAxial = isCurrentAxial && BiomechanicsEngine.loadClass(alt.exercise) !== "axial_compound";
                  const compat = showCompatibilityFor
                    ? SubstitutionPolicy.classify(showCompatibilityFor, alt.exercise, {
                        hasOwnHistory: historyLabels.has(alt.exercise.id),
                      })
                    : null;
                  const lastLabel = historyLabels.get(alt.exercise.id);
                  return (
                    <button
                      key={alt.exercise.id}
                      type="button"
                      className="swap-card-btn smart"
                      onClick={() => commitSwap(alt.exercise)}
                    >
                      <div className="swap-card-body">
                        <div className="swap-card-top">
                          <b className="swap-card-title">{alt.exercise.name}</b>
                          <span className="swap-equip-badge">{ExerciseLabels.equipment(alt.exercise)}</span>
                          {compat ? <span className={`swap-class-badge class-${compat.subClass.toLowerCase()}`}>{compat.badge}</span> : null}
                        </div>
                        <div className="swap-reason-pill">
                          <span className="reason-text">
                            {alt.reason}
                            {lowAxial ? " · без осевой" : ""}
                            {lastLabel ? ` · прошлый: ${lastLabel}` : ""}
                          </span>
                        </div>
                      </div>
                      <div className="swap-card-action">
                        <ArrowLeftRight size={16} className="text-accent" aria-hidden="true" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
