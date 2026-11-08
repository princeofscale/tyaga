import { useState, useRef, useEffect } from "react";
import {
  Download,
  Share2,
  Copy,
  Check,
  Sparkles,
  Camera,
  X,
  Layers,
} from "lucide-react";
import type { Workout } from "../lib/model";
import type { AccountProfile } from "../lib/account";
import { volumeSummary, fmt } from "../lib/model";

export function ShareStoryCardModal({
  workout,
  account,
  onClose,
}: {
  workout: Workout;
  account: AccountProfile;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [format, setFormat] = useState<"story" | "post">("story");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const summary = volumeSummary([workout]);
  const workingSetsCount = workout.exercises.reduce(
    (acc, e) => acc + e.sets.filter((s) => !s.warmup && s.done).length,
    0
  );

  // Find best working set highlight
  const bestSet = workout.exercises
    .flatMap((e) =>
      e.sets
        .filter((s) => !s.warmup && s.done && s.weight > 0)
        .map((s) => ({
          name: e.displayNameSnapshot || e.exerciseId,
          weight: s.weight,
          reps: s.reps,
          e1rm: Math.round(s.weight * (1 + s.reps / 30)),
        }))
    )
    .sort((a, b) => b.e1rm - a.e1rm)[0];

  const durationMin = Math.max(1, workout.duration || 1);

  const drawCard = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = 1080;
    const height = format === "story" ? 1920 : 1350;
    canvas.width = width;
    canvas.height = height;

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, "#161b17");
    bgGrad.addColorStop(0.5, "#0f1310");
    bgGrad.addColorStop(1, "#0a0c0a");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Subtle radial glow in the center
    const radial = ctx.createRadialGradient(
      width / 2,
      height * 0.38,
      50,
      width / 2,
      height * 0.38,
      500
    );
    radial.addColorStop(0, "rgba(202, 250, 100, 0.08)");
    radial.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, width, height);

    // Grid texture lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
    ctx.lineWidth = 1;
    for (let x = 60; x < width; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Top Header: Brand Logo
    ctx.fillStyle = "#cafa64";
    ctx.font = "900 52px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("тяга.", 80, 140);

    // Athlete Tag & Date
    ctx.fillStyle = "#8a9a8d";
    ctx.font = "600 32px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "right";
    const athleteHandle = `@${account.displayName.toLowerCase().replace(/\s+/g, "_")}`;
    ctx.fillText(athleteHandle, width - 80, 130);

    ctx.font = "500 26px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#617164";
    const dateStr = new Date(workout.date + "T12:00:00").toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    ctx.fillText(dateStr, width - 80, 170);

    // Top horizontal divider
    ctx.strokeStyle = "rgba(202, 250, 100, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, 210);
    ctx.lineTo(width - 80, 210);
    ctx.stroke();

    // Session Title
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 68px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    const titleText = workout.name.toUpperCase();
    ctx.fillText(titleText, 80, 310);

    // Subtitle badge
    ctx.fillStyle = "#cafa64";
    ctx.font = "700 28px system-ui, -apple-system, sans-serif";
    ctx.fillText("СИЛОВАЯ ТРЕНИРОВКА ЗАВЕРШЕНА ⚡", 80, 370);

    // 3 Big Metric Cards
    const cardY = 440;
    const cardW = 280;
    const cardH = 220;
    const gap = (width - 160 - cardW * 3) / 2;

    const metrics = [
      {
        val: `${fmt(summary.total)}`,
        unit: "кг",
        label: "ОБЩИЙ ТОННАЖ",
        accent: "#cafa64",
      },
      {
        val: `${durationMin}`,
        unit: "мин",
        label: "ДЛИТЕЛЬНОСТЬ",
        accent: "#ffffff",
      },
      {
        val: `${workingSetsCount}`,
        unit: "сетов",
        label: "РАБОЧИЙ ОБЪЁМ",
        accent: "#58c0ff",
      },
    ];

    metrics.forEach((m, i) => {
      const cx = 80 + i * (cardW + gap);

      // Card box
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 2;
      roundRect(ctx, cx, cardY, cardW, cardH, 24);
      ctx.fill();
      ctx.stroke();

      // Number value
      ctx.fillStyle = m.accent;
      ctx.font = "900 64px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(m.val, cx + cardW / 2, cardY + 105);

      // Unit
      ctx.fillStyle = "#8a9a8d";
      ctx.font = "600 24px system-ui, -apple-system, sans-serif";
      ctx.fillText(m.unit, cx + cardW / 2, cardY + 145);

      // Label
      ctx.fillStyle = "#617164";
      ctx.font = "700 20px system-ui, -apple-system, sans-serif";
      ctx.fillText(m.label, cx + cardW / 2, cardY + 185);
    });

    // Best PR / Highlight Banner
    if (bestSet) {
      const prY = 720;
      ctx.fillStyle = "rgba(202, 250, 100, 0.08)";
      ctx.strokeStyle = "rgba(202, 250, 100, 0.4)";
      ctx.lineWidth = 2;
      roundRect(ctx, 80, prY, width - 160, 180, 24);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.fillStyle = "#cafa64";
      ctx.font = "800 26px system-ui, -apple-system, sans-serif";
      ctx.fillText("🏆 ГЛАВНЫЙ СИЛОВОЙ РЕЗУЛЬТАТ", 120, prY + 60);

      ctx.fillStyle = "#ffffff";
      ctx.font = "800 48px system-ui, -apple-system, sans-serif";
      ctx.fillText(
        `${bestSet.name}: ${bestSet.weight} кг × ${bestSet.reps}`,
        120,
        prY + 130
      );
    }

    // Exercise breakdown table
    const exY = 960;
    ctx.textAlign = "left";
    ctx.fillStyle = "#8a9a8d";
    ctx.font = "700 26px system-ui, -apple-system, sans-serif";
    ctx.fillText("ВЫПОЛНЕННЫЕ ДВИЖЕНИЯ:", 80, exY);

    const shownExercises = workout.exercises.slice(0, format === "story" ? 6 : 4);
    shownExercises.forEach((e, idx) => {
      const ey = exY + 60 + idx * 75;
      const doneSets = e.sets.filter((s) => !s.warmup && s.done);
      const topWeight = Math.max(...doneSets.map((s) => s.weight), 0);

      ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
      roundRect(ctx, 80, ey - 40, width - 160, 60, 14);
      ctx.fill();

      // Number
      ctx.fillStyle = "#cafa64";
      ctx.font = "800 26px monospace";
      ctx.fillText(`0${idx + 1}`, 105, ey);

      // Name
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 30px system-ui, -apple-system, sans-serif";
      const exName = (e.displayNameSnapshot || e.exerciseId).slice(0, 32);
      ctx.fillText(exName, 170, ey);

      // Sets & Top Weight
      ctx.textAlign = "right";
      ctx.fillStyle = "#cafa64";
      ctx.font = "800 30px system-ui, -apple-system, sans-serif";
      ctx.fillText(`${topWeight} кг`, width - 110, ey);

      ctx.fillStyle = "#8a9a8d";
      ctx.font = "600 24px system-ui, -apple-system, sans-serif";
      ctx.fillText(`${doneSets.length} подх. ×`, width - 230, ey);

      ctx.textAlign = "left";
    });

    // Footer Watermark
    const footY = height - 100;
    ctx.textAlign = "center";
    ctx.fillStyle = "#49554b";
    ctx.font = "600 24px system-ui, -apple-system, sans-serif";
    ctx.fillText("ТЯГА • НАУЧНЫЙ СИЛОВОЙ ЖУРНАЛ ТРЕНИРОВОК", width / 2, footY);
  };

  function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  useEffect(() => {
    drawCard();
  }, [workout, format]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setDownloading(true);

    canvas.toBlob((blob) => {
      if (!blob) {
        setDownloading(false);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tyaga-${workout.date}-${format}.png`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloading(false);
    }, "image/png");
  };

  const handleShare = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.toBlob(async (blob) => {
      if (!blob) return;

      const file = new File([blob], `tyaga-${workout.date}.png`, {
        type: "image/png",
      });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Тренировка в Тяге: ${workout.name}`,
            text: `Тоннаж: ${fmt(summary.total)} кг • ${workingSetsCount} рабочих подходов`,
          });
        } catch {
          // user cancelled
        }
      } else {
        // Fallback: download
        handleDownload();
      }
    }, "image/png");
  };

  return (
    <div className="story-card-modal-content">
      {/* Format Selector Pills */}
      <div className="story-format-pills">
        <button
          type="button"
          className={`format-pill ${format === "story" ? "active" : ""}`}
          onClick={() => setFormat("story")}
        >
          📱 9:16 Сторис (1080×1920)
        </button>
        <button
          type="button"
          className={`format-pill ${format === "post" ? "active" : ""}`}
          onClick={() => setFormat("post")}
        >
          🖼️ 4:5 Пост (1080×1350)
        </button>
      </div>

      {/* Canvas Live Preview Box */}
      <div className="story-canvas-preview-wrap">
        <canvas
          ref={canvasRef}
          className={`story-render-canvas ${format}`}
        />
      </div>

      {/* Action Buttons */}
      <div className="story-card-actions">
        <button
          type="button"
          className="button primary story-action-btn"
          onClick={handleShare}
        >
          <Share2 size={18} />
          <span>Поделиться карточкой</span>
        </button>

        <button
          type="button"
          className="button secondary story-action-btn"
          onClick={handleDownload}
          disabled={downloading}
        >
          <Download size={18} />
          <span>{downloading ? "Сохраняем…" : "Скачать PNG"}</span>
        </button>
      </div>
    </div>
  );
}
