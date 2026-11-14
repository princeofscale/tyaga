import { useEffect, useRef, useState } from "react";
import { PoseVideoAnalysis } from "../services/PoseVideoAnalysis";
import type { PoseAnalysis, PoseLandmark } from "../domain/PoseAnalysis";
import { fmt } from "../lib/model";
import { saveFile } from "../lib/saveFile";

export default function PoseAnalysisPanel() {
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  const [report, setReport] = useState<ReturnType<
    PoseAnalysis["report"]
  > | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const draw = (points: PoseLandmark[]) => {
    const element = canvas.current,
      clip = video.current;
    if (!element || !clip) return;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    element.width = clip.videoWidth;
    element.height = clip.videoHeight;
    ctx.clearRect(0, 0, element.width, element.height);
    ctx.fillStyle = "#cafa64";
    for (const point of points) {
      if ((point.visibility ?? 0) < 0.6) continue;
      ctx.beginPath();
      ctx.arc(
        point.x * element.width,
        point.y * element.height,
        4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  };
  const analyze = async () => {
    if (!video.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setProgress(0);
    setReport(null);
    try {
      const result = await PoseVideoAnalysis.analyze(
        video.current,
        controller.signal,
        setProgress,
        draw,
      );
      if (!controller.signal.aborted) setReport(result);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Не удалось проанализировать видео",
        );
    } finally {
      if (abort.current === controller) {
        setBusy(false);
        abort.current = null;
      }
    }
  };
  return (
    <section className="pose-analysis">
      <p>
        Загрузи один подход целиком: человек должен быть виден в полный рост,
        камера неподвижна. Оценка углов зависит от ракурса, освещения и
        видимости суставов.
      </p>
      <p className="tiny">
        Видео обрабатывается на этом устройстве и не отправляется на сервер. При
        первом запуске загружается модель Google. До 3 минут и 300 МБ;
        анализируется 5 кадров/с.
      </p>
      <label>
        Видео подхода
        <input
          aria-label="Видео подхода"
          type="file"
          accept="video/*"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            setError("");
            setReport(null);
            setReady(false);
            if (!file) return;
            if (file.size > 300 * 1024 * 1024) {
              setError("Видео больше 300 МБ. Выбери короткий фрагмент.");
              return;
            }
            if (!file.type.startsWith("video/")) {
              setError("Нужен видеофайл");
              return;
            }
            setUrl(URL.createObjectURL(file));
          }}
        />
      </label>
      {url && (
        <div className="pose-preview">
          <video
            ref={video}
            src={url}
            controls={!busy}
            playsInline
            muted
            preload="auto"
            onLoadedData={() => setReady(true)}
            onError={() => {
              setReady(false);
              setError("Браузер не смог прочитать этот формат видео");
            }}
          />
          <canvas ref={canvas} aria-label="Распознанные точки тела" />
        </div>
      )}
      <div className="modal-actions">
        <button
          className="button primary"
          disabled={!ready || busy}
          onClick={() => void analyze()}
        >
          {busy ? `Анализ: ${progress}%` : "Проанализировать видео"}
        </button>
        {busy && (
          <button
            className="button secondary"
            onClick={() => abort.current?.abort()}
          >
            Отменить анализ
          </button>
        )}
      </div>
      {busy && (
        <p role="status">
          {progress
            ? `Обработано ${progress}% кадров`
            : "Загружаем модель и подготавливаем анализ…"}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {report && (
        <div className="pose-report">
          <h3>Оценочная амплитуда</h3>
          <p>
            Кадров с распознанными углами: {report.recognizedFrames} из{" "}
            {report.frames}.
          </p>
          {report.recognizedFrames === 0 && (
            <p role="status">
              Не удалось уверенно распознать суставы. Попробуй другой ракурс и
              освещение.
            </p>
          )}
          <div className="pose-joints">
            {report.joints.map((joint) => (
              <div key={joint.id}>
                <b>{joint.name}</b>
                <span>
                  {joint.range === null
                    ? "Мало достоверных кадров"
                    : `${fmt(joint.min!)}–${fmt(joint.max!)}° · амплитуда ${fmt(joint.range)}°`}
                </span>
                <small>{joint.samples} кадров</small>
              </div>
            ))}
          </div>
          <p className="tiny">{report.limitations}</p>
          <button
            className="button secondary"
            onClick={() =>
              void saveFile(
                "tyaga-pose-analysis.json",
                JSON.stringify(report, null, 2),
              )
            }
          >
            Скачать отчёт с углами
          </button>
        </div>
      )}
    </section>
  );
}
