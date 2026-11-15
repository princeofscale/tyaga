import { EXERCISES } from "../lib/catalog";
import { normalizeSearch } from "../lib/search";
import type { Exercise } from "../lib/types";
import { ImportMapping } from "./ImportMapping";
import type { ImportPreview } from "./WorkoutImport";

/**
 * Что решено про название упражнения из чужого файла:
 * - `matched` — это упражнение каталога, спрашивать не нужно;
 * - `variant` — близкий вариант того же движения, применяем, но показываем в отдельном блоке «проверь»;
 * - `ask` — есть похожие, но уверенности нет: предпросмотр предлагает варианты и спрашивает;
 * - `own` — в каталоге ничего похожего, остаётся отдельной записью («Моя»).
 */
export type NameVerdict = {
  source: string;
  kind: "matched" | "variant" | "ask" | "own";
  exercise: Exercise | null;
  candidates: Exercise[];
  /** «Machine», «Cable» и т.п. из скобок названия, как в файле. */
  equipment: string | null;
  /** `ask` с уверенным, но не тем же движением предложением (Sumo Deadlift → становая): можно принять одним касанием. */
  related?: boolean;
};

type Rule = {
  id: string;
  /** Названия без оборудования: «Lat Pulldown», «Pull Up»… */
  names: string[];
  /** Допустимое оборудование из скобок; пусто — подходит любое и его отсутствие. */
  equipment?: string[];
  /** Если оборудования в названии нет, правило всё равно подходит (для движений с собственным весом). */
  bare?: boolean;
  variant?: boolean;
  /** Другое движение, лишь похожее на упражнение каталога: не применяется молча, а предлагается («близкое»). */
  related?: boolean;
};

const BAR = ["barbell"];
const DB = ["dumbbell"];
const CABLE = ["cable", "machine"];

/**
 * Названия Strong, Hevy и FitNotes → каталог. Правила явные: «Overhead Press (Dumbbell)» не превращается в штанговый
 * жим, а голое «Deadlift» без оборудования только предлагается (см. `classify`).
 */
const RULES: Rule[] = [
  { id: "bench", names: ["bench press", "flat bench press"], equipment: BAR },
  { id: "incline-bar", names: ["incline bench press", "incline press"], equipment: BAR },
  { id: "incline-db", names: ["incline bench press", "incline press", "incline dumbbell press"], equipment: DB, bare: false },
  { id: "flat-db-press", names: ["bench press", "dumbbell bench press", "flat dumbbell press"], equipment: DB },
  { id: "ohp-bar", names: ["overhead press", "shoulder press", "military press", "standing overhead press"], equipment: BAR },
  { id: "ohp", names: ["overhead press", "shoulder press", "seated shoulder press"], equipment: DB },
  { id: "ohp", names: ["arnold press"], equipment: DB, variant: true, related: true },
  { id: "shoulder-press-machine", names: ["shoulder press", "overhead press"], equipment: ["machine", "machine plate loaded"] },
  { id: "squat", names: ["squat", "back squat"], equipment: BAR },
  { id: "legpress", names: ["leg press", "leg press horizontal"], equipment: ["machine", "plate loaded", "sled"], bare: true },
  { id: "goblet", names: ["goblet squat"], equipment: ["kettlebell", "dumbbell"], bare: true },
  { id: "body-squat", names: ["air squat", "bodyweight squat"], equipment: ["bodyweight"], bare: true },
  { id: "rdl", names: ["romanian deadlift", "rdl"], equipment: BAR },
  { id: "db-rdl", names: ["romanian deadlift", "rdl"], equipment: DB },
  { id: "deadlift-bar", names: ["deadlift", "conventional deadlift"], equipment: BAR },
  { id: "deadlift-bar", names: ["sumo deadlift"], equipment: BAR, variant: true, related: true },
  { id: "row-bent-bar", names: ["bent over row", "barbell row", "bent over barbell row"], equipment: BAR, bare: true },
  { id: "row-bent-bar", names: ["pendlay row"], equipment: BAR, variant: true },
  { id: "row", names: ["seated row", "seated cable row", "cable row"], equipment: CABLE, bare: true },
  { id: "db-row", names: ["one arm row", "single arm row", "dumbbell row", "bent over one arm row"], equipment: DB, bare: true },
  { id: "lat-pulldown", names: ["lat pulldown", "wide grip lat pulldown"], equipment: CABLE, bare: true },
  { id: "pulldown-reverse", names: ["reverse grip lat pulldown", "underhand lat pulldown"], bare: true },
  { id: "pullup", names: ["pull up", "pullup", "pull ups", "pull-up"], equipment: ["bodyweight"], bare: true },
  { id: "pullup", names: ["chin up", "chinup", "chin ups"], equipment: ["bodyweight"], bare: true, variant: true, related: true },
  { id: "pullup-weighted", names: ["pull up", "pullup"], equipment: ["weighted"] },
  { id: "pullup-assisted", names: ["pull up", "pullup", "assisted pull up"], equipment: ["assisted"], bare: true },
  { id: "pushup", names: ["push up", "pushup", "push ups"], equipment: ["bodyweight"], bare: true },
  { id: "lateral", names: ["lateral raise", "side lateral raise"], equipment: DB },
  { id: "lateral-cable-single", names: ["lateral raise", "single arm lateral raise"], equipment: ["cable"] },
  { id: "facepull-er", names: ["face pull"], equipment: ["cable", "band", "machine"], bare: true },
  { id: "curl", names: ["bicep curl", "biceps curl", "dumbbell curl"], equipment: DB, bare: false },
  { id: "hammer", names: ["hammer curl"], equipment: DB, bare: true },
  { id: "curl-bar", names: ["bicep curl", "biceps curl", "curl"], equipment: BAR },
  { id: "curl-incline-db", names: ["incline curl", "incline bicep curl", "seated incline curl"], equipment: DB, bare: true },
  { id: "curl-preacher-ez", names: ["preacher curl"], equipment: ["ez bar", "ez curl bar"], bare: false },
  { id: "curl-preacher-ez", names: ["preacher curl"], equipment: ["barbell", "dumbbell", "machine"], variant: true },
  { id: "triceps-push", names: ["triceps pushdown", "tricep pushdown", "triceps push down", "pushdown"], equipment: ["cable", "machine"], bare: true },
  { id: "extension-overhead-cable", names: ["overhead triceps extension", "triceps extension", "rope overhead triceps extension"], equipment: ["cable"] },
  { id: "skullcrusher-ez", names: ["skullcrusher", "skull crusher", "lying triceps extension"], equipment: ["ez bar", "ez curl bar"] },
  { id: "skullcrusher-ez", names: ["skullcrusher", "skull crusher", "lying triceps extension"], equipment: ["barbell", "dumbbell"], variant: true, related: true },
  { id: "fly", names: ["chest fly", "cable fly", "cable crossover", "crossover"], equipment: ["cable"] },
  { id: "fly", names: ["pec deck", "chest fly", "butterfly"], equipment: ["machine"], bare: true, variant: true, related: true },
  { id: "rear-delt-fly", names: ["rear delt fly", "rear delt reverse fly", "reverse fly"], equipment: ["machine"], bare: true },
  { id: "barbell-hip-thrust", names: ["hip thrust"], equipment: BAR },
  { id: "glute-bridge", names: ["glute bridge"], equipment: ["bodyweight"], bare: true },
  { id: "calf-standing-machine", names: ["calf raise", "standing calf raise", "calf press"], equipment: ["machine"] },
  { id: "calf-standing-machine", names: ["standing calf raise", "calf raise"], equipment: ["smith machine", "smith"], variant: true },
  { id: "calf-seated", names: ["seated calf raise"], equipment: ["machine"], bare: true },
  { id: "crunch", names: ["crunch", "crunches"], equipment: ["bodyweight"], bare: true },
  { id: "ab-roller", names: ["ab wheel", "ab wheel rollout", "ab roller", "rollout"], bare: true },
  { id: "hanging-leg-raise", names: ["hanging leg raise", "leg raise hanging", "hanging knee raise"], bare: true },
  { id: "leg-extension", names: ["leg extension"], bare: true },
  { id: "legcurl-seated", names: ["seated leg curl"], bare: true },
  { id: "legcurl-prone", names: ["lying leg curl", "prone leg curl"], bare: true },
  { id: "bulgarian-split-squat", names: ["bulgarian split squat"], equipment: DB, bare: true },
  { id: "back-extension", names: ["back extension", "hyperextension", "back hyperextension"], bare: true },
  { id: "shrug-bar", names: ["shrug"], equipment: BAR },
  { id: "shrug-db-incline", names: ["shrug"], equipment: DB, variant: true, related: true },
  { id: "pullover-cable", names: ["pullover", "straight arm pulldown"], equipment: ["cable"] },
  { id: "woodchopper-cable", names: ["woodchopper", "wood chop"], equipment: ["cable"], bare: true },
];

/** Упражнение «только вес тела» не принимает внешний вес; если он в файле есть, берём родственное «с дополнительным весом». */
const WEIGHTED_SIBLING: Record<string, string> = { pullup: "pullup-weighted" };

const STOP = new Set(["the", "a", "an", "of", "with", "on", "to", "and", "up"]);
const EQUIPMENT_WORDS = new Set([
  "barbell", "dumbbell", "dumbbells", "cable", "machine", "smith", "kettlebell", "bodyweight", "band", "ez", "bar", "plate", "loaded",
]);

/** «Lat Pulldown (Cable)» → «lat pulldown» + «cable»; без скобок оборудование пусто. */
function split(name: string) {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name.trim());
  return m
    ? { base: normalizeSearch(m[1]), equipment: normalizeSearch(m[2]), equipmentText: m[2].trim() }
    : { base: normalizeSearch(name), equipment: "", equipmentText: null as string | null };
}

const stem = (word: string) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word);

export class ImportNameMatcher {
  private static byId = new Map(EXERCISES.map((e) => [e.id, e]));
  private static index: Map<string, Rule[]> | null = null;

  private static rules() {
    if (!this.index) {
      this.index = new Map();
      for (const rule of RULES)
        for (const name of rule.names) {
          const key = normalizeSearch(name);
          this.index.set(key, [...(this.index.get(key) ?? []), rule]);
        }
    }
    return this.index;
  }

  /** Правило таблицы для этого названия: оборудование должно совпасть, а не «примерно подойти». */
  private static byRule(sourceName: string) {
    const { base, equipment } = split(sourceName);
    const rules = this.rules().get(base) ?? [];
    const fits = (rule: Rule) =>
      equipment
        ? !rule.equipment || rule.equipment.includes(equipment)
        : rule.bare === true || (!rule.equipment && rule.bare !== false);
    return rules.find((r) => !r.variant && fits(r)) ?? rules.find((r) => r.variant && fits(r)) ?? null;
  }

  /** Ближайшие по словам упражнения каталога: показываем, когда однозначного ответа нет. */
  static nearest(sourceName: string, limit = 3): Exercise[] {
    const { base } = split(sourceName);
    const tokens = base
      .split(" ")
      .filter((t) => t && !STOP.has(t) && !EQUIPMENT_WORDS.has(t))
      .map(stem);
    if (!tokens.length) return [];
    const scored = EXERCISES.map((e) => {
      const words = new Set(
        [e.nameEn, ...(e.aliases ?? [])].flatMap((a) => normalizeSearch(a).split(" ")).map(stem),
      );
      const hit = tokens.filter((t) => words.has(t)).length;
      return { e, score: hit / tokens.length, hit };
    })
      .filter((s) => s.hit >= 1 && s.score >= 0.5)
      .sort((a, b) => b.score - a.score || b.hit - a.hit);
    return scored.slice(0, limit).map((s) => s.e);
  }

  /** Сопоставление одного названия. `wger` — точные совпадения из базы (ответ сервера `resolve`). */
  static classify(sourceName: string, wger: Exercise[] = [], weighted = false): NameVerdict {
    const verdict = this.classifyName(sourceName, wger);
    const head = verdict.exercise ?? (verdict.related ? verdict.candidates[0] : undefined);
    const sibling = weighted && head?.recording.loadMode === "bodyweight" ? this.byId.get(WEIGHTED_SIBLING[head.id] ?? "") : undefined;
    if (!sibling) return verdict;
    const candidates = [sibling, ...verdict.candidates.filter((c) => c.id !== sibling.id)];
    return verdict.exercise ? { ...verdict, exercise: sibling, candidates } : { ...verdict, candidates };
  }

  private static classifyName(sourceName: string, wger: Exercise[] = []): NameVerdict {
    const { equipmentText } = split(sourceName);
    const done = (kind: NameVerdict["kind"], exercise: Exercise | null, candidates: Exercise[] = []): NameVerdict => ({
      source: sourceName,
      kind,
      exercise,
      candidates: exercise ? [exercise, ...candidates.filter((c) => c.id !== exercise.id)] : candidates,
      equipment: equipmentText,
    });
    const rule = this.byRule(sourceName);
    const ruled = rule ? this.byId.get(rule.id) : undefined;
    if (rule && ruled && rule.related) return { ...done("ask", null, [ruled]), related: true };
    if (rule && ruled) return done(rule.variant ? "variant" : "matched", ruled);
    // Точное имя/синоним каталога с указанным оборудованием — как и раньше, без вопросов.
    const exact = ImportMapping.suggestForImport(sourceName);
    if (exact) return done("matched", exact);
    // Точное совпадение в базе упражнений: берём, если оно одно (или первое — из ядра).
    const base = wger.filter((e) => e.source || e.id.startsWith("wger:") || this.byId.has(e.id));
    if (base.length === 1 || (base.length && this.byId.has(base[0].id)))
      return done("matched", base[0], base.slice(1));
    const generic = ImportMapping.suggest(sourceName);
    const near = this.nearest(sourceName);
    const candidates = [...new Map([...(generic ? [generic] : []), ...base, ...near].map((e) => [e.id, e])).values()].slice(0, 4);
    return candidates.length ? done("ask", null, candidates) : done("own", null);
  }

  static classifyAll(names: string[], wger: Record<string, Exercise[]> = {}, weighted: Set<string> = new Set()) {
    return Object.fromEntries(names.map((n) => [n, this.classify(n, wger[n] ?? [], weighted.has(n))]));
  }

  /** Названия, у которых в файле есть ненулевой вес, и самый большой из них. */
  static weights(preview: ImportPreview) {
    const max = new Map<string, number>();
    for (const w of preview.workouts)
      for (const e of w.exercises)
        for (const set of e.sets) if (set.weight > 0) max.set(e.sourceName, Math.max(max.get(e.sourceName) ?? 0, set.weight));
    return max;
  }

  /** Выбранные «только вес тела» упражнения, у которых в файле есть внешний вес: он не записывается, но не теряется молча. */
  static droppedWeights(preview: ImportPreview, choiceFor: (name: string) => string, find: (id: string) => Exercise | undefined) {
    const out: { name: string; kg: number }[] = [];
    for (const [name, kg] of this.weights(preview)) {
      const chosen = choiceFor(name) ? find(choiceFor(name)) : undefined;
      if (chosen && chosen.recording.loadMode === "bodyweight") out.push({ name, kg });
    }
    return out;
  }

  /** Тип записи каждого названия в файле: «повторы» или «время». */
  static types(preview: ImportPreview) {
    const out = new Map<string, "reps" | "duration">();
    for (const w of preview.workouts) for (const e of w.exercises) if (!out.has(e.sourceName)) out.set(e.sourceName, e.type);
    return out;
  }

  /** Упражнение можно подставить, только если тип записи совпадает: «Планка» (время) не принимает повторы из файла. */
  static usable(exercise: Exercise | undefined, type: "reps" | "duration" | undefined) {
    return !exercise || !type || (exercise.recording.type ?? "reps") === type;
  }

  /** «Сопоставлено N из M · нужно решить K»: выбор пользователя считается решением. */
  static summary(
    verdicts: Record<string, NameVerdict>,
    choices: Record<string, string> = {},
    names: string[] = Object.keys(verdicts),
  ) {
    let matched = 0;
    let toDecide = 0;
    let own = 0;
    for (const name of names) {
      const verdict = verdicts[name];
      const chosen = choices[name];
      if (chosen) matched++;
      else if (name in choices) own++; // явно «отдельной записью»
      else if (verdict?.kind === "matched" || verdict?.kind === "variant") matched++;
      else if (verdict?.kind === "ask") toDecide++;
      else own++;
    }
    return { total: names.length, matched, toDecide, own };
  }

  /** Подпись автоматической метки тренажёра: нужна, чтобы сопоставленный блок/тренажёр не требовал ручного ввода. */
  static machineLabel(verdict: NameVerdict | undefined) {
    return verdict?.equipment ? `Из файла (${verdict.equipment})`.slice(0, 120) : "Из файла";
  }

  /**
   * Предпросмотр → то, что уйдёт на сервер: выбранное упражнение каталога подставляется в каждую запись.
   * Тренажёр/блок из чужого файла не угадать, поэтому метка по умолчанию — «Из файла (Machine)»: записи не смешиваются
   * с чужим стеком, а свою метку можно вписать вручную.
   */
  static prepare(
    preview: ImportPreview,
    o: {
      choiceFor: (name: string) => string;
      find: (id: string) => Exercise | undefined;
      verdicts: Record<string, NameVerdict>;
      machines?: Record<string, string>;
      sides?: Record<string, "both" | "left" | "right">;
    },
  ): ImportPreview {
    if (preview.format === "tyaga") return preview;
    return {
      ...preview,
      workouts: preview.workouts.map((w) => ({
        ...w,
        exercises: w.exercises.map((e) => {
          const id = o.choiceFor(e.sourceName);
          const chosen = id ? o.find(id) : undefined;
          if (!chosen || (chosen.recording.type ?? "reps") !== e.type) return e;
          const needsLabel = ["machine_stack", "assisted_bodyweight"].includes(chosen.recording.loadMode);
          const typed = o.machines?.[e.sourceName]?.trim();
          const bodyOnly = chosen.recording.loadMode === "bodyweight";
          const extra = bodyOnly ? Math.max(0, ...e.sets.map((set) => set.weight)) : 0;
          return {
            ...e,
            exerciseId: chosen.id,
            displayName: chosen.name,
            catalogRevision: chosen.catalogRevision,
            equipmentNote: needsLabel
              ? typed || this.machineLabel(o.verdicts[e.sourceName])
              : typed || (extra > 0 ? `Доп. вес в файле до ${extra} кг не учтён`.slice(0, 120) : undefined),
            ...(chosen.recording.laterality === "unilateral"
              ? { performedSides: o.sides?.[e.sourceName] ?? ("both" as const) }
              : {}),
            sets: e.sets.map((set) => ({
              ...set,
              ...(chosen.recording.loadMode === "assisted_bodyweight" ? { assistanceKg: set.weight, weight: 0 } : {}),
              ...(bodyOnly ? { weight: 0 } : {}),
            })),
          };
        }),
      })),
    };
  }
}
