import { useState, useMemo } from "react";
import { ArrowLeftRight, Search, X, Check, Dumbbell, Sparkles, Filter, ChevronRight } from "lucide-react";
import type { Exercise } from "../lib/types";
import { EXERCISES } from "../lib/catalog";
import { ExerciseAlternativesFinder, type ExerciseAlternative } from "../domain/ExerciseAlternatives";
import Modal from "./Modal";
import { matchesSearch } from "../lib/search";

export default function ExerciseSwapModal({
  currentExercise,
  onSwap,
  onClose,
}: {
  currentExercise: Exercise;
  onSwap: (newExercise: Exercise) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedEquip, setSelectedEquip] = useState<string>("all");

  const suggested = useMemo(
    () => ExerciseAlternativesFinder.findAlternatives(currentExercise, EXERCISES, 10),
    [currentExercise],
  );

  const equipFilters = [
    { id: "all", label: "Все снаряды" },
    { id: "dumbbell", label: "Гантели" },
    { id: "barbell", label: "Штанга" },
    { id: "cable", label: "Блок / Кроссовер" },
    { id: "machine", label: "Тренажёр" },
    { id: "bodyweight", label: "Свой вес" },
  ];

  const filteredSuggested = useMemo(() => {
    if (selectedEquip === "all") return suggested;
    return suggested.filter((a) => a.exercise.equipment === selectedEquip);
  }, [suggested, selectedEquip]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    return EXERCISES.filter(
      (e) =>
        e.id !== currentExercise.id &&
        (selectedEquip === "all" || e.equipment === selectedEquip) &&
        matchesSearch(`${e.name} ${e.nameEn} ${(e.aliases ?? []).join(" ")}`, search),
    ).slice(0, 12);
  }, [search, currentExercise.id, selectedEquip]);

  return (
    <Modal title="Заменить упражнение" onClose={onClose} wide>
      <div className="exercise-swap-dialog-v2">
        {/* Comparison Header Card */}
        <div className="swap-comparison-banner">
          <div className="swap-banner-col current">
            <span className="swap-banner-tag">Текущее упражнение</span>
            <strong className="swap-ex-name">{currentExercise.name}</strong>
            <span className="swap-ex-meta">
              {currentExercise.equipment} · {currentExercise.primary.join(", ")}
            </span>
          </div>

          <div className="swap-banner-arrow">
            <ArrowLeftRight size={22} className="text-accent" />
          </div>

          <div className="swap-banner-col target">
            <span className="swap-banner-tag accent">Выбери замену</span>
            <span className="swap-banner-instruction">
              С теми же целевыми пучками мышц
            </span>
          </div>
        </div>

        {/* Equipment Filter Chips */}
        <div className="swap-equip-filters">
          {equipFilters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`swap-filter-pill ${selectedEquip === f.id ? "active" : ""}`}
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
                {searchResults.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="swap-card-btn"
                    onClick={() => {
                      onSwap(e);
                      onClose();
                    }}
                  >
                    <div className="swap-card-body">
                      <div className="swap-card-top">
                        <b className="swap-card-title">{e.name}</b>
                        <span className="swap-equip-badge">{e.equipment}</span>
                      </div>
                      <span className="swap-card-sub">
                        {e.primary.join(", ")}
                      </span>
                    </div>
                    <div className="swap-card-action">
                      <ChevronRight size={18} />
                    </div>
                  </button>
                ))}
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
              <p className="tiny muted empty-swap-msg">Нет подходящих альтернатив для выбранного инвентаря</p>
            ) : (
              <div className="swap-cards-grid">
                {filteredSuggested.map((alt) => (
                  <button
                    key={alt.exercise.id}
                    type="button"
                    className="swap-card-btn smart"
                    onClick={() => {
                      onSwap(alt.exercise);
                      onClose();
                    }}
                  >
                    <div className="swap-card-body">
                      <div className="swap-card-top">
                        <b className="swap-card-title">{alt.exercise.name}</b>
                        <span className="swap-equip-badge">{alt.equipmentLabel}</span>
                      </div>
                      <div className="swap-reason-pill">
                        <span className="reason-text">{alt.reason}</span>
                      </div>
                    </div>
                    <div className="swap-card-action">
                      <ArrowLeftRight size={16} className="text-accent" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
