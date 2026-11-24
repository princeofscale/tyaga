import type { Page } from "@playwright/test";

/** Видимые кнопки, ссылки, поля, списки и summary в main короче 44 px по любой стороне. */
export function smallTargets(page: Page) {
  return page.evaluate(() => {
    const out: { tag: string; text: string; w: number; h: number; cls: string; parent: string }[] = [];
    document.querySelectorAll("main button, main a, main input:not([type=hidden]), main select, main summary").forEach((el) => {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      /* считается собственный бокс элемента, без невидимых псевдоэлементов: так же меряет и приёмка */
      const { width: w, height: h } = r;
      if (w + 0.5 >= 44 && h + 0.5 >= 44) return;
      const inText = el.tagName === "A" && !!el.closest("p, li") && style.display === "inline";
      if (inText) return;
      out.push({ tag: el.tagName.toLowerCase(), text: ((el as HTMLElement).innerText || el.getAttribute("aria-label") || (el as HTMLInputElement).type || "").trim().slice(0, 40), w: Math.round(w), h: Math.round(h), cls: String(el.className || "").slice(0, 50), parent: String(el.parentElement?.className || "").slice(0, 50) });
    });
    return out;
  });
}

/** Кнопки, ссылки, summary и плашки, чей текст шире собственной рамки, и пары соседей, чьи рамки пересекаются. */
export function clipped(page: Page, scope = "main") {
  return page.evaluate((root) => {
    const rootEl = document.querySelector(root) ?? document.body;
    const items = [...rootEl.querySelectorAll<HTMLElement>("button, a, summary, .filter-chip")].filter((el) => {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && r.width > 0 && r.height > 0;
    });
    const label = (el: HTMLElement) => (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30);
    const wide = items
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => ({ text: label(el), scroll: el.scrollWidth, client: el.clientWidth }));
    const overlaps: string[] = [];
    for (const el of items) {
      const parent = el.parentElement;
      if (!parent) continue;
      const siblings = [...parent.children].filter((c): c is HTMLElement => c !== el && items.includes(c as HTMLElement));
      const a = el.getBoundingClientRect();
      for (const other of siblings) {
        if (items.indexOf(other) < items.indexOf(el)) continue;
        const b = other.getBoundingClientRect();
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 0.5 && y > 0.5) overlaps.push(`${label(el)} × ${label(other)}`);
      }
    }
    return { wide, overlaps };
  }, scope);
}


/**
 * Цели касания внутри окна: кнопки, ссылки, поля и summary короче 44 px по любой стороне
 * или перекрытые чем-то другим (проба `elementFromPoint` в центре).
 */
export function smallInDialog(page: Page, scope = "dialog[open]") {
  return page.evaluate((root) => {
    const rootEl = document.querySelector(root);
    if (!rootEl) return [{ tag: "none", text: "окно не найдено", w: 0, h: 0, covered: false }];
    const out: { tag: string; text: string; w: number; h: number; covered: boolean }[] = [];
    rootEl.querySelectorAll<HTMLElement>("button, a, input:not([type=hidden]), select, summary").forEach((el) => {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const covered = !!hit && hit !== el && !el.contains(hit) && !hit.contains(el);
      if (r.width + 0.5 >= 44 && r.height + 0.5 >= 44 && !covered) return;
      out.push({ tag: el.tagName.toLowerCase(), text: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), covered });
    });
    return out;
  }, scope);
}
