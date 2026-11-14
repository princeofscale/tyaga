import { normalizeSearch } from "../lib/search";

/**
 * Порядок результатов поиска упражнений: по близости к запросу, а не по алфавиту.
 * 0 — название совпало с запросом целиком; 1 — все слова запроса есть в названии целыми словами
 * (чем меньше лишних слов, тем выше); 2 — название начинается с запроса; 3 — слова запроса — начала слов
 * названия; 4 — совпадение только по псевдонимам и обрывкам слов.
 * Внутри одной ступени проверенные записи идут раньше, затем более короткие названия.
 */
export type SearchRank = [tier: number, extraWords: number, notEditorial: number, length: number];

const words = (text: string) => normalizeSearch(text).split(" ").filter(Boolean);

export class ExerciseSearchRank {
  static rank(query: string, name: string, editorial = false): SearchRank {
    const wanted = words(query);
    const own = words(name);
    const length = own.join(" ").length;
    const notEditorial = editorial ? 0 : 1;
    if (!wanted.length) return [0, 0, notEditorial, length];
    const phrase = wanted.join(" ");
    const full = own.join(" ");
    const extraWords = Math.max(0, own.length - wanted.length);
    if (full === phrase) return [0, 0, notEditorial, length];
    if (wanted.every((token) => own.includes(token))) return [1, extraWords, notEditorial, length];
    if (full.startsWith(phrase)) return [2, extraWords, notEditorial, length];
    if (wanted.every((token) => own.some((word) => word.startsWith(token)))) return [3, extraWords, notEditorial, length];
    // Только псевдоним или обрывок слова: длина названия ничего не говорит о близости — оставляем алфавитный порядок.
    return [4, 0, notEditorial, 0];
  }

  static compare(a: SearchRank, b: SearchRank): number {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }

  /** Стабильная сортировка: одинаково близкие остаются в исходном порядке. */
  static sort<T>(items: T[], query: string, nameOf: (item: T) => string, editorialOf: (item: T) => boolean = () => false): T[] {
    if (!words(query).length) return items;
    return items
      .map((item, index) => ({ item, index, rank: this.rank(query, nameOf(item), editorialOf(item)) }))
      .sort((a, b) => this.compare(a.rank, b.rank) || a.index - b.index)
      .map((entry) => entry.item);
  }
}
