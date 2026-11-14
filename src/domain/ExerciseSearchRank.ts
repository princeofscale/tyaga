import { normalizeSearch } from "../lib/search";

/**
 * Порядок результатов поиска упражнений: по близости к запросу, а не по алфавиту.
 * 0 — название совпало с запросом целиком; 1 — все слова запроса есть в названии целыми словами и название
 * ими начинается (чем меньше лишних слов, тем выше); 2 — название начинается с запроса («присед» → «Приседания…»);
 * 3 — слова запроса есть целыми словами, но не в начале названия («Обратный V-присед»); 4 — слова запроса — начала
 * слов названия; 5 — совпадение только по псевдонимам и обрывкам слов.
 * Внутри одной ступени при равном числе лишних слов базовые движения (основные лифты со штангой) идут раньше,
 * затем проверенные записи, затем более короткие названия.
 */
export type SearchRank = [tier: number, extraWords: number, notProminent: number, notEditorial: number, length: number];

const words = (text: string) => normalizeSearch(text).split(" ").filter(Boolean);

export class ExerciseSearchRank {
  static rank(query: string, name: string, editorial = false, prominent = false): SearchRank {
    const wanted = words(query);
    const own = words(name);
    const length = own.join(" ").length;
    const notEditorial = editorial ? 0 : 1, notProminent = prominent ? 0 : 1;
    if (!wanted.length) return [0, 0, notProminent, notEditorial, length];
    const phrase = wanted.join(" ");
    const full = own.join(" ");
    const extraWords = Math.max(0, own.length - wanted.length);
    if (full === phrase) return [0, 0, notProminent, notEditorial, length];
    if (wanted.every((token) => own.includes(token))) {
      const leads = wanted.some((token) => own[0]?.startsWith(token));
      return [leads ? 1 : 3, extraWords, notProminent, notEditorial, length];
    }
    if (full.startsWith(phrase)) return [2, extraWords, notProminent, notEditorial, length];
    if (wanted.every((token) => own.some((word) => word.startsWith(token)))) return [4, extraWords, notProminent, notEditorial, length];
    // Только псевдоним или обрывок слова: длина названия ничего не говорит о близости — оставляем алфавитный порядок.
    return [5, 0, 1, notEditorial, 0];
  }

  static compare(a: SearchRank, b: SearchRank): number {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }

  /** Стабильная сортировка: одинаково близкие остаются в исходном порядке. */
  static sort<T>(items: T[], query: string, nameOf: (item: T) => string, editorialOf: (item: T) => boolean = () => false, prominentOf: (item: T) => boolean = () => false): T[] {
    if (!words(query).length) return items;
    return items
      .map((item, index) => ({ item, index, rank: this.rank(query, nameOf(item), editorialOf(item), prominentOf(item)) }))
      .sort((a, b) => this.compare(a.rank, b.rank) || a.index - b.index)
      .map((entry) => entry.item);
  }
}
