import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Historical exception: 0010_live_rooms.sql and 0010_machines.sql were already
 * published to production D1 and remain immutable. Every migration after 0010
 * must have a unique, strictly increasing 4-digit prefix.
 */
const HISTORICAL_DUPLICATE_PAIR = new Set(["0010_live_rooms.sql", "0010_machines.sql"]);

export function checkMigrations(dir = resolve("drizzle")) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (!files.length) throw new Error("В drizzle/ нет ни одной SQL-миграции.");

  const byNumber = new Map();
  const errors = [];

  for (const file of files) {
    const match = file.match(/^(\d{4})_[a-z0-9_]+\.sql$/);
    if (!match) {
      errors.push(`Некорректное имя миграции (ожидается NNNN_snake_case.sql): ${file}`);
      continue;
    }
    const num = Number(match[1]);
    const list = byNumber.get(num) ?? [];
    list.push(file);
    byNumber.set(num, list);
  }

  for (const [num, list] of byNumber.entries()) {
    if (list.length <= 1) continue;
    if (num === 10 && list.length === 2 && list.every((f) => HISTORICAL_DUPLICATE_PAIR.has(f))) continue;
    errors.push(`Дублируется номер миграции ${String(num).padStart(4, "0")}: ${list.join(", ")}`);
  }

  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] !== numbers[i - 1] + 1) {
      errors.push(
        `Разрыв нумерации миграций: после ${String(numbers[i - 1]).padStart(4, "0")} идёт ${String(numbers[i]).padStart(4, "0")}`,
      );
    }
  }

  // Проверяем соответствие meta/_journal.json: зафиксированный порядок (в т.ч. 0010_live_rooms → 0010_machines)
  // и наличие каждого упомянутого SQL-файла.
  const journalPath = join(dir, "meta", "_journal.json");
  if (existsSync(journalPath)) {
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const entries = Array.isArray(journal.entries) ? journal.entries : [];
    const fileSet = new Set(files);
    for (let i = 0; i < entries.length; i++) {
      const expected = `${entries[i].tag}.sql`;
      if (!fileSet.has(expected)) {
        errors.push(`Запись журнала ${entries[i].tag} не имеет SQL-файла ${expected}`);
      } else if (files[i] !== expected) {
        errors.push(`Порядок миграций разошёлся с _journal.json на позиции ${i}: файл ${files[i]}, журнал ${expected}`);
      }
    }
  }

  return { files, errors };
}

if (process.argv[1] && import.meta.url === new URL("file://" + resolve(process.argv[1])).href) {
  const { files, errors } = checkMigrations();
  if (errors.length) {
    console.error("Проверка миграций не пройдена:\n- " + errors.join("\n- "));
    process.exit(1);
  }
  console.log(`Миграции в порядке (${files.length} файлов, дубликатов сверх исторической пары 0010 нет).`);
}
