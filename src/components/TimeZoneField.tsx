import { useEffect, useId, useRef } from "react";
import { TimeZoneChoices } from "../domain/TimeZoneChoices";
import { browserTimeZone, validTimeZone } from "../lib/calendar";

/**
 * Часовой пояс без знания IANA: список («Саратов, UTC+4») и «Определить автоматически».
 * Поле с идентификатором остаётся для редких поясов и для ввода с клавиатуры.
 */
export function TimeZoneField({
  label,
  name,
  value,
  onChange,
  required = true,
}: {
  label: string;
  name?: string;
  value: string;
  onChange: (zone: string) => void;
  required?: boolean;
}) {
  const detected = browserTimeZone();
  const listId = useId();
  const choices = TimeZoneChoices.list([value, detected]);
  const known = choices.some((choice) => choice.id === value);
  // Пустое поле — это «ещё не введено» (его ловит required), несуществующий пояс — ошибка под полем.
  const invalid = value.trim() !== "" && !validTimeZone(value.trim());
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.setCustomValidity(invalid ? "Такого часового пояса нет. Выбери из списка." : "");
  }, [invalid]);
  return (
    <div className="tz-field">
      <label>
        {label}
        <input
          ref={input}
          name={name}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${listId}-error` : undefined}
          value={value}
          list={listId}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          required={required}
        />
      </label>
      {invalid ? (
        <small className="form-error tz-error" id={`${listId}-error`} role="alert">
          Такого часового пояса нет: «{value.trim()}». Выбери из списка или нажми «Определить автоматически».
        </small>
      ) : null}
      <datalist id={listId}>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id} label={choice.label} />
        ))}
      </datalist>
      <label className="tz-pick">
        <span className="tiny">Или выбери из списка</span>
        <select aria-label="Выбрать пояс из списка" value={known ? value : ""} onChange={(e) => e.target.value && onChange(e.target.value)}>
          {!known ? <option value="">{value ? TimeZoneChoices.label(value) : "Не выбран"}</option> : null}
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <div className="tz-actions">
        {invalid ? <span /> : <small className="tiny">Сейчас: {TimeZoneChoices.label(value)}.</small>}
        <button type="button" className="text-button" onClick={() => onChange(detected)}>
          Определить автоматически ({TimeZoneChoices.label(detected)})
        </button>
      </div>
    </div>
  );
}
