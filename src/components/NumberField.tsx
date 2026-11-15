import { useEffect, useId, useState } from "react";
import { DecimalInput, type DecimalBounds } from "../domain/DecimalInput";

/**
 * Поле числа для калькуляторов: хранит ровно набранный текст, расчёт получает число в границах.
 * Пустое или неполное значение допустимо, пока человек печатает; на выходе из поля текст приводится
 * к числу в границах с десятичной запятой.
 */
export function NumberField({
  value,
  onValue,
  bounds,
  decimals = 2,
  label,
  unit,
  className,
}: {
  /** Число, по которому сейчас считает калькулятор. */
  value: number;
  /** Вызывается на каждом наборе, где в поле есть число (уже в границах). */
  onValue: (value: number) => void;
  bounds: DecimalBounds;
  decimals?: number;
  label: string;
  unit?: string;
  className?: string;
}) {
  const hintId = useId();
  const [text, setText] = useState(() => DecimalInput.format(value, decimals));
  // Значение изменили снаружи («+», готовые числа): поле показывает его, но не мешает набору.
  useEffect(() => {
    const typed = DecimalInput.read(text, bounds).value;
    if (typed !== value) setText(DecimalInput.format(value, decimals));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const reading = DecimalInput.read(text, bounds);
  return (
    <span className="number-field">
      <input
        className={className}
        type="text"
        inputMode={decimals ? "decimal" : "numeric"}
        autoComplete="off"
        aria-label={label}
        aria-describedby={reading.hint ? hintId : undefined}
        aria-invalid={reading.hint ? true : undefined}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const next = DecimalInput.sanitize(e.target.value, decimals);
          setText(next);
          const read = DecimalInput.read(next, bounds);
          if (read.value !== null) onValue(read.value);
        }}
        onBlur={() => setText(DecimalInput.format(value, decimals))}
      />
      {unit ? <span className="unit-label">{unit}</span> : null}
      {reading.hint ? (
        <small className="field-hint" id={hintId} role="status">
          {reading.hint}
        </small>
      ) : null}
    </span>
  );
}
