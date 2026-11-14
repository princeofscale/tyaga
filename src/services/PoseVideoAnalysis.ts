import { PoseAnalysis, type PoseLandmark } from "../domain/PoseAnalysis";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import noSimdLoaderPath from "@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url";
import noSimdBinaryPath from "@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";

export const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const MAX_SECONDS = 180;
let cachedModel: Uint8Array | undefined;

export class PoseVideoAnalysis {
  static async analyze(
    video: HTMLVideoElement,
    signal: AbortSignal,
    progress: (percent: number) => void,
    frame?: (points: PoseLandmark[]) => void,
  ) {
    if (
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      video.duration > MAX_SECONDS
    )
      throw new Error("Выбери видео длительностью до 3 минут");
    const { PoseLandmarker, FilesetResolver } = await import(
      "@mediapipe/tasks-vision"
    );
    signal.throwIfAborted();
    if (!cachedModel) {
      const response = await fetch(POSE_MODEL_URL, {
        credentials: "omit",
        signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      });
      if (!response.ok)
        throw new Error(
          "Не удалось загрузить модель распознавания. Проверь соединение и повтори анализ.",
        );
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 10000000)
        throw new Error("Некорректный файл модели распознавания");
      cachedModel = bytes;
    }
    signal.throwIfAborted();
    const simd = await FilesetResolver.isSimdSupported();
    const files = simd
      ? { wasmLoaderPath, wasmBinaryPath }
      : { wasmLoaderPath: noSimdLoaderPath, wasmBinaryPath: noSimdBinaryPath };
    const landmarker = await PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: cachedModel, delegate: "CPU" },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.6,
      minPosePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
      outputSegmentationMasks: false,
    });
    const analysis = new PoseAnalysis();
    const originalTime = video.currentTime;
    video.pause();
    try {
      signal.throwIfAborted();
      const frames = Math.max(1, Math.ceil(video.duration * 5));
      for (let i = 0; i < frames; i++) {
        signal.throwIfAborted();
        const seconds = Math.min(video.duration - 0.001, i / 5);
        await this.seek(video, seconds, signal);
        const result = landmarker.detectForVideo(video, i * 200);
        try {
          const points = (result.worldLandmarks[0] ?? []).map(
            (point, index) => ({
              ...point,
              visibility:
                result.landmarks[0]?.[index]?.visibility ?? point.visibility,
            }),
          );
          analysis.add(seconds, points);
          frame?.(result.landmarks[0] ?? []);
        } finally {
          result.close();
        }
        progress(Math.round(((i + 1) / frames) * 100));
        // Yield after every sampled frame so cancel/navigation remains responsive.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      return analysis.report();
    } finally {
      landmarker.close();
      if (!signal.aborted) video.currentTime = originalTime;
    }
  }
  private static seek(
    video: HTMLVideoElement,
    seconds: number,
    signal: AbortSignal,
  ) {
    if (Math.abs(video.currentTime - seconds) < 0.001 && video.readyState >= 2)
      return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener("seeked", done);
        video.removeEventListener("error", failed);
        signal.removeEventListener("abort", aborted);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("Не удалось прочитать кадр видео"));
      };
      const aborted = () => {
        cleanup();
        reject(signal.reason ?? new DOMException("Отменено", "AbortError"));
      };
      const timer = setTimeout(failed, 10000);
      video.addEventListener("seeked", done, { once: true });
      video.addEventListener("error", failed, { once: true });
      signal.addEventListener("abort", aborted, { once: true });
      video.currentTime = seconds;
    });
  }
}
