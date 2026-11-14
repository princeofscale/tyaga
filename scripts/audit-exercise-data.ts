import { readFile } from "node:fs/promises";
import { EXERCISES } from "../src/lib/catalog";
import { MUSCLES } from "../src/data/muscles";

// Accept an explicitly attributed normalized source; never update the catalog.
const path = process.argv[2];
if (!path)
  throw new Error(
    "Usage: npx tsx scripts/audit-exercise-data.ts normalized-source.json",
  );
const source = JSON.parse(await readFile(path, "utf8")) as {
  sourceUrl?: string;
  license?: string;
  records?: { exerciseId: string; primary: string[]; secondary: string[] }[];
};
if (
  !source.sourceUrl ||
  !source.license ||
  !Array.isArray(source.records) ||
  source.records.length > 10000
)
  throw new Error(
    "Provide sourceUrl, license and up to 10,000 normalized records",
  );
const zones = new Set<string>(MUSCLES.map((m) => m.id));
const findings = source.records.map((row) => {
  if (
    !row ||
    typeof row.exerciseId !== "string" ||
    !Array.isArray(row.primary) ||
    !Array.isArray(row.secondary) ||
    [...row.primary, ...row.secondary].some((z) => !zones.has(z))
  )
    throw new Error("Invalid normalized exercise mapping");
  const exercise = EXERCISES.find((e) => e.id === row.exerciseId);
  if (!exercise) return { exerciseId: row.exerciseId, status: "unmatched" };
  const difference = (a: readonly string[], b: readonly string[]) =>
    [...new Set([...a, ...b])].filter(
      (id) => a.includes(id) !== b.includes(id),
    );
  return {
    exerciseId: row.exerciseId,
    status: "review-required",
    directDifferences: difference(exercise.primary, row.primary),
    assistingDifferences: difference(exercise.secondary, row.secondary),
  };
});
console.log(
  JSON.stringify(
    {
      sourceUrl: source.sourceUrl,
      license: source.license,
      model: "comparison-only",
      findings,
    },
    null,
    2,
  ),
);
