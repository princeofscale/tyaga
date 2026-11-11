import type { CSSProperties } from "react";

const PALETTE = ["var(--accent)", "#b6a1e8", "#ffb878", "#8dcde0"];

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?";

/** Круг с инициалами. Цвет зависит только от имени: у одного человека он один и тот же в комнате и в полосе над тренировкой. */
export default function LiveAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const color = PALETTE[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE.length];
  return (
    <span className={`live-avatar ${size}`} style={{ "--avatar-color": color } as CSSProperties} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
