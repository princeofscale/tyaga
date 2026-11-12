import { readFile } from "node:fs/promises";
import type { PoseSample } from "../src/domain/PoseAnalysis";

// Compare exported observations with a calibrated OpenSim/OpenCap table.
// Mapping and sign/zero conventions must be supplied explicitly by the researcher.
const [reportPath, tablePath, mappingPath] = process.argv.slice(2);
if (!reportPath || !tablePath || !mappingPath)
  throw new Error(
    "Usage: npx tsx scripts/validate-pose-reference.ts report.json reference.mot mapping.json",
  );
const report = JSON.parse(await readFile(reportPath, "utf8")) as {
  samples: PoseSample[];
};
const mapping = JSON.parse(await readFile(mappingPath, "utf8")) as Record<
  string,
  { coordinate: string; scale: number; offset: number }
>;
if (!Array.isArray(report.samples) || report.samples.length > 10000)
  throw new Error("Invalid pose report");
const raw = (await readFile(tablePath, "utf8")).trim().split(/\r?\n/);
const marker = raw.findIndex((line) => line.trim() === "endheader");
if (
  marker < 0 ||
  !raw
    .slice(0, marker)
    .some((line) => /^inDegrees\s*=\s*yes$/i.test(line.trim()))
)
  throw new Error("Reference must explicitly declare inDegrees=yes");
const lines = raw
  .slice(marker + 1)
  .filter((line) => line.trim() && !line.startsWith("#"));
const columns = lines
  .shift()!
  .trim()
  .split(/[\t, ]+/);
if (columns[0] !== "time")
  throw new Error("Reference table must start with time in seconds");
const rows = lines.map((line) =>
  line
    .trim()
    .split(/[\t, ]+/)
    .map(Number),
);
if (
  rows.length < 2 ||
  rows.length > 100000 ||
  rows.some(
    (r, i) =>
      r.length !== columns.length ||
      r.some((v) => !Number.isFinite(v)) ||
      (i > 0 && r[0] <= rows[i - 1][0]),
  )
)
  throw new Error("Invalid reference time series");
const findings = Object.entries(mapping).map(([joint, m]) => {
  const column = columns.indexOf(m.coordinate);
  if (column < 1 || !Number.isFinite(m.scale) || !Number.isFinite(m.offset))
    throw new Error(`Missing coordinate or calibration: ${joint}`);
  const errors: number[] = [];
  for (const sample of report.samples) {
    if (
      !Number.isFinite(sample.seconds) ||
      !sample.angles ||
      typeof sample.angles !== "object"
    )
      throw new Error("Invalid pose sample");
    const observed = sample.angles[joint as keyof typeof sample.angles];
    if (
      observed === undefined ||
      !Number.isFinite(observed) ||
      sample.seconds < rows[0][0] ||
      sample.seconds > rows.at(-1)![0]
    )
      continue;
    const upper = rows.findIndex((r) => r[0] >= sample.seconds),
      lo = rows[Math.max(0, upper - 1)],
      hi = rows[upper];
    const t = hi[0] === lo[0] ? 0 : (sample.seconds - lo[0]) / (hi[0] - lo[0]);
    const reference = lo[column] + t * (hi[column] - lo[column]);
    errors.push(observed * m.scale + m.offset - reference);
  }
  return {
    joint,
    coordinate: m.coordinate,
    samples: errors.length,
    mae: errors.length
      ? errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length
      : null,
    rmse: errors.length
      ? Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length)
      : null,
  };
});
console.log(
  JSON.stringify(
    {
      units: "degrees",
      interpretation: "measurement-agreement-only",
      findings,
    },
    null,
    2,
  ),
);
