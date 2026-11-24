import { useState, useMemo } from "react";
import { ArrowLeftRight, Search, X, Sparkles, ChevronRight, Shield, RotateCcw } from "lucide-react";
import type { Exercise } from "../lib/types";
import { EXERCISES } from "../lib/catalog";
import { ExerciseAlternativesFinder, type DetectedEquipment } from "../domain/ExerciseAlternatives";
import { ExerciseLabels } from "../domain/ExerciseLabels";
import { BiomechanicsEngine } from "../domain/BiomechanicsEngine";
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
    { id: "all", label: "Все снаряды" },
    { id: "dumbbell", label: "Гантели" },
    { id: "barbell", label: "Штанга" },
    { id: "cable", label: "Блок / Кроссовер" },
    { id: "machine", label: "Тренажёр" },
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
        {subtitle ? <p className="swap-scope-note">{subtitle}</p> : null}

        {/* Comparison Header Card */}
        <div className="swap-comparison-banner">
          <div className="swap-banner-col current">
            <span className="swap-banner-tag">Текущее упражнение</span>
            <strong className="swap-ex-name">{currentExercise.name}</strong>
            <span className="swap-ex-meta">
              {ExerciseLabels.meta(currentExercise)}
            </span>
          </div>

          <div className="swap-banner-arrow">
            <ArrowLeftRight size={22} className="text-accent" />
          </div>

          <div className="swap-banner-col target">
            <span className="swap-banner-tag accent">Выбери замену</span>
            <span className="swap-banner-instruction">
              {requireWeighted
                ? "С весом отягощения · несовместимые со 95 % синглом перейдут в калибровку/RIR"
                : "С теми же целевыми пучками мышц"}
            </span>
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

        {/* Injury / Discomfort Zone Filters */}
        <div className="swap-injury-bar" role="group" aria-label="Щадящий фильтр по зоне">
          <span className="swap-injury-label">
            <Shield size={13} aria-hidden="true" />
            Беречь зону:
          </span>
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

        {/* Equipment Filter Chips */}
        <div className="swap-equip-filters">
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

        {/* Search Bar */}
        <div className="swap-search-field">
          <Search size={16} className="search-icon" />
          <input
            type="search"
            placeholder="Поиск по всему каталогу упражнений..."
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
              <X size={14} />
            </button>
          )}
        </div>

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
                    ? SubstitutionPolicy.classify(showCompatibilityFor, e, { hasOwnHistory: false })
                    : null;
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
                        </span>
                      </div>
                      <div className="swap-card-action">
                        <ChevronRight size={18} />
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
              <Sparkles size={15} className="text-accent" />
              <span>Анатомические альтернативы с тем же фокусом ({filteredSuggested.length})</span>
            </div>
            {filteredSuggested.length === 0 ? (
              <p className="tiny muted empty-swap-msg">Нет подходящих альтернатив для выбранного фильтра — попробуй поиск выше</p>
            ) : (
              <div className="swap-cards-grid">
                {filteredSuggested.map((alt) => {
                  const lowAxial = isCurrentAxial && BiomechanicsEngine.loadClass(alt.exercise) !== "axial_compound";
                  const compat = showCompatibilityFor
                    ? SubstitutionPolicy.classify(showCompatibilityFor, alt.exercise, { hasOwnHistory: false })
                    : null;
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
                          </span>
                        </div>
                      </div>
                      <div className="swap-card-action">
                        <ArrowLeftRight size={16} className="text-accent" />
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
