/**
 * Ввод чисел с клавиатуры в калькуляторах и полях веса.
 *
 * Пока человек печатает, поле хранит ровно набранный текст (точка или запятая); число считается из него,
 * а границы применяются к расчёту, а не к тексту: «7» на пути к «77,5» не превращается в минимум.
 * Показывается всегда десятичная запятая, как везде в приложении.
 */
export type DecimalBounds = { min: number; max: number; unit?: string };
export type DecimalReading = {
  /** Число, как набрано; `null`, если поле пустое или в нём ещё нет числа. */
  parsed: number | null;
  /** Число для расчёта: набранное в границах, иначе `null`. */
  value: number | null;
  /** Подсказка вместо подмены значения; `null`, если всё в порядке. */
  hint: string | null;
};

export class DecimalInput {
  /** Оставляет цифры и один разделитель; лишнее (буквы, пробелы, второй разделитель) отбрасывает. */
  static sanitize(text: string, decimals = 2): string {
    let out = "";
    let separator = false;
    let fraction = 0;
    for (const ch of text.replace(/\s/g, "")) {
      if (ch >= "0" && ch <= "9") {
        if (separator) {
          if (fraction >= decimals) continue;
          fraction++;
        }
        out += ch;
      } else if ((ch === "," || ch === ".") && !separator && decimals > 0) {
        separator = true;
        out += ch;
      }
    }
    return out.slice(0, 12);
  }

  /** «77,5», «77.5» и «77,» → число; пустое или «,» → `null`. */
  static parse(text: string): number | null {
    const clean = text.trim().replace(",", ".");
    if (!/^\d+(\.\d*)?$|^\.\d+$/.test(clean)) return null;
    const value = Number(clean);
    return Number.isFinite(value) ? value : null;
  }

  /** Число для показа: десятичная запятая, до двух знаков, без лишних нулей (`28,75`, `80,6`, `100`). */
  static format(value: number, decimals = 2): string {
    if (!Number.isFinite(value)) return "";
    const rounded = Math.round(value * 10 ** decimals) / 10 ** decimals;
    return String(rounded).replace(".", ",");
  }

  static read(text: string, bounds: DecimalBounds): DecimalReading {
    const parsed = DecimalInput.parse(text);
    if (parsed === null) return { parsed: null, value: null, hint: text.trim() ? "Введи число, например 77,5" : "Введи значение" };
    const unit = bounds.unit ? ` ${bounds.unit}` : "";
    if (parsed < bounds.min)
      return { parsed, value: bounds.min, hint: `Минимум ${DecimalInput.format(bounds.min)}${unit}: считаю для него` };
    if (parsed > bounds.max)
      return { parsed, value: bounds.max, hint: `Максимум ${DecimalInput.format(bounds.max)}${unit}: считаю для него` };
    return { parsed, value: parsed, hint: null };
  }
}
