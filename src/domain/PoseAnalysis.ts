export type PoseLandmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
};
export const POSE_JOINTS = [
  { id: "left-knee", name: "Левое колено", points: [23, 25, 27] },
  { id: "right-knee", name: "Правое колено", points: [24, 26, 28] },
  { id: "left-hip", name: "Левый тазобедренный", points: [11, 23, 25] },
  { id: "right-hip", name: "Правый тазобедренный", points: [12, 24, 26] },
  { id: "left-elbow", name: "Левый локоть", points: [11, 13, 15] },
  { id: "right-elbow", name: "Правый локоть", points: [12, 14, 16] },
  { id: "left-shoulder", name: "Левое плечо", points: [13, 11, 23] },
  { id: "right-shoulder", name: "Правое плечо", points: [14, 12, 24] },
] as const;
export type PoseSample = {
  seconds: number;
  angles: Partial<Record<(typeof POSE_JOINTS)[number]["id"], number>>;
};

/** Estimated 3D geometry, with low visibility and degenerate vectors rejected. */
export class PoseAnalysis {
  private samples: PoseSample[] = [];
  private frames = 0;
  static angle(
    a?: PoseLandmark,
    b?: PoseLandmark,
    c?: PoseLandmark,
  ): number | null {
    if (
      !a ||
      !b ||
      !c ||
      [a, b, c].some(
        (p) =>
          ![p.x, p.y, p.z].every(Number.isFinite) ||
          (p.visibility ?? 0) < 0.6 ||
          (p.presence ?? 1) < 0.6,
      )
    )
      return null;
    const u = [a.x - b.x, a.y - b.y, a.z - b.z],
      v = [c.x - b.x, c.y - b.y, c.z - b.z];
    const denominator = Math.hypot(...u) * Math.hypot(...v);
    if (denominator < 1e-8) return null;
    const cosine = u.reduce((sum, x, i) => sum + x * v[i], 0) / denominator;
    return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
  }
  add(seconds: number, landmarks: PoseLandmark[]) {
    if (!Number.isFinite(seconds) || seconds < 0 || this.samples.length >= 1000)
      return;
    this.frames++;
    const angles: PoseSample["angles"] = {};
    for (const joint of POSE_JOINTS) {
      const [a, b, c] = joint.points;
      const angle = PoseAnalysis.angle(
        landmarks[a],
        landmarks[b],
        landmarks[c],
      );
      if (angle !== null) angles[joint.id] = angle;
    }
    this.samples.push({ seconds, angles });
  }
  report() {
    return {
      version: 1,
      method: "mediapipe-pose-landmarker-lite-3d" as const,
      frames: this.frames,
      recognizedFrames: this.samples.filter(
        (s) => Object.keys(s.angles).length > 0,
      ).length,
      joints: POSE_JOINTS.map((joint) => {
        const values = this.samples
          .flatMap((s) =>
            s.angles[joint.id] === undefined ? [] : [s.angles[joint.id]!],
          )
          .sort((a, b) => a - b);
        const quantile = (p: number) =>
          values[Math.floor((values.length - 1) * p)];
        const enough = values.length >= 5;
        const min = enough ? quantile(0.05) : null,
          max = enough ? quantile(0.95) : null;
        return {
          id: joint.id,
          name: joint.name,
          samples: values.length,
          min,
          max,
          range: min === null || max === null ? null : max - min,
        };
      }),
      samples: this.samples.map((s) => ({
        seconds: s.seconds,
        angles: { ...s.angles },
      })),
      limitations:
        "Оценка углов из одного видео. Не измеряет мышечные силы, качество техники, боль, риск травмы или будущий рост мышц. Амплитуда — разница 5-го и 95-го процентилей распознанных углов, не клиническое измерение ROM.",
    };
  }
}
