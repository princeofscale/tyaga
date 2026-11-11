/** Форма существительного по числу: [«тренировка», «тренировки», «тренировок»]. Дроби и отрицательные — «много». */
export function pluralRu(count: number, forms: readonly [one: string, few: string, many: string]): string {
  if (!Number.isInteger(count)) return forms[2];
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return forms[2];
  if (units === 1) return forms[0];
  if (units >= 2 && units <= 4) return forms[1];
  return forms[2];
}
