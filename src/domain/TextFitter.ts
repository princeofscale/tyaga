/** Ширина строки в пикселях для заданного шрифта. На canvas это `ctx.font = font; ctx.measureText(text).width`. */
export type MeasureText = (font: string, text: string) => number;

/** Подгонка текста под ширину. Сама ничего не рисует и не знает про canvas, поэтому проверяется обычными тестами. */
export class TextFitter {
  constructor(private readonly measure: MeasureText) {}

  /** Уменьшает кегль шагом 2, пока строка не поместится в `maxWidth`. Ниже `min` не опускается. */
  fitSize(text: string, maxWidth: number, start: number, min: number, fontAt: (size: number) => string): number {
    let size = start;
    while (size > min && this.measure(fontAt(size), text) > maxWidth) size = Math.max(min, size - 2);
    return size;
  }

  /** Обрезает с конца и ставит многоточие, пока строка не поместится. Хотя бы одна буква остаётся всегда. */
  ellipsize(text: string, maxWidth: number, font: string): string {
    if (this.measure(font, text) <= maxWidth) return text;
    let cut = text;
    while (cut.length > 1 && this.measure(font, cut + "…") > maxWidth) cut = cut.slice(0, -1);
    return cut.trimEnd() + "…";
  }
}
