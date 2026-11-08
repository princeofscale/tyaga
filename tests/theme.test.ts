import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THEME, THEMES, applyTheme, getCurrentTheme } from "../src/lib/theme";

function withGlobals(values: Record<string, unknown>, run: () => void) {
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  try { run(); }
  finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function preferenceStore(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set("tyaga_theme_accent", initial);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

test("Theme definitions add lime and preserve the four existing palettes", () => {
  assert.equal(THEMES.length, 5);
  assert.equal(new Set(THEMES.map((t) => t.id)).size, 5);
  for (const id of ["lime", "cyan", "emerald", "gold", "violet"]) {
    assert.ok(THEMES.some((t) => t.id === id));
  }
  assert.equal(THEMES.find((t) => t.id === "cyan")?.accent, "#00e5ff");
  assert.equal(THEMES.find((t) => t.id === "lime")?.accent, "#cafa64");
});

test("Default theme is athletic lime without browser storage", () => {
  withGlobals({ localStorage: undefined }, () => {
    assert.equal(DEFAULT_THEME, "lime");
    assert.equal(getCurrentTheme(), "lime");
  });
});

test("Existing saved palette IDs remain authoritative", () => {
  for (const id of ["cyan", "emerald", "gold", "violet"] as const) {
    const storage = preferenceStore(id);
    withGlobals({ localStorage: storage }, () => {
      assert.equal(getCurrentTheme(), id);
      applyTheme(getCurrentTheme(), false);
      assert.equal(storage.values.get("tyaga_theme_accent"), id);
    });
  }
});

test("Unknown saved themes fall back to lime without overwriting the store", () => {
  const storage = preferenceStore("obsolete-theme");
  withGlobals({ localStorage: storage }, () => {
    assert.equal(getCurrentTheme(), "lime");
    assert.equal(storage.values.get("tyaga_theme_accent"), "obsolete-theme");
  });
});

test("Restoring the default does not turn it into an explicit preference", () => {
  const storage = preferenceStore();
  withGlobals({ localStorage: storage }, () => {
    applyTheme(getCurrentTheme(), false);
    assert.equal(storage.values.size, 0);
    applyTheme("gold");
    assert.equal(storage.values.get("tyaga_theme_accent"), "gold");
  });
});

test("Choosing a theme updates all CSS accent tokens and the root attribute", () => {
  const storage = preferenceStore();
  const css = new Map<string, string>();
  const attrs = new Map<string, string>();
  const document = { documentElement: {
    style: { setProperty: (key: string, value: string) => { css.set(key, value); } },
    setAttribute: (key: string, value: string) => { attrs.set(key, value); },
  } };
  withGlobals({ localStorage: storage, document }, () => {
    applyTheme("violet");
    const theme = THEMES.find((t) => t.id === "violet")!;
    assert.equal(css.get("--accent"), theme.accent);
    assert.equal(css.get("--accent-hover"), theme.accentHover);
    assert.equal(css.get("--accent-subtle"), theme.accentSubtle);
    assert.equal(css.get("--accent-glow"), theme.accentGlow);
    assert.equal(attrs.get("data-theme-accent"), "violet");
  });
});

test("Blocked preference reads/writes do not crash theme selection", () => {
  const blocked = {
    getItem() { throw new Error("Storage disabled"); },
    setItem() { throw new Error("Storage disabled"); },
  };
  withGlobals({ localStorage: blocked }, () => {
    assert.equal(getCurrentTheme(), "lime");
    assert.doesNotThrow(() => applyTheme("emerald"));
  });
});
