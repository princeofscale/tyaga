import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Reproducible, offline adaptation. Source release and published adaptations stay immutable.
const source = JSON.parse(await readFile("data/wger/catalog-v1.json", "utf8"));
const translations = JSON.parse(
  await readFile("data/localization/wger-ru-instructions-v1.json", "utf8"),
);
const names = new Map(
  (await readFile("data/localization/wger-ru-names.tsv", "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const [id, name, ...aliases] = line.split("|");
      return [Number(id), { name, aliases }];
    }),
);
if (
  names.size !== source.count ||
  Object.keys(translations).length !== source.count
)
  throw new Error("Incomplete Russian localization");
const categories = {
  Abs: "Пресс",
  Arms: "Руки",
  Back: "Спина",
  Calves: "Икры",
  Chest: "Грудь",
  Legs: "Ноги",
  Shoulders: "Плечи",
  Cardio: "Кардио",
};
const equipment = {
  1: "Штанга",
  2: "EZ-гриф",
  3: "Гантель",
  4: "Гимнастический коврик",
  5: "Гимнастический мяч",
  6: "Турник",
  7: "Без оборудования",
  8: "Скамья",
  9: "Наклонная скамья",
  10: "Гиря",
  11: "Резинка",
  12: "Блочный тренажёр",
};
const muscles = {
  1: "Двуглавая мышца плеча",
  2: "Передняя дельтовидная мышца",
  3: "Передняя зубчатая мышца",
  4: "Большая грудная мышца",
  5: "Трёхглавая мышца плеча",
  6: "Прямая мышца живота",
  7: "Икроножная мышца",
  8: "Большая ягодичная мышца",
  9: "Трапециевидная мышца",
  10: "Четырёхглавая мышца бедра",
  11: "Двуглавая мышца бедра",
  12: "Широчайшая мышца спины",
  13: "Плечевая мышца",
  14: "Наружная косая мышца живота",
  15: "Камбаловидная мышца",
};
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const exercises = source.exercises.map((row) => {
  const ru = names.get(row.sourceId);
  if (
    !ru?.name ||
    !/[а-яё]/i.test(ru.name) ||
    !ru.aliases.length ||
    translations[row.sourceId] === undefined
  )
    throw new Error("Invalid translation: " + row.sourceId);
  const record = {
    ...row,
    name: ru.name,
    language: "ru",
    instructions: translations[row.sourceId],
    recordType: row.loggable ? "reps" : "duration",
    loggable: row.sourceId !== 1114,
    aliases: [
      ...new Set(
        [...ru.aliases, row.nameEn, row.name, ...row.aliases].filter(
          (a) => a && a !== ru.name,
        ),
      ),
    ],
    category: categories[row.category] ?? row.category,
    equipment: row.equipment.map((e) => ({
      ...e,
      name: equipment[e.id] ?? e.name,
    })),
    muscles: row.muscles.map((m) => ({ ...m, name: muscles[m.id] ?? m.name })),
    secondaryMuscles: row.secondaryMuscles.map((m) => ({
      ...m,
      name: muscles[m.id] ?? m.name,
    })),
    localization: {
      version: "tyaga-ru-1",
      sourceLanguage: row.language,
      sourceName: row.name,
      sourceInstructions: row.instructions,
      names: "editorial-ai-assisted",
      instructions: "machine-translation",
      scientificReview: false,
    },
    adaptation:
      "Русская адаптация Тяги: названия и поисковые алиасы составлены редакционно с помощью ИИ, описания переведены машинно из исходного текста wger. Научная проверка техники и мышц не проводилась. Лицензия и авторство исходной записи сохранены; перевод следует той же лицензии. Медиа не импортированы.",
  };
  delete record.id;
  delete record.contentHash;
  const contentHash = hash(record);
  return { ...record, contentHash, id: `wger:${row.sourceId}:${contentHash}` };
});
const output = {
  ...source,
  release: `wger-ru-${hash(exercises.map((e) => e.contentHash))}`,
  localizationVersion: "tyaga-ru-1",
  exercises,
};
await writeFile(
  "data/wger/catalog-v2-ru.json",
  JSON.stringify(output, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    release: output.release,
    count: exercises.length,
    russianCount: exercises.filter((e) => e.language === "ru").length,
    withAliases: exercises.filter((e) => e.aliases.length > 0).length,
  }),
);
