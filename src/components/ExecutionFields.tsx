import type { ExecutionProfile } from "../lib/types";
import Select from "./Select";
export default function ExecutionFields({
  value = {},
  onChange,
  label = "Выполнение",
}: {
  value?: ExecutionProfile;
  onChange: (value: ExecutionProfile) => void;
  label?: string;
}) {
  return (
    <details className="execution-fields">
      <summary>{label}: амплитуда, хват и углы</summary>
      <div className="execution-grid">
        <label>
          Амплитуда
          <Select
            aria-label={`${label}: амплитуда`}
            value={value.rom ?? ""}
            onChange={(rom) =>
              onChange({
                ...value,
                rom: rom ? (rom as ExecutionProfile["rom"]) : undefined,
              })
            }
            options={[
              { value: "", label: "Не указана" },
              { value: "full", label: "Полная" },
              {
                value: "lengthened_partial",
                label: "Частичная в растянутой позиции",
              },
              {
                value: "shortened_partial",
                label: "Частичная в сокращённой позиции",
              },
              { value: "custom", label: "Своя амплитуда" },
            ]}
          />
        </label>
        {(
          [
            ["grip", "Хват"],
            ["stance", "Стойка"],
            ["attachment", "Рукоять"],
            ["tempo", "Темп"],
          ] as const
        ).map(([key, title]) => (
          <label key={key}>
            {title}
            <input
              aria-label={`${label}: ${title}`}
              maxLength={80}
              value={value[key] ?? ""}
              onChange={(e) =>
                onChange({ ...value, [key]: e.target.value || undefined })
              }
            />
          </label>
        ))}
        {(
          [
            ["benchAngle", "Угол скамьи", -90, 90],
            ["torsoAngle", "Угол корпуса", -180, 180],
            ["startAngle", "Начальный угол", 0, 180],
            ["endAngle", "Конечный угол", 0, 180],
          ] as const
        ).map(([key, title, min, max]) => (
          <label key={key}>
            {title}, °
            <input
              aria-label={`${label}: ${title}`}
              type="number"
              min={min}
              max={max}
              step="1"
              value={value[key] ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  [key]:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      <p className="tiny">
        Параметры разделяют серии прогресса. Они не превращаются в коэффициент
        роста мышц.
      </p>
    </details>
  );
}
