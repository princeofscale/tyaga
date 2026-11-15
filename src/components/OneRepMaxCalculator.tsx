import { useState, useMemo } from "react";
import { TrendingUp, Info, Minus, Plus, Award } from "lucide-react";
import { OneRepMaxFormulas } from "../domain/OneRepMaxFormulas";
import { DecimalInput } from "../domain/DecimalInput";
import { NumberField } from "./NumberField";

export default function OneRepMaxCalculator({
  initialWeight = 80,
  initialReps = 8,
  onClose,
}: {
  initialWeight?: number;
  initialReps?: number;
  onClose?: () => void;
}) {
  const [weight, setWeight] = useState(initialWeight || 80);
  const [reps, setReps] = useState(initialReps || 8);

  // Основная формула приложения — Эпли (как в «Прогрессе» и «Зале рекордов»); остальные — для сравнения.
  const formulas = useMemo(() => {
    if (!weight || !reps) return null;
    return {
      epley: OneRepMaxFormulas.round(OneRepMaxFormulas.epley(weight, reps)),
      brzycki: OneRepMaxFormulas.round(OneRepMaxFormulas.brzycki(weight, reps)),
      lombardi: OneRepMaxFormulas.round(OneRepMaxFormulas.lombardi(weight, reps)),
    };
  }, [weight, reps]);

  const oneRepMax = formulas?.epley ?? weight;

  // Percentage Training Zones
  const percentages = useMemo(() => {
    const list = [
      { pct: 100, label: "100%", reps: "1 повт.", focus: "Пиковая сила (1RM)", category: "max" },
      { pct: 95, label: "95%", reps: "2 повт.", focus: "Субмаксимальная сила", category: "strength" },
      { pct: 90, label: "90%", reps: "3–4 повт.", focus: "Тяжёлый силовой объём", category: "strength" },
      { pct: 85, label: "85%", reps: "5–6 повт.", focus: "Сила + плотность миофибрилл", category: "hypertrophy" },
      { pct: 80, label: "80%", reps: "7–8 повт.", focus: "Золотой стандарт гипертрофии", category: "hypertrophy" },
      { pct: 75, label: "75%", reps: "9–10 повт.", focus: "Объёмная гипертрофия", category: "hypertrophy" },
      { pct: 70, label: "70%", reps: "11–12 повт.", focus: "Многоповторная гипертрофия", category: "endurance" },
      { pct: 65, label: "65%", reps: "15 повт.", focus: "Силовая выносливость", category: "endurance" },
      { pct: 60, label: "60%", reps: "18+ повт.", focus: "Разминка / Капилляризация", category: "warmup" },
    ];
    return list.map((item) => ({
      ...item,
      load: Math.round(((oneRepMax * item.pct) / 100) * 4) / 4,
    }));
  }, [oneRepMax]);

  const adjustWeight = (delta: number) => {
    setWeight((prev) => Math.min(600, Math.max(1, Math.round((prev + delta) * 10) / 10)));
  };

  const adjustReps = (delta: number) => {
    setReps((prev) => Math.max(1, Math.min(30, prev + delta)));
  };

  return (
    <div className="onerep-calculator-v2">
      {/* Input Parameters Controls */}
      <div className="orm-inputs-deck">
        <div className="orm-input-card">
          <span className="orm-card-label">Рабочий вес</span>
          <div className="orm-number-stepper">
            <button
              type="button"
              className="orm-step-btn"
              onClick={() => adjustWeight(-5)}
              aria-label="Минус 5 кг"
            >
              -5
            </button>
            <button
              type="button"
              className="orm-step-btn"
              onClick={() => adjustWeight(-2.5)}
              aria-label="Минус 2,5 кг"
            >
              <Minus size={15} />
            </button>
            <div className="orm-val-display">
              <NumberField
                label="Рабочий вес, кг"
                value={weight}
                onValue={setWeight}
                bounds={{ min: 1, max: 600, unit: "кг" }}
              />
              <span className="orm-unit">кг</span>
            </div>
            <button
              type="button"
              className="orm-step-btn"
              onClick={() => adjustWeight(2.5)}
              aria-label="Плюс 2,5 кг"
            >
              <Plus size={15} />
            </button>
            <button
              type="button"
              className="orm-step-btn"
              onClick={() => adjustWeight(5)}
              aria-label="Плюс 5 кг"
            >
              +5
            </button>
          </div>
        </div>

        <div className="orm-input-card">
          <span className="orm-card-label">Повторений до отказа</span>
          <div className="orm-number-stepper">
            <button
              type="button"
              className="orm-step-btn"
              onClick={() => adjustReps(-1)}
              aria-label="Минус 1 повтор"
            >
              <Minus size={15} />
            </button>
            <div className="orm-val-display">
              <NumberField
                label="Повторений до отказа"
                value={reps}
                onValue={(n) => setReps(Math.round(n))}
                bounds={{ min: 1, max: 30 }}
                decimals={0}
              />
              <span className="orm-unit">повт.</span>
            </div>
            <button
              type="button"
              className="orm-step-btn"
              onClick={() => adjustReps(1)}
              aria-label="Плюс 1 повтор"
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="orm-rep-presets">
            {[1, 3, 5, 8, 10, 12].map((r) => (
              <button
                key={r}
                type="button"
                className={`orm-preset-chip ${reps === r ? "active" : ""}`}
                onClick={() => setReps(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Calculated Result Hero Card */}
      <div className="orm-hero-badge-card">
        <div className="orm-hero-glow" />
        <div className="orm-hero-content">
          <div className="orm-hero-top">
            <Award size={18} className="text-accent" />
            <span className="orm-hero-title">РАСЧЁТНЫЙ ОДНОПОВТОРНЫЙ МАКСИМУМ</span>
          </div>
          <div className="orm-hero-metric">
            <span className="orm-hero-digits">{DecimalInput.format(oneRepMax, 1)}</span>
            <span className="orm-hero-kg">кг</span>
          </div>
          <div className="orm-formulas-pills">
            <span className="formula-pill formula-primary">Epley (основная): <b>{DecimalInput.format(formulas?.epley ?? 0, 1)} кг</b></span>
            <span className="formula-pill">Brzycki: <b>{DecimalInput.format(formulas?.brzycki ?? 0, 1)} кг</b></span>
            <span className="formula-pill">Lombardi: <b>{DecimalInput.format(formulas?.lombardi ?? 0, 1)} кг</b></span>
          </div>
          <p className="orm-formula-note">
            Основная формула в приложении — Эпли: по ней считаются «Прогресс» и «Зал рекордов». Brzycki и Lombardi — для сравнения.
          </p>
        </div>
      </div>

      {/* Percentage Matrix */}
      <div className="orm-matrix-section">
        <div className="orm-matrix-header">
          <TrendingUp size={16} className="text-accent" />
          <b>Тренировочные зоны и расчёт веса штанги</b>
        </div>
        <div className="orm-zones-grid">
          {percentages.map((p) => (
            <div key={p.pct} className={`orm-zone-card ${p.category}`}>
              <div className="zone-pct-col">
                <span className="zone-pct-badge">{p.label}</span>
                <span className="zone-reps-target">{p.reps}</span>
              </div>
              <div className="zone-load-col">
                <span className="zone-load-val">{DecimalInput.format(p.load)}</span>
                <span className="zone-load-unit">кг</span>
              </div>
              <div className="zone-desc-col">
                <span className="zone-focus-label">{p.focus}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="orm-footer-note">
        <Info size={15} className="text-muted" />
        <p>
          Наибольшая математическая точность достигается в диапазоне 1–10 повторений. Если подход выполнен с RIR &gt; 0, прибавь оставшиеся повторы к выполненным.
        </p>
      </div>
    </div>
  );
}
