import { m } from "motion/react";
import { Activity, X } from "lucide-react";
import BodyMap from "./BodyMap";
import { ANATOMICAL_MUSCLES, MUSCLES } from "../data/muscles";
import type { Exercise } from "../lib/types";

type Badge = { text: string; kind: string };

const EASE = [0.22, 1, 0.36, 1] as const;

const ROLES = [
  { id: "primary", title: "Движители", hint: "Делают основную работу", level: 3 },
  { id: "assistant", title: "Помощь", hint: "Подключаются на трудных участках", level: 2 },
  { id: "stabilizer", title: "Стабилизация", hint: "Держат положение, не двигают вес", level: 1 },
] as const;

/** Разбор упражнения по ролям мышц: карта тела слева, кто за что отвечает справа. */
export default function BiomechanicsPanel({
  exercise,
  name,
  badges,
  onClose,
}: {
  exercise: Exercise;
  name: string;
  badges: Badge[];
  onClose: () => void;
}) {
  const anatomical = (role: (typeof ROLES)[number]["id"]): string[] => {
    const names: string[] = [];
    for (const entry of exercise.muscles) {
      if (entry.role !== role) continue;
      const found = ANATOMICAL_MUSCLES.find((a) => a.id === entry.muscleId);
      if (found) names.push(found.name);
    }
    return names;
  };
  const zones = (ids: string[]): string[] => ids.map((id) => MUSCLES.find((m) => m.id === id)?.name ?? id);

  const groups = ROLES.map((role) => {
    let items = anatomical(role.id);
    if (!items.length && role.id === "primary") items = zones(exercise.primary);
    if (!items.length && role.id === "assistant") items = zones(exercise.secondary);
    return { ...role, items: [...new Set(items)] };
  }).filter((g) => g.items.length || g.id === "primary");

  return (
    <m.section
      className="bio-panel"
      aria-label={`Биомеханика: ${name}`}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      <div className="bio-inner">
        <header className="bio-head">
          <Activity size={18} aria-hidden="true" />
          <div>
            <small>Биомеханика</small>
            <h4>{name}</h4>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть анатомию">
            <X size={16} />
          </button>
        </header>

        <div className="bio-grid">
          <m.div
            className="bio-map"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.12, ease: EASE }}
          >
            <BodyMap loads={[]} selected={null} onSelect={() => {}} exercise={exercise} compact />
          </m.div>

          <div className="bio-roles">
            {groups.map((group, gi) => (
              <m.div
                key={group.id}
                className={`bio-role ${group.id}`}
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, delay: 0.18 + gi * 0.09, ease: EASE }}
              >
                <div className="bio-role-head">
                  <span className="bio-meter" aria-hidden="true">
                    {[1, 2, 3].map((n) => (
                      <i key={n} className={n <= group.level ? "on" : ""} />
                    ))}
                  </span>
                  <b>{group.title}</b>
                  <small>{group.hint}</small>
                </div>
                <div className="bio-chips">
                  {group.id === "primary"
                    ? badges.map((b) => (
                        <span key={b.text} className="bio-chip head">
                          {b.text}
                        </span>
                      ))
                    : null}
                  {group.items.map((item) => (
                    <span key={item} className="bio-chip">
                      {item}
                    </span>
                  ))}
                </div>
              </m.div>
            ))}

            {exercise.tip ? (
              <m.p
                className="bio-tip"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.5, ease: EASE }}
              >
                <b>Техника</b>
                {exercise.tip}
              </m.p>
            ) : null}
          </div>
        </div>
      </div>
    </m.section>
  );
}
