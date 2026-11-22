#!/usr/bin/env node
/**
 * ESLint с явным «долговым» baseline.
 *
 * Задача: линтер можно включить сегодня, не выдавая сотни старых находок за
 * новые ошибки, и при этом он обязан падать на любой новой. Baseline — это
 * счётчик уже существующих находок по ключу «файл + правило + текст строки».
 * Текст строки, а не номер: строки сдвигаются при рефакторинге, содержимое — нет.
 *
 * Режимы:
 *   (без флагов)        сравнить с baseline; упасть, если находок стало больше
 *   --report            напечатать все текущие находки, ничего не сравнивая
 *   --update-baseline   перезаписать baseline текущим состоянием
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import { ESLint } from "eslint";

const root = resolve(new URL("..", import.meta.url).pathname);
const baselinePath = resolve(root, ".lint-baseline.json");
const targets = ["src", "server", "db", "scripts"];
const extraFiles = ["vite.config.ts", "drizzle.config.ts", "eslint.config.js"];

const args = new Set(process.argv.slice(2));
const report = args.has("--report");
const update = args.has("--update-baseline");

const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);
const lineOf = (source, line) => (source ? (source.split("\n")[line - 1] ?? "").trim() : "");

const eslint = new ESLint({ cwd: root, errorOnUnmatchedPattern: false });
const results = await eslint.lintFiles([...targets, ...extraFiles]);

const current = new Map();
const findings = [];
let fatal = 0;

for (const result of results) {
  if (!result.messages.length) continue;
  const source = result.source ?? (await readFile(result.filePath, "utf8").catch(() => ""));
  const file = relative(root, result.filePath).split("\\").join("/");
  for (const message of result.messages) {
    const line = lineOf(source, message.line);
    const key = [file, message.ruleId ?? "<fatal>", hash(line)].join("|");
    current.set(key, (current.get(key) ?? 0) + 1);
    if (message.fatal || !message.ruleId) fatal += 1;
    findings.push({
      key,
      file,
      line: message.line ?? 0,
      column: message.column ?? 0,
      rule: message.ruleId ?? "fatal",
      severity: message.severity === 2 ? "error" : "warning",
      message: message.message,
      source: line,
    });
  }
}

const total = findings.length;
const errors = findings.filter((f) => f.severity === "error").length;

if (report) {
  for (const f of findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.log(`${f.file}:${f.line}:${f.column}  ${f.severity}  ${f.rule}  ${f.message}`);
    if (f.source) console.log(`    ${f.source}`);
  }
  console.log(`\nВсего находок: ${total} (ошибок ${errors}, предупреждений ${total - errors}).`);
  process.exit(0);
}

if (update) {
  const keys = Object.fromEntries([...current.entries()].sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(
    baselinePath,
    `${JSON.stringify({ version: 1, note: "Сгенерировано npm run lint:update-baseline. Уменьшать можно вручную: лишние ключи не считаются новыми находками.", findings: total, keys }, null, 2)}\n`,
  );
  console.log(`Baseline обновлён: ${total} находок в ${Object.keys(keys).length} ключах → .lint-baseline.json`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(await readFile(baselinePath, "utf8"));
} catch {
  console.error("Нет .lint-baseline.json. Создай его явно: npm run lint:update-baseline");
  process.exit(1);
}

const allowed = baseline.keys ?? {};
const added = [];
for (const [key, count] of current) {
  const before = allowed[key] ?? 0;
  if (count > before) added.push({ key, count, before });
}

const fixed = Object.entries(allowed).reduce((sum, [key, count]) => sum + Math.max(0, count - (current.get(key) ?? 0)), 0);

if (fatal) {
  console.error(`Разбор файлов не удался: ${fatal} фатальных ошибок. Запусти npm run lint:report.`);
  process.exit(1);
}

if (added.length) {
  console.error(`Новых находок: ${added.reduce((n, a) => n + a.count - a.before, 0)} в ${added.length} местах (baseline ${baseline.findings ?? 0}).`);
  for (const entry of added.slice(0, 40)) {
    const [file, rule, lineHash] = entry.key.split("|");
    const sample = findings.find((f) => f.key === entry.key);
    console.error(`  ${file}:${sample?.line ?? "?"}  ${rule} — ${sample?.message ?? ""}`);
    if (sample?.source) console.error(`      ${sample.source}`);
    void lineHash;
  }
  if (added.length > 40) console.error(`  …и ещё ${added.length - 40}`);
  console.error("Исправь новые находки или, если правило неприменимо, добавь точечное исключение с объяснением.");
  process.exit(1);
}

console.log(
  `ESLint: новых находок нет. Всего сейчас ${total} (ошибок ${errors}), в baseline ${baseline.findings ?? 0}` +
    (fixed ? `, исправлено с прошлого раза ${fixed}.` : `.`),
);
