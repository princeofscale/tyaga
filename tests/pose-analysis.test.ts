import test from "node:test";
import assert from "node:assert/strict";
import { PoseAnalysis, type PoseLandmark } from "../src/domain/PoseAnalysis";
const point = (x: number, y: number, z = 0): PoseLandmark => ({
  x,
  y,
  z,
  visibility: 0.9,
  presence: 0.9,
});

test("3D joint geometry measures known angles and rejects invisible or degenerate inputs", () => {
  assert.ok(
    Math.abs(PoseAnalysis.angle(point(1, 0), point(0, 0), point(0, 1))! - 90) <
      1e-10,
  );
  assert.ok(
    Math.abs(
      PoseAnalysis.angle(point(-1, 0), point(0, 0), point(1, 0))! - 180,
    ) < 1e-10,
  );
  assert.equal(PoseAnalysis.angle(point(0, 0), point(0, 0), point(1, 0)), null);
  assert.equal(
    PoseAnalysis.angle(
      { ...point(1, 0), visibility: 0.1 },
      point(0, 0),
      point(0, 1),
    ),
    null,
  );
  assert.equal(
    PoseAnalysis.angle(point(NaN, 0), point(0, 0), point(0, 1)),
    null,
  );
});

test("empty and insufficient poses report uncertainty rather than invented zero ROM", () => {
  const analysis = new PoseAnalysis();
  analysis.add(0, []);
  let report = analysis.report();
  assert.equal(report.frames, 1);
  assert.equal(report.recognizedFrames, 0);
  assert.ok(report.joints.every((j) => j.range === null));
  const points = Array.from({ length: 33 }, () => point(0, 0));
  points[23] = point(1, 0);
  points[25] = point(0, 0);
  points[27] = point(0, 1);
  for (let i = 1; i < 5; i++) analysis.add(i, points);
  report = analysis.report();
  assert.equal(report.joints.find((j) => j.id === "left-knee")!.range, null);
  analysis.add(5, points);
  report = analysis.report();
  assert.equal(report.joints.find((j) => j.id === "left-knee")!.range, 0);
  assert.equal(report.joints.find((j) => j.id === "right-knee")!.range, null);
  assert.match(report.limitations, /Не измеряет мышечные силы/);
});
