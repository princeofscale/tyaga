export type ThemeId = "ember" | "cyan" | "emerald" | "gold" | "violet" | "lime";

export interface ThemeDef {
  id: ThemeId;
  name: string;
  accent: string;
  accentHover: string;
  accentSubtle: string;
  accentGlow: string;
  onAccent: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: "ember",
    name: "Коралл",
    accent: "#e2441f",
    accentHover: "#f2532e",
    accentSubtle: "rgba(226, 68, 31, 0.14)",
    accentGlow: "rgba(226, 68, 31, 0.34)",
    onAccent: "#ffffff",
  },
  {
    id: "cyan",
    name: "Бирюзовый",
    accent: "#00e5ff",
    accentHover: "#33ebff",
    accentSubtle: "rgba(0, 229, 255, 0.12)",
    accentGlow: "rgba(0, 229, 255, 0.35)",
    onAccent: "#061018",
  },
  {
    id: "emerald",
    name: "Изумрудный",
    accent: "#10b981",
    accentHover: "#34d399",
    accentSubtle: "rgba(16, 185, 129, 0.14)",
    accentGlow: "rgba(16, 185, 129, 0.35)",
    onAccent: "#05140e",
  },
  {
    id: "gold",
    name: "Янтарный",
    accent: "#f59e0b",
    accentHover: "#fbbf24",
    accentSubtle: "rgba(245, 158, 11, 0.14)",
    accentGlow: "rgba(245, 158, 11, 0.35)",
    onAccent: "#171004",
  },
  {
    id: "violet",
    name: "Фиолетовый",
    accent: "#8b5cf6",
    accentHover: "#a78bfa",
    accentSubtle: "rgba(139, 92, 246, 0.16)",
    accentGlow: "rgba(139, 92, 246, 0.38)",
    onAccent: "#ffffff",
  },
  {
    id: "lime",
    name: "Лайм",
    accent: "#cafa64",
    accentHover: "#dcff93",
    accentSubtle: "rgba(202, 250, 100, 0.10)",
    accentGlow: "rgba(202, 250, 100, 0.18)",
    onAccent: "#0b1208",
  },
];

const STORAGE_KEY = "tyaga_theme_accent";
export const DEFAULT_THEME: ThemeId = "ember";

export function getCurrentTheme(): ThemeId {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      const theme = THEMES.find((t) => t.id === saved);
      if (theme) return theme.id;
    }
  } catch {
    // Private browsing can disable storage; the interface must still render.
  }
  return DEFAULT_THEME;
}

export function applyTheme(themeId: ThemeId, persist = true): void {
  const def = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
  try {
    if (persist && typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, def.id);
    }
  } catch {
    // A blocked preference store must not prevent the visual update.
  }
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.style.setProperty("--accent", def.accent);
    root.style.setProperty("--accent-hover", def.accentHover);
    root.style.setProperty("--accent-subtle", def.accentSubtle);
    root.style.setProperty("--accent-glow", def.accentGlow);
    root.style.setProperty("--on-accent", def.onAccent);
    root.setAttribute("data-theme-accent", def.id);
  }
}

// Restore a saved choice without turning the default into a saved preference.
if (typeof window !== "undefined") {
  applyTheme(getCurrentTheme(), false);
}
