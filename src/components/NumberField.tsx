import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number | null | undefined;
  /** Вызывается с числом, либо с `null`, если поле очистили. */
  onValue: (value: number | null) => void;
  /** Ноль показывается пустым полем (виден placeholder), а не «0». */
  blankZero?: boolean;
  decimal?: boolean;
};

const format = (value: number | null | undefined, blankZero: boolean) =>
  value === null || value === undefined || (blankZero && value === 0) ? "" : String(value);

/**
 * Числовое поле, в которое можно печатать: текст хранится отдельно от числа,
 * поэтому «5» поверх нуля не превращается в «05», запятая работает как точка,
 * а при фокусе всё содержимое выделяется.
 */
export default function NumberField({ value, onValue, blankZero = false, decimal = true, onFocus, onBlur, ...rest }: Props) {
  const [text, setText] = useState(() => format(value, blankZero));
  const typed = useRef(false);

  useEffect(() => {
    // Внешнее значение сменилось (подстановка прошлого результата) — перерисовать текст.
    const parsed = text === "" || text === "." ? null : Number(text);
    const same = parsed === value || (blankZero && value === 0 && parsed === null);
    if (!same || !typed.current) setText(format(value, blankZero));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, blankZero]);

  return (
    <input
      {...rest}
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      value={text}
      onFocus={(e) => {
        e.currentTarget.select();
        onFocus?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(",", ".");
        const pattern = decimal ? /^\d*\.?\d*$/ : /^\d*$/;
        if (!pattern.test(raw)) return;
        typed.current = true;
        // Убираем ведущие нули: «05» → «5», но «0.5» остаётся.
        const clean = raw.replace(/^0+(?=\d)/, "");
        setText(clean);
        if (clean === "" || clean === ".") return onValue(null);
        const n = Number(clean);
        if (Number.isFinite(n)) onValue(n);
      }}
      onBlur={(e) => {
        typed.current = false;
        setText(format(value, blankZero));
        onBlur?.(e);
      }}
    />
  );
}
