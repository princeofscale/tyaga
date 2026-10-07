import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Data only: no wger application source or exercise media is copied.
export class WgerImportService {
  static supportedLicenses = new Set([1, 2, 3, 4]);
  constructor({ baseUrl = "https://wger.de/api/v2/", inputDirectory } = {}) {
    this.baseUrl = baseUrl;
    this.inputDirectory = inputDirectory;
  }
  async collection(resource) {
    if (this.inputDirectory)
      return JSON.parse(
        await readFile(
          resolve(this.inputDirectory, resource + ".json"),
          "utf8",
        ),
      );
    let url = new URL(resource + "/?limit=100", this.baseUrl).href;
    const results = [];
    while (url) {
      if (new URL(url).origin !== new URL(this.baseUrl).origin)
        throw new Error("Unexpected pagination origin");
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Tyaga open exercise importer",
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error(`wger ${resource}: HTTP ${response.status}`);
      const page = await response.json();
      if (!Array.isArray(page.results))
        throw new Error("Invalid wger response");
      results.push(...page.results);
      url = page.next;
    }
    return results;
  }
  text(html = "") {
    return html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(p|div|li|h[1-6])\s*>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) =>
        Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : "",
      )
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 6000);
  }
  normalize(row, licenses) {
    if (!WgerImportService.supportedLicenses.has(row.license.id)) return null;
    const translations = row.translations.filter(
      (t) =>
        [2, 5].includes(t.language) &&
        WgerImportService.supportedLicenses.has(t.license),
    );
    const en = translations.find((t) => t.language === 2);
    const ru = translations.find((t) => t.language === 5);
    const chosen = ru ?? en;
    if (!chosen) return null;
    const attributions = [
      {
        scope: "exercise",
        title: en?.name ?? chosen.name,
        authors: [
          ...new Set(
            [row.license_author, ...(row.author_history ?? [])].filter(Boolean),
          ),
        ],
        license: row.license.short_name.trim(),
        licenseUrl: row.license.url,
        sourceUrl: `https://wger.de/en/exercise/${row.id}/view/`,
      },
      ...translations.map((t) => ({
        scope: t.language === 5 ? "translation-ru" : "translation-en",
        title: t.license_title || t.name,
        authors: [
          ...new Set(
            [t.license_author, ...(t.author_history ?? [])].filter(Boolean),
          ),
        ],
        license: licenses.find((l) => l.id === t.license).short_name.trim(),
        licenseUrl: licenses.find((l) => l.id === t.license).url,
        sourceUrl:
          t.license_object_url ||
          `https://wger.de/api/v2/exercise-translation/${t.id}/`,
        authorUrl: t.license_author_url || null,
        derivativeSourceUrl: t.license_derivative_source_url || null,
      })),
    ];
    const result = {
      sourceId: row.id,
      uuid: row.uuid,
      name: chosen.name.trim(),
      nameEn: en?.name.trim() ?? chosen.name.trim(),
      language: ru ? "ru" : "en",
      instructions: this.text(chosen.description),
      category: row.category.name,
      equipment: row.equipment.map((e) => ({ id: e.id, name: e.name })),
      muscles: row.muscles.map((m) => ({
        id: m.id,
        name: m.name,
        role: "primary",
      })),
      secondaryMuscles: row.muscles_secondary.map((m) => ({
        id: m.id,
        name: m.name,
        role: "secondary",
      })),
      aliases: [
        ...new Set(
          translations.flatMap((t) => (t.aliases ?? []).map((a) => a.alias)),
        ),
      ],
      variationGroup: row.variation_group,
      sourceUpdatedAt: row.last_update_global,
      attributions,
      adaptation:
        "Russian translation preferred; English fallback. HTML converted to plain text; descriptions limited to 6000 characters. Media omitted. Muscle roles reproduced as source metadata without scientific certification.",
      loggable:
        row.category.name !== "Cardio" &&
        !/\b(plank|holds?|hangs?|stretch(?:ing)?|isometric)\b/i.test(
          chosen.name + " " + (en?.name ?? ""),
        ),
    };
    result.contentHash = createHash("sha256")
      .update(JSON.stringify(result))
      .digest("hex")
      .slice(0, 16);
    result.id = `wger:${row.id}:${result.contentHash}`;
    return result;
  }
  async import() {
    const [rows, licenses] = await Promise.all([
      this.collection("exerciseinfo"),
      this.collection("license"),
    ]);
    const exercises = rows
      .map((r) => this.normalize(r, licenses))
      .filter(Boolean)
      .sort((a, b) => a.sourceId - b.sourceId);
    if (new Set(exercises.map((e) => e.id)).size !== exercises.length)
      throw new Error("Duplicate wger IDs");
    const hash = createHash("sha256")
      .update(JSON.stringify(exercises))
      .digest("hex");
    return {
      provider: "wger",
      release: `wger-${hash.slice(0, 16)}`,
      fetchedAt: new Date().toISOString(),
      sourceUrl: this.baseUrl + "exerciseinfo/",
      upstreamCount: rows.length,
      count: exercises.length,
      omittedCount: rows.length - exercises.length,
      exercises,
    };
  }
}
if (
  process.argv[1] &&
  import.meta.url === new URL("file://" + resolve(process.argv[1])).href
) {
  const directory = process.argv.indexOf("--input");
  const output = process.argv.indexOf("--output");
  const path = resolve(
    output >= 0 ? process.argv[output + 1] : "data/wger/catalog-v1.json",
  );
  const snapshot = await new WgerImportService({
    inputDirectory: directory >= 0 ? process.argv[directory + 1] : undefined,
  }).import();
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(snapshot));
  console.log(
    JSON.stringify({
      path,
      release: snapshot.release,
      count: snapshot.count,
      upstreamCount: snapshot.upstreamCount,
      omittedCount: snapshot.omittedCount,
      russian: snapshot.exercises.filter((e) => e.language === "ru").length,
      loggable: snapshot.exercises.filter((e) => e.loggable).length,
    }),
  );
}
