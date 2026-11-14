import { normalizeSearch } from "../lib/search";

/**
 * Порядок результатов поиска упражнений: по близости к запросу, а не по алфавиту.
 * 0 — название совпало с запросом целиком; 1 — все слова запроса есть в названии целыми словами и название
 * ими начинается (чем меньше лишних слов, тем выше); 2 — название начинается с запроса («присед» → «Приседания…»);
 * 3 — слова запроса есть целыми словами, но не в начале названия («Обратный V-присед»); 4 — слова запроса — начала
 * слов названия; 5 — совпадение только по псевдонимам и обрывкам слов.
 * Короткий общий запрос из одного слова («присед», «тяга», «жим») сначала собирает основные штанговые движения, затем проверенные базовые упражнения
 * и те, что пользователь уже делал, затем названия, которые начинаются с запроса, с наименьшим числом лишних слов
 * («Приседания» выше «Присед на ящик одной ногой»), и только потом — всё остальное; для запросов из нескольких слов («жим лёжа»)
 * порядок прежний. Внутри одной ступени при равном числе лишних слов базовые движения (основные лифты со штангой) идут раньше,
 * затем проверенные записи, затем более короткие названия.
 */
export type SearchRank = number[];

const words = (text: string) => normalizeSearch(text).split(" ").filter(Boolean);

export class ExerciseSearchRank {
  static rank(query: string, name: string, editorial = false, prominent = false, preferred = false, core = false): SearchRank {
    const wanted = words(query);
    const own = words(name);
    const length = own.join(" ").length;
    const notEditorial = editorial ? 0 : 1, notProminent = prominent ? 0 : 1;
    const outsider = wanted.length === 1 && !(editorial || preferred) ? 1 : 0;
    if (!wanted.length) return [outsider, 0, 0, notProminent, notEditorial, length, 0, 0];
    const phrase = wanted.join(" ");
    const full = own.join(" ");
    const extraWords = Math.max(0, own.length - wanted.length);
    let tier: number;
    if (full === phrase) tier = 0;
    else if (wanted.every((token) => own.includes(token))) tier = wanted.some((token) => own[0]?.startsWith(token)) ? 1 : 3;
    else if (full.startsWith(phrase)) tier = 2;
    else if (wanted.every((token) => own.some((word) => word.startsWith(token)))) tier = 4;
    else tier = 5;
    // Только псевдоним или обрывок слова: длина названия ничего не говорит о близости — оставляем алфавитный порядок.
    if (tier === 5) return wanted.length === 1 ? [2, outsider, 5, 1, notEditorial, 0, 0, 0] : [outsider, 5, 0, 1, notEditorial, 0, 0, 0];
    // Общее слово («присед»): простое «Приседания» выше экзотики «Присед на ящик одной ногой» — сначала проверенные
    // базовые, потом число лишних слов, и только затем ступень совпадения.
    if (wanted.length === 1) return [core ? 0 : 1, outsider, notProminent, tier <= 2 ? 0 : 1, extraWords, tier, notEditorial, length];
    return [outsider, tier, extraWords, notProminent, notEditorial, length, 0, 0];
  }

  static compare(a: SearchRank, b: SearchRank): number {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }

  /**
   * Основное движение в чужом каталоге: его название — начало названия одного из основных штанговых движений
   * приложения («Становая тяга» → «Становая тяга со штангой», «Приседания» → «Приседания со штангой»).
   */
  /** Основное штанговое движение приложения (проверенное, 1ПМ считается, в названии — штанга). */
  static isCore(exercise: { name: string; recording: { e1rmEligible?: boolean } }): boolean {
    return exercise.recording.e1rmEligible === true && /штанг/i.test(exercise.name);
  }

  static isBasic(name: string, basics: readonly string[]): boolean {
    const own = words(name).join(" ");
    return !!own && basics.some((basic) => basic === own || basic.startsWith(own + " "));
  }

  /** Стабильная сортировка: одинаково близкие остаются в исходном порядке. */
  static sort<T>(items: T[], query: string, nameOf: (item: T) => string, editorialOf: (item: T) => boolean = () => false, prominentOf: (item: T) => boolean = () => false, preferredOf: (item: T) => boolean = () => false, coreOf: (item: T) => boolean = () => false): T[] {
    if (!words(query).length) return items;
    return items
      .map((item, index) => ({ item, index, rank: this.rank(query, nameOf(item), editorialOf(item), prominentOf(item), preferredOf(item), coreOf(item)) }))
      .sort((a, b) => this.compare(a.rank, b.rank) || a.index - b.index)
      .map((entry) => entry.item);
  }
}
