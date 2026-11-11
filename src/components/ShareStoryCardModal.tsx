import { useState, useRef, useEffect } from "react";
import { Download, Image as ImageIcon, Share2, Smartphone } from "lucide-react";
import type { Workout } from "../lib/model";
import type { AccountProfile } from "../lib/account";
import { volumeSummary, fmt } from "../lib/model";
import { TextFitter } from "../domain/TextFitter";

const DISPLAY = '"Tyaga Display", "Arial Narrow", sans-serif';
const BODY = '"Onest Variable", system-ui, sans-serif';
const MONO = '"JetBrains Mono Variable", ui-monospace, monospace';
const font = (weight: number, size: number, family = BODY) => `${weight} ${size}px ${family}`;

/** Canvas рисует только уже загруженные шрифты, поэтому подгружаем их заранее. */
const FONT_FACES = [
  font(700, 64, DISPLAY),
  font(800, 64, DISPLAY),
  font(500, 24),
  font(600, 24),
  font(700, 24),
  font(700, 26, MONO),
];
const FONT_SAMPLE = "Тяга ТЯГА тренировка 0123456789 кг мин";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

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
  const [downloading, setDownloading] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);

  const summary = volumeSummary([workout]);
  const workingSetsCount = workout.exercises.reduce(
    (acc, e) => acc + e.sets.filter((s) => !s.warmup && s.done).length,
    0,
  );

  // Самый сильный рабочий подход по оценке 1ПМ
  const bestSet = workout.exercises
    .flatMap((e) =>
      e.sets
        .filter((s) => !s.warmup && s.done && s.weight > 0)
        .map((s) => ({
          name: e.displayNameSnapshot || e.exerciseId,
          weight: s.weight,
          reps: s.reps,
          e1rm: Math.round(s.weight * (1 + s.reps / 30)),
        })),
    )
    .sort((a, b) => b.e1rm - a.e1rm)[0];

  const durationMin = Math.max(1, workout.duration || 1);

  useEffect(() => {
    let live = true;
    void Promise.all(FONT_FACES.map((face) => document.fonts.load(face, FONT_SAMPLE)))
      .catch(() => undefined)
      .then(() => {
        if (live) setFontsReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const drawCard = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const fitter = new TextFitter((face, text) => {
      ctx.font = face;
      return ctx.measureText(text).width;
    });

    const width = 1080;
    const height = format === "story" ? 1920 : 1350;
    const inner = width - 160;
    canvas.width = width;
    canvas.height = height;

    // Фон
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, "#161b17");
    bgGrad.addColorStop(0.5, "#0f1310");
    bgGrad.addColorStop(1, "#0a0c0a");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const radial = ctx.createRadialGradient(width / 2, height * 0.38, 50, width / 2, height * 0.38, 500);
    radial.addColorStop(0, "rgba(202, 250, 100, 0.08)");
    radial.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
    ctx.lineWidth = 1;
    for (let x = 60; x < width; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Шапка: марка слева, имя и дата справа
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#cafa64";
    ctx.font = font(800, 68, DISPLAY);
    ctx.textAlign = "left";
    ctx.fillText("тяга.", 80, 140);

    ctx.textAlign = "right";
    ctx.fillStyle = "#a4af9e";
    ctx.font = font(600, 32);
    const nameText = fitter.ellipsize(account.displayName, 480, font(600, 32));
    ctx.fillText(nameText, width - 80, 128);

    ctx.font = font(500, 26);
    ctx.fillStyle = "#768271";
    const dateStr = new Date(workout.date + "T12:00:00").toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    ctx.fillText(dateStr, width - 80, 170);

    ctx.strokeStyle = "rgba(202, 250, 100, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, 210);
    ctx.lineTo(width - 80, 210);
    ctx.stroke();

    // Название тренировки подгоняем по ширине, а не даём вылезти за край
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    const titleText = (workout.name.trim() || "Тренировка").toUpperCase();
    const titleSize = fitter.fitSize(titleText, inner, 104, 44, (size) => font(800, size, DISPLAY));
    ctx.font = font(800, titleSize, DISPLAY);
    ctx.fillText(fitter.ellipsize(titleText, inner, font(800, titleSize, DISPLAY)), 80, 215 + titleSize * 0.95);

    ctx.fillStyle = "#cafa64";
    ctx.font = font(700, 28);
    ctx.fillText("Силовая тренировка завершена", 80, 215 + titleSize * 0.95 + 56);

    // Три крупные метрики
    const cardY = 440;
    const cardW = 280;
    const cardH = 220;
    const gap = (inner - cardW * 3) / 2;
    const metrics = [
      { val: `${fmt(summary.total)}`, unit: "кг", label: "Тоннаж", accent: "#cafa64" },
      { val: `${durationMin}`, unit: "мин", label: "Время", accent: "#ffffff" },
      { val: `${workingSetsCount}`, unit: "подходов", label: "Рабочий объём", accent: "#58c0ff" },
    ];
    metrics.forEach((m, i) => {
      const cx = 80 + i * (cardW + gap);
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 2;
      roundRect(ctx, cx, cardY, cardW, cardH, 24);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.fillStyle = m.accent;
      const valueSize = fitter.fitSize(m.val, cardW - 40, 92, 48, (size) => font(800, size, DISPLAY));
      ctx.font = font(800, valueSize, DISPLAY);
      ctx.fillText(m.val, cx + cardW / 2, cardY + 108);

      ctx.fillStyle = "#a4af9e";
      ctx.font = font(600, 24);
      ctx.fillText(m.unit, cx + cardW / 2, cardY + 148);

      ctx.fillStyle = "#768271";
      ctx.font = font(600, 22);
      ctx.fillText(m.label, cx + cardW / 2, cardY + 188);
    });

    // Главный результат
    if (bestSet) {
      const prY = 720;
      ctx.fillStyle = "rgba(202, 250, 100, 0.08)";
      ctx.strokeStyle = "rgba(202, 250, 100, 0.4)";
      ctx.lineWidth = 2;
      roundRect(ctx, 80, prY, inner, 180, 24);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#cafa64";
      roundRect(ctx, 80, prY, 10, 180, 5);
      ctx.fill();

      ctx.textAlign = "left";
      ctx.fillStyle = "#cafa64";
      ctx.font = font(700, 26);
      ctx.fillText("Лучший подход", 120, prY + 58);

      ctx.fillStyle = "#ffffff";
      const result = `${bestSet.name}: ${bestSet.weight} кг × ${bestSet.reps}`;
      const resultSize = fitter.fitSize(result, inner - 80, 48, 28, (size) => font(700, size, BODY));
      ctx.font = font(700, resultSize, BODY);
      ctx.fillText(fitter.ellipsize(result, inner - 80, font(700, resultSize, BODY)), 120, prY + 128);
    }

    // Выполненные упражнения: название режем по месту, чтобы не налезало на вес
    const exY = 960;
    // Упражнение без единого выполненного подхода на карточку не попадает
    const shown = workout.exercises
      .filter((e) => e.sets.some((s) => !s.warmup && s.done))
      .slice(0, format === "story" ? 6 : 4);
    if (shown.length) {
      ctx.textAlign = "left";
      ctx.fillStyle = "#a4af9e";
      ctx.font = font(700, 26);
      ctx.fillText("Упражнения", 80, exY);
    }
    shown.forEach((e, idx) => {
      const ey = exY + 60 + idx * 75;
      const doneSets = e.sets.filter((s) => !s.warmup && s.done);
      const topWeight = Math.max(...doneSets.map((s) => s.weight), 0);

      ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
      roundRect(ctx, 80, ey - 40, inner, 60, 14);
      ctx.fill();

      ctx.textAlign = "left";
      ctx.fillStyle = "#cafa64";
      ctx.font = font(700, 26, MONO);
      ctx.fillText(String(idx + 1).padStart(2, "0"), 105, ey);

      // Правая часть: «N подх.» и вес; левая — название в оставшемся месте
      ctx.textAlign = "right";
      ctx.fillStyle = "#cafa64";
      ctx.font = font(700, 30);
      const weightText = `${topWeight} кг`;
      ctx.fillText(weightText, width - 110, ey);
      const weightWidth = ctx.measureText(weightText).width;

      ctx.fillStyle = "#a4af9e";
      ctx.font = font(600, 24);
      const setsText = `${doneSets.length} подх.`;
      ctx.fillText(setsText, width - 110 - weightWidth - 28, ey);
      const setsWidth = ctx.measureText(setsText).width;

      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      ctx.font = font(600, 30);
      const room = width - 110 - weightWidth - 28 - setsWidth - 24 - 170;
      ctx.fillText(fitter.ellipsize(e.displayNameSnapshot || e.exerciseId, room, font(600, 30)), 170, ey);
    });

    // Подпись
    ctx.textAlign = "center";
    ctx.fillStyle = "#5f6b5c";
    ctx.font = font(600, 24);
    ctx.fillText("Тяга · силовой журнал", width / 2, height - 100);
  };

  useEffect(() => {
    if (fontsReady) drawCard();
  }, [workout, format, fontsReady]);

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

      const file = new File([blob], `tyaga-${workout.date}.png`, { type: "image/png" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Тренировка в Тяге: ${workout.name}`,
            text: `Тоннаж: ${fmt(summary.total)} кг • ${workingSetsCount} рабочих подходов`,
          });
        } catch {
          // человек закрыл окно «Поделиться»
        }
      } else {
        handleDownload();
      }
    }, "image/png");
  };

  return (
    <div className="story-card-modal-content">
      <div className="story-format-pills">
        <button
          type="button"
          className={`format-pill ${format === "story" ? "active" : ""}`}
          aria-pressed={format === "story"}
          onClick={() => setFormat("story")}
        >
          <Smartphone size={16} aria-hidden="true" /> Сторис 9:16
        </button>
        <button
          type="button"
          className={`format-pill ${format === "post" ? "active" : ""}`}
          aria-pressed={format === "post"}
          onClick={() => setFormat("post")}
        >
          <ImageIcon size={16} aria-hidden="true" /> Пост 4:5
        </button>
      </div>

      <div className="story-canvas-preview-wrap">
        <canvas ref={canvasRef} className={`story-render-canvas ${format}`} role="img" aria-label="Предпросмотр карточки тренировки" />
      </div>

      <div className="story-card-actions">
        <button type="button" className="button primary story-action-btn" onClick={handleShare} disabled={!fontsReady}>
          <Share2 size={18} />
          <span>Поделиться карточкой</span>
        </button>

        <button type="button" className="button secondary story-action-btn" onClick={handleDownload} disabled={downloading || !fontsReady}>
          <Download size={18} />
          <span>{downloading ? "Сохраняем…" : "Скачать PNG"}</span>
        </button>
      </div>
    </div>
  );
}
