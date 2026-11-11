import {
  Dumbbell,
  Flame,
  Target,
  BatteryCharging,
  Zap,
  Smartphone,
  Settings2,
  UserRound,
  ChevronRight,
  Scale,
} from "lucide-react";
export type ToolId =
  | "bodyweight"
  | "plate"
  | "orm"
  | "warmup"
  | "deload"
  | "rp_volume"
  | "ios_install"
  | "settings"
  | "profile";
export default function ToolsHub({
  onChoose,
}: {
  onChoose: (id: ToolId) => void;
}) {
  const groups = [
    {
      title: "Учёт",
      items: [
        {
          id: "bodyweight",
          name: "Вес тела и тренд",
          hint: "Взвешивания, цель и синхронизация",
          icon: Scale,
        },
      ],
    },
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
          hint: "Оценка по рабочему подходу",
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
      title: "Планирование",
      items: [
        {
          id: "deload",
          name: "Разгрузочная неделя",
          hint: "Сократить нагрузку",
          icon: BatteryCharging,
        },
        {
          id: "rp_volume",
          name: "Объём по мышцам",
          hint: "Ориентиры рабочих подходов",
          icon: Zap,
        },
      ],
    },
    {
      title: "Настройки",
      items: [
        {
          id: "settings",
          name: "Мои цели",
          hint: "Нагрузка, отдых и часовой пояс",
          icon: Settings2,
        },
        {
          id: "profile",
          name: "Мой профиль",
          hint: "Имя, масса тела, тема и аккаунт",
          icon: UserRound,
        },
        {
          id: "ios_install",
          name: "Добавить на экран",
          hint: "Установка веб-приложения",
          icon: Smartphone,
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
            <button key={item.id} onClick={() => onChoose(item.id as ToolId)}>
              <item.icon size={20} />
              <span>
                <b>{item.name}</b>
                <small>{item.hint}</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
