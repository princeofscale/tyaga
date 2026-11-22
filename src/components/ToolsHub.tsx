import {
  Dumbbell,
  Flame,
  Pill,
  Target,
  BatteryCharging,
  Settings2,
  ChevronRight,
  Archive,
} from "lucide-react";
import { m, useReducedMotion } from "motion/react";

export type ToolId =
  | "backup"
  | "plate"
  | "orm"
  | "warmup"
  | "deload"
  | "supplements"
  | "settings";

export default function ToolsHub({
  onChoose,
}: {
  onChoose: (id: ToolId) => void;
}) {
  const reduced = useReducedMotion();
  const groups: Array<{
    title: string;
    items: Array<{ id: ToolId; name: string; hint: string; icon: typeof Dumbbell }>;
  }> = [
    {
      title: "Калькуляторы",
      items: [
        {
          id: "plate",
          name: "Калькулятор блинов",
          hint: "Раскладка дисков на штангу",
          icon: Dumbbell,
        },
        {
          id: "orm",
          name: "Калькулятор 1ПМ",
          hint: "Оценка максимума с учётом RIR",
          icon: Target,
        },
        {
          id: "warmup",
          name: "Разминочная лесенка",
          hint: "Подготовительные подходы",
          icon: Flame,
        },
      ],
    },
    {
      title: "Журнал и настройки",
      items: [
        {
          id: "supplements",
          name: "Добавки",
          hint: "Креатин, протеин, гейнер и ежедневный трекер",
          icon: Pill,
        },
        {
          id: "deload",
          name: "Разгрузочная неделя",
          hint: "Снижение весов на неделю",
          icon: BatteryCharging,
        },
        {
          id: "settings",
          name: "Мои цели",
          hint: "Цели по мышцам, отдых и часовой пояс",
          icon: Settings2,
        },
        {
          id: "backup",
          name: "Резервная копия",
          hint: "Экспорт и восстановление данных",
          icon: Archive,
        },
      ],
    },
  ];
  return (
    <div className="tools-hub">
      {groups.map((group) => (
        <section key={group.title}>
          <h3>{group.title}</h3>
          {group.items.map((item) => (
            <m.button
              key={item.id}
              type="button"
              whileTap={reduced ? undefined : { scale: 0.985 }}
              onClick={() => onChoose(item.id)}
            >
              <item.icon size={20} aria-hidden="true" />
              <span>
                <b>{item.name}</b>
                <small>{item.hint}</small>
              </span>
              <ChevronRight size={17} aria-hidden="true" />
            </m.button>
          ))}
        </section>
      ))}
    </div>
  );
}
