import { useState, useMemo, type FormEvent } from "react";
import {
  Scale,
  TrendingDown,
  TrendingUp,
  Minus,
  Target,
  Plus,
  Trash2,
  Calendar,
  Sparkles,
  Info,
} from "lucide-react";
import {
  BodyweightTracker,
  type BodyweightEntry,
  type BodyweightTrendPoint,
} from "../domain/BodyweightTracker";

export function BodyweightModal({
  accountId,
  onClose,
}: {
  accountId: string;
  onClose: () => void;
}) {
  const tracker = useMemo(() => new BodyweightTracker(accountId), [accountId]);
  const [entries, setEntries] = useState<BodyweightEntry[]>(() =>
    tracker.getEntries()
  );
  const [goal, setGoal] = useState(() => tracker.getGoal());

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const latestWeight = entries.length ? entries[entries.length - 1].weightKg : 75.0;
  const [inputWeight, setInputWeight] = useState(latestWeight.toString());
  const [inputDate, setInputDate] = useState(todayStr);
  const [inputNote, setInputNote] = useState("");
  const [goalInput, setGoalInput] = useState(
    goal.targetWeightKg ? goal.targetWeightKg.toString() : ""
  );
  const [editingGoal, setEditingGoal] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<BodyweightTrendPoint | null>(null);

  const stats = useMemo(() => tracker.getStats(), [entries, tracker]);
  const weeklyRate = useMemo(() => tracker.getWeeklyRate(), [entries, tracker]);
  const trend = useMemo(() => tracker.getTrend(), [entries, tracker]);

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    const w = parseFloat(inputWeight);
    if (isNaN(w) || w <= 20 || w >= 500) return;

    tracker.addEntry(w, inputDate, inputNote);
    const updated = tracker.getEntries();
    setEntries(updated);
    setInputNote("");
  };

  const handleRemove = (id: string) => {
    tracker.removeEntry(id);
    setEntries(tracker.getEntries());
  };

  const handleStep = (delta: number) => {
    const cur = parseFloat(inputWeight) || 75.0;
    const next = Math.round((cur + delta) * 10) / 10;
    if (next >= 20 && next <= 500) {
      setInputWeight(next.toFixed(1));
    }
  };

  const handleSaveGoal = () => {
    const val = parseFloat(goalInput);
    if (!isNaN(val) && val >= 20 && val <= 500) {
      tracker.setGoal(val);
      setGoal(tracker.getGoal());
    } else if (!goalInput.trim()) {
      tracker.setGoal(null);
      setGoal({ targetWeightKg: null, startWeightKg: null });
    }
    setEditingGoal(false);
  };

  // SVG Chart Dimensions & Scaling
  const chartHeight = 220;
  const chartWidth = 520;
  const padX = 40;
  const padY = 30;

  const minVal = useMemo(() => {
    if (!trend.length) return 60;
    const rawMin = Math.min(...trend.map((p) => p.weightKg));
    const goalVal = goal.targetWeightKg || rawMin;
    return Math.floor(Math.min(rawMin, goalVal) - 1);
  }, [trend, goal.targetWeightKg]);

  const maxVal = useMemo(() => {
    if (!trend.length) return 100;
    const rawMax = Math.max(...trend.map((p) => p.weightKg));
    const goalVal = goal.targetWeightKg || rawMax;
    return Math.ceil(Math.max(rawMax, goalVal) + 1);
  }, [trend, goal.targetWeightKg]);

  const valRange = Math.max(1, maxVal - minVal);

  const getX = (idx: number) => {
    if (trend.length <= 1) return chartWidth / 2;
    return padX + (idx / (trend.length - 1)) * (chartWidth - padX * 2);
  };

  const getY = (val: number) => {
    const normalized = (val - minVal) / valRange;
    return chartHeight - padY - normalized * (chartHeight - padY * 2);
  };

  // Generate SVG path for EMA curve
  const emaPath = useMemo(() => {
    if (trend.length < 2) return "";
    return trend.reduce((acc, p, idx) => {
      const x = getX(idx);
      const y = getY(p.emaKg);
      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
    }, "");
  }, [trend, minVal, maxVal]);

  const goalY = goal.targetWeightKg ? getY(goal.targetWeightKg) : null;

  return (
    <div className="bodyweight-modal-content">
      {/* Top Hero Stats */}
      {stats && (
        <div className="bw-hero-grid">
          <div className="bw-hero-card current">
            <span className="bw-card-label">Текущий вес</span>
            <div className="bw-card-val-row">
              <b className="bw-card-val">{stats.currentKg}</b>
              <span className="bw-unit">кг</span>
            </div>
            <span
              className={`bw-diff-pill ${
                stats.totalChangeKg < 0
                  ? "loss"
                  : stats.totalChangeKg > 0
                    ? "gain"
                    : "flat"
              }`}
            >
              {stats.totalChangeKg < 0 ? (
                <TrendingDown size={13} />
              ) : stats.totalChangeKg > 0 ? (
                <TrendingUp size={13} />
              ) : (
                <Minus size={13} />
              )}
              {stats.totalChangeKg > 0 ? `+${stats.totalChangeKg}` : stats.totalChangeKg} кг
            </span>
          </div>

          <div className="bw-hero-card">
            <span className="bw-card-label">Темп в неделю</span>
            <div className="bw-card-val-row">
              <b className="bw-card-val">
                {weeklyRate.rateKgPerWeek > 0
                  ? `+${weeklyRate.rateKgPerWeek}`
                  : weeklyRate.rateKgPerWeek}
              </b>
              <span className="bw-unit">кг/нед</span>
            </div>
            <span className="bw-sublabel">{weeklyRate.label}</span>
          </div>

          <div className="bw-hero-card">
            <span className="bw-card-label">Диапазон</span>
            <div className="bw-card-val-row">
              <b className="bw-card-val">
                {stats.minKg} – {stats.maxKg}
              </b>
              <span className="bw-unit">кг</span>
            </div>
            <span className="bw-sublabel">За {stats.count} замеров</span>
          </div>
        </div>
      )}

      {/* Target Goal Banner */}
      <div className="bw-goal-banner">
        <div className="bw-goal-left">
          <Target size={18} className="text-accent" />
          {editingGoal ? (
            <div className="bw-goal-edit-wrap">
              <input
                type="number"
                step="0.1"
                min="30"
                max="300"
                placeholder="Например: 75.0"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="button primary mini-btn"
                onClick={handleSaveGoal}
              >
                ОК
              </button>
              <button
                type="button"
                className="button secondary mini-btn"
                onClick={() => setEditingGoal(false)}
              >
                Отмена
              </button>
            </div>
          ) : (
            <div>
              <span className="bw-goal-title">
                {goal.targetWeightKg
                  ? `Цель: ${goal.targetWeightKg} кг`
                  : "Целевой вес не установлен"}
              </span>
              {goal.targetWeightKg && stats && (
                <p className="bw-goal-desc">
                  {stats.currentKg > goal.targetWeightKg
                    ? `Осталось сбросить ${(stats.currentKg - goal.targetWeightKg).toFixed(1)} кг`
                    : stats.currentKg < goal.targetWeightKg
                      ? `Осталось набрать ${(goal.targetWeightKg - stats.currentKg).toFixed(1)} кг`
                      : "Цель достигнута! 🏆"}
                </p>
              )}
            </div>
          )}
        </div>
        {!editingGoal && (
          <button
            type="button"
            className="text-button edit-goal-btn"
            onClick={() => {
              setGoalInput(goal.targetWeightKg ? goal.targetWeightKg.toString() : "");
              setEditingGoal(true);
            }}
          >
            {goal.targetWeightKg ? "Изменить цель" : "Задать цель"}
          </button>
        )}
      </div>

      {/* Interactive Trend Chart */}
      <div className="bw-chart-box">
        <div className="bw-chart-legend">
          <div className="legend-item">
            <span className="legend-dot raw" />
            <span>Замеры веса</span>
          </div>
          <div className="legend-item">
            <span className="legend-line ema" />
            <span>Тренд (EMA 7 дней)</span>
          </div>
          {goal.targetWeightKg && (
            <div className="legend-item">
              <span className="legend-line goal" />
              <span>Цель ({goal.targetWeightKg} кг)</span>
            </div>
          )}
        </div>

        {trend.length === 0 ? (
          <div className="bw-chart-empty">Нет данных о весе</div>
        ) : (
          <div className="bw-svg-wrapper">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="bw-svg-chart"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Horizontal grid lines */}
              {[minVal, Math.round((minVal + maxVal) / 2), maxVal].map((val) => {
                const y = getY(val);
                return (
                  <g key={`grid-${val}`}>
                    <line
                      x1={padX}
                      y1={y}
                      x2={chartWidth - padX}
                      y2={y}
                      stroke="rgba(255,255,255,0.07)"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={padX - 8}
                      y={y + 4}
                      textAnchor="end"
                      fill="var(--muted)"
                      fontSize={10}
                      fontFamily="monospace"
                    >
                      {val}
                    </text>
                  </g>
                );
              })}

              {/* Goal line */}
              {goalY !== null && (
                <line
                  x1={padX}
                  y1={goalY}
                  x2={chartWidth - padX}
                  y2={goalY}
                  stroke="#ffd15c"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
              )}

              {/* EMA Trend Line */}
              {emaPath && (
                <path
                  d={emaPath}
                  fill="none"
                  stroke="#cafa64"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
              )}

              {/* Raw weigh-in dots */}
              {trend.map((p, idx) => {
                const cx = getX(idx);
                const cy = getY(p.weightKg);
                const isHovered = hoveredPoint?.date === p.date;

                return (
                  <g
                    key={`dot-${p.date}-${idx}`}
                    className="bw-node"
                    onMouseEnter={() => setHoveredPoint(p)}
                    onClick={() => setHoveredPoint(p)}
                  >
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isHovered ? 6 : 4}
                      fill={isHovered ? "#ffffff" : "var(--accent)"}
                      stroke="var(--bg)"
                      strokeWidth={1.5}
                      style={{ cursor: "pointer", transition: "all 0.15s" }}
                    />
                  </g>
                );
              })}
            </svg>

            {/* Hover Tooltip */}
            {hoveredPoint && (
              <div className="bw-tooltip">
                <span className="bw-tooltip-date">{hoveredPoint.date}</span>
                <span className="bw-tooltip-val">
                  Вес: <b>{hoveredPoint.weightKg} кг</b>
                </span>
                <span className="bw-tooltip-ema">
                  Тренд: {hoveredPoint.emaKg} кг
                </span>
                {hoveredPoint.note && (
                  <span className="bw-tooltip-note">«{hoveredPoint.note}»</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Add Weigh-in Form */}
      <form onSubmit={handleAdd} className="bw-add-form">
        <h4 className="bw-form-title">Записать вес</h4>

        <div className="bw-form-row">
          <div className="bw-weight-input-box">
            <input
              type="number"
              step="0.1"
              min="20"
              max="500"
              value={inputWeight}
              onChange={(e) => setInputWeight(e.target.value)}
              className="bw-weight-main-input"
              required
            />
            <span className="bw-kg-label">кг</span>
          </div>

          <div className="bw-steppers">
            <button
              type="button"
              className="bw-step-btn"
              onClick={() => handleStep(-0.5)}
            >
              −0.5
            </button>
            <button
              type="button"
              className="bw-step-btn"
              onClick={() => handleStep(-0.1)}
            >
              −0.1
            </button>
            <button
              type="button"
              className="bw-step-btn"
              onClick={() => handleStep(+0.1)}
            >
              +0.1
            </button>
            <button
              type="button"
              className="bw-step-btn"
              onClick={() => handleStep(+0.5)}
            >
              +0.5
            </button>
          </div>
        </div>

        <div className="bw-secondary-inputs">
          <div className="bw-date-wrap">
            <Calendar size={15} />
            <input
              type="date"
              value={inputDate}
              onChange={(e) => setInputDate(e.target.value)}
              max={todayStr}
              required
            />
          </div>

          <input
            type="text"
            placeholder="Заметка (натощак, после зала)..."
            value={inputNote}
            onChange={(e) => setInputNote(e.target.value)}
            maxLength={60}
            className="bw-note-input"
          />

          <button type="submit" className="button primary add-bw-submit">
            <Plus size={16} />
            <span>Сохранить</span>
          </button>
        </div>
      </form>

      {/* History Log Table */}
      <div className="bw-history-box">
        <h4 className="bw-history-title">История взвешиваний ({entries.length})</h4>
        <div className="bw-history-list">
          {entries
            .slice()
            .reverse()
            .map((entry, idx, arr) => {
              const prev = arr[idx + 1];
              const diff = prev ? Math.round((entry.weightKg - prev.weightKg) * 10) / 10 : null;

              return (
                <div key={entry.id} className="bw-history-item">
                  <div className="bw-history-left">
                    <b className="bw-item-weight">{entry.weightKg} кг</b>
                    {diff !== null && (
                      <span
                        className={`bw-diff-tag ${
                          diff < 0 ? "loss" : diff > 0 ? "gain" : "flat"
                        }`}
                      >
                        {diff > 0 ? `+${diff}` : diff}
                      </span>
                    )}
                    {entry.note && (
                      <span className="bw-item-note">«{entry.note}»</span>
                    )}
                  </div>

                  <div className="bw-history-right">
                    <span className="bw-item-date">{entry.date}</span>
                    <button
                      type="button"
                      className="bw-del-btn"
                      onClick={() => handleRemove(entry.id)}
                      title="Удалить запись"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
