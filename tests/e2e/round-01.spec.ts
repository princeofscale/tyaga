import { test, expect, type Page } from "@playwright/test";
import { doneWorkout, nav, round01Fixture, startWith } from "./fixtures/round01";

/**
 * Раунд 1: критерии приёмки R01-REQ01…REQ11 на телефоне. Приложение целиком на подставных ответах,
 * ни один запрос не идёт на воркер или D1.
 */
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  locale: "ru-RU",
  timezoneId: "Europe/Saratov",
});

const BENCH = "Жим штанги лёжа";
const SQUAT = "Приседания со штангой";
const weight = (page: Page, n: number, name = BENCH) => page.getByLabel(`${name}, подход ${n}, вес`, { exact: true });
const reps = (page: Page, n: number, name = BENCH) => page.getByLabel(`${name}, подход ${n}, повторы`, { exact: true });
const rir = (page: Page, n: number, name = BENCH) => page.getByLabel(`${name}, подход ${n}, RIR`, { exact: true });
const check = (page: Page, n: number, name = BENCH) =>
  page.getByRole("button", { name: `Отметить выполненным: ${name}, подход ${n}`, exact: true });
/** После отметки подпись кнопки меняется на «Снять отметку». */
const checked = (page: Page, n: number, name = BENCH) =>
  page.getByRole("button", { name: `Снять отметку: ${name}, подход ${n}`, exact: true });
const startButton = (page: Page) => page.getByRole("button", { name: "Начать тренировку", exact: true }).first();
const history = [doneWorkout("Грудь", "2026-11-09", [["bench", 100, 8, 3]])];

test("R01-REQ01: отмена пустой тренировки — без вопросов, и мы на «Сегодня» с навигацией", async ({ page }) => {
  const f = await round01Fixture(page);
  await startButton(page).click();
  await expect(page.locator(".workout-athletic")).toBeVisible();
  // Единственное касание: «Отмена».
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  await expect(nav(page, "История")).toBeVisible();
  await expect(startButton(page)).toBeVisible();
  // Черновика на устройстве не осталось.
  await page.reload();
  await expect(startButton(page)).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("R01-REQ01: после выполненного подхода отмена задаёт ровно один вопрос", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, BENCH);
  await check(page, 1).click();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole("heading", { name: "Отменить тренировку?" })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Да, отменить тренировку", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  await expect(nav(page, "Прогресс")).toBeVisible();
});

test("R01-REQ01: «Продолжить» в вопросе оставляет тренировку на месте", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, BENCH);
  await check(page, 1).click();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(checked(page, 1)).toHaveAttribute("aria-pressed", "true");
});

test("R01-REQ02: «Отменить удаление» видна и нажимается при любой прокрутке, подход возвращается", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, BENCH, SQUAT);
  await weight(page, 3).fill("90");
  await check(page, 1).click(); // включает таймер отдыха: панель не должна лежать под ним
  const undo = page.getByRole("button", { name: "Отменить удаление", exact: true });
  for (const y of [0, 400, 1_000_000]) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.getByRole("button", { name: "Убрать последний подход" }).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.getByRole("button", { name: "Убрать последний подход" }).first().click();
    await expect(weight(page, 3)).toHaveCount(0);
    await expect(undo).toBeVisible();
    await expect(undo).toBeInViewport({ ratio: 1 });
    const hit = await undo.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && (top === el || el.contains(top));
    });
    expect(hit, `центр кнопки перекрыт при прокрутке ${y}`).toBe(true);
    await undo.click();
    await expect(weight(page, 3)).toHaveValue("90");
  }
});

test("R01-REQ02: убранное упражнение тоже можно вернуть из видимой панели", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, BENCH);
  await page.getByRole("button", { name: `Убрать ${BENCH}`, exact: true }).click();
  await expect(page.locator(".exercise-card")).toHaveCount(0);
  const undo = page.getByRole("button", { name: "Отменить удаление", exact: true });
  await expect(undo).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".workout-undo")).toContainText("Упражнение убрано");
  await undo.click();
  await expect(page.locator(".exercise-card")).toHaveCount(1);
});

for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]) {
  test(`R01-REQ03: «Прошлый» читается целиком на ${size.width} px`, async ({ page }) => {
    await page.setViewportSize(size);
    const odd = doneWorkout("Ноги", "2026-11-08", [["squat", 102.5, 10, 3]]);
    await round01Fixture(page, { workouts: [...history, odd] });
    await startWith(page, BENCH, SQUAT);
    await page.getByRole("button", { name: /Повторить прошлые/ }).first().click();
    const cells = await page.locator(".set-previous").evaluateAll((nodes) =>
      nodes.map((el) => ({
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        clippedX: el.scrollWidth > el.clientWidth + 1,
        clippedY: el.scrollHeight > el.clientHeight + 1,
      })),
    );
    expect(cells.map((c) => c.text)).toEqual(["100 × 8", "100 × 8", "100 × 8", "102,5 × 10", "102,5 × 10", "102,5 × 10"]);
    for (const cell of cells) {
      expect(cell.clippedX, `«${cell.text}» обрезан по ширине`).toBe(false);
      expect(cell.clippedY, `«${cell.text}» обрезан по высоте`).toBe(false);
      expect(cell.text).not.toContain("…");
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("R01-REQ04: касание выделяет число, набор «100» даёт «100», остальные подходы подставлены", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, BENCH);
  // Подход 1: тап, цифры, Enter, цифры, Enter, цифры, ✓ — 7 касаний.
  await weight(page, 1).click();
  await page.keyboard.type("100");
  await expect(weight(page, 1)).toHaveValue("100");
  await page.keyboard.press("Enter");
  await expect(reps(page, 1)).toBeFocused();
  await page.keyboard.type("8");
  await page.keyboard.press("Enter");
  await expect(rir(page, 1)).toBeFocused();
  await page.keyboard.type("1");
  await check(page, 1).click();
  // Подходы 2 и 3 не набирались: достаточно ✓.
  for (const n of [2, 3]) {
    await expect(weight(page, n)).toHaveValue("100");
    await expect(reps(page, n)).toHaveValue("8");
    await expect(rir(page, n)).toHaveValue("1");
    await expect(check(page, n)).toHaveAttribute("aria-pressed", "false");
    await check(page, n).click();
  }
  await expect(page.locator(".hud-tonnage b")).toContainText("2 400");
});

test("R01-REQ04: поправленная вручную строка не перезаписывается, нетронутые следуют за правкой", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, BENCH);
  await weight(page, 1).click();
  await page.keyboard.type("100");
  for (const n of [1, 2, 3]) await expect(weight(page, n)).toHaveValue("100");
  await weight(page, 2).click();
  await page.keyboard.type("105");
  await expect(weight(page, 3)).toHaveValue("105");
  await weight(page, 1).click();
  await page.keyboard.type("102");
  await expect(weight(page, 1)).toHaveValue("102");
  await expect(weight(page, 2)).toHaveValue("105");
  await expect(weight(page, 3)).toHaveValue("105");
});

test("R01-REQ05: на «Сегодня» цифры недели объяснены, слова «сетов» нет", async ({ page }) => {
  await round01Fixture(page, { workouts: [doneWorkout("Ноги и грудь", "2026-11-10", [["squat", 100, 8, 3], ["bench", 80, 8, 1]])] });
  const week = page.locator(".weekly-activity-bar");
  await expect(week).toContainText("1 тренировка");
  await expect(week).toContainText("4 подхода");
  const summary = page.locator(".week-summary");
  await expect(summary).toContainText("зачтено зонам");
  await expect(summary).toContainText("Один подход засчитывается каждой зоне");
  for (const path of ["Сегодня", "История", "Прогресс", "Упражнения"]) {
    await nav(page, path).click();
    await expect(page.locator("body")).not.toContainText(/(^|[^а-яё])сет(ов|а|ы)?([^а-яё]|$)/i);
  }
});

test("R01-REQ06: на «Сегодня» нет плавающей кнопки, на «Прогрессе» последние строки не под ней", async ({ page }) => {
  await round01Fixture(page, { workouts: history });
  await startWith(page, BENCH);
  await page.getByRole("button", { name: "Свернуть тренировку", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  await expect(page.locator(".resume-pill")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Продолжить тренировку", exact: true })).toBeVisible();
  await nav(page, "Прогресс").click();
  const pill = page.locator(".resume-pill");
  await expect(pill).toBeVisible();
  for (const tab of ["Вес тела", "Мышцы"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const gap = await page.evaluate(() => {
      const pillTop = document.querySelector(".resume-pill")!.getBoundingClientRect().top;
      const last = document.querySelector(".page-content")!.lastElementChild!;
      return pillTop - last.getBoundingClientRect().bottom;
    });
    expect(gap, `последний блок «${tab}» под плавающей кнопкой`).toBeGreaterThanOrEqual(0);
  }
});

test("R01-REQ07: в записи истории первыми упражнения и подходы, без «Apple Watch» и «общего веса»", async ({ page }) => {
  await round01Fixture(page, { workouts: history });
  await nav(page, "История").click();
  await page.locator(".session-item").filter({ hasText: "Грудь" }).click();
  const dialog = page.getByRole("dialog");
  const sets = dialog.locator(".detail-sets").first();
  await expect(sets).toContainText("100 кг × 8");
  await expect(sets).toContainText("RIR 1");
  await expect(sets).toBeInViewport({ ratio: 1 });
  await expect(dialog).not.toContainText("Apple Watch");
  await expect(dialog).not.toContainText("общего веса");
  const order = await dialog.evaluate((root) => {
    const top = (selector: string) => root.querySelector(selector)!.getBoundingClientRect().top;
    return { exercise: top(".detail-exercise"), insights: top(".detail-insights") };
  });
  expect(order.exercise).toBeLessThan(order.insights);
  // Итоги и карточка для сторис — под упражнениями, свёрнуты; импорт часов остаётся доступным.
  await expect(dialog.locator(".detail-insights")).not.toHaveAttribute("open", "");
  await dialog.locator(".detail-insights > summary").click();
  await expect(dialog.getByRole("button", { name: "Карточка для сторис" })).toBeVisible();
  await expect(dialog.getByText("Импорт из Apple Health", { exact: true })).toBeVisible();
});

for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]) {
  test(`R01-REQ08: на ${size.width}×${size.height} видно ≥5 строк, шаг ≤85 px, карточка ≤850 px, шапка сворачивается`, async ({ page }) => {
    await page.setViewportSize(size);
    await round01Fixture(page);
    await startWith(page, BENCH, SQUAT);
    const layout = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".exercise-card:first-of-type .set-row")].map(
        (el) => el.getBoundingClientRect().top + scrollY,
      );
      return {
        step: rows[1] - rows[0],
        card: document.querySelector(".exercise-card")!.getBoundingClientRect().height,
        bar: document.querySelector(".workout-bar")!.getBoundingClientRect().height,
      };
    });
    expect(layout.step).toBeLessThanOrEqual(85);
    expect(layout.card).toBeLessThanOrEqual(850);
    let most = 0;
    let barBottom = 1e9;
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += 4) {
      const seen = await page.evaluate((top) => {
        window.scrollTo(0, top);
        const bar = document.querySelector(".workout-bar")!.getBoundingClientRect();
        const visible = [...document.querySelectorAll(".set-row")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= bar.bottom && r.bottom <= innerHeight;
        }).length;
        return { visible, barBottom: bar.bottom, scrolled: scrollY };
      }, y);
      most = Math.max(most, seen.visible);
      if (seen.scrolled >= layout.bar) barBottom = Math.min(barBottom, seen.barBottom);
    }
    expect(most).toBeGreaterThanOrEqual(5);
    // Прокрутили дальше высоты шапки — осталась одна строка: таймер, подходы, «Завершить».
    expect(barBottom).toBeLessThanOrEqual(80);
    const finish = page.getByRole("button", { name: "Завершить тренировку", exact: true });
    await page.evaluate(() => window.scrollTo(0, 700));
    await expect(finish).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".live-clock-badge")).toBeInViewport({ ratio: 1 });
  });
}

test("R01-REQ08: контекст подхода открывается из панели строки и сохраняется", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, BENCH);
  await expect(page.getByText("Контекст подхода 1", { exact: true })).toHaveCount(0);
  await weight(page, 1).click();
  await page.getByRole("button", { name: "Контекст подхода 1", exact: true }).click();
  await page.getByText("Подход 1: амплитуда, хват и углы", { exact: true }).click();
  await expect(page.getByLabel("Подход 1: амплитуда", { exact: true })).toBeVisible();
});

test("R01-REQ09: число на вкладке «Основные» равно числу карточек", async ({ page }) => {
  await round01Fixture(page);
  await nav(page, "Упражнения").click();
  const tab = page.locator(".catalog-tabs button").filter({ hasText: "Основные" });
  const label = (await tab.locator("span").textContent())!.trim();
  await expect(page.locator(".library-card")).toHaveCount(Number(label));
  await expect(page.locator(".library-header")).toContainText(`${label} упражнени`);
});

test("R01-REQ10: нет обрывков и «успеха» на отказе, подписи цветов целиком", async ({ page }) => {
  await round01Fixture(page, { workouts: history });
  // «Сила»: законченные фразы; единственная тренировка не даёт «+0 кг».
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Сила", exact: true }).click();
  const tip = page.locator(".progress-selector .tiny");
  await expect(tip).toContainText("Записывается общий вес на штанге в килограммах: гриф и блины.");
  await expect(tip).not.toContainText("кг общего веса");
  await expect(page.locator(".stat-card, .stats-grid > *").filter({ hasText: "Изменение веса" })).toContainText("—");
  await expect(page.locator(".stats-grid")).not.toContainText("+0");
  // Отказ — предупреждение, а не зелёная галочка.
  await nav(page, "Сегодня").click();
  await startWith(page, BENCH);
  await page.getByRole("button", { name: "Свернуть тренировку", exact: true }).click();
  await nav(page, "История").click();
  await page.locator(".session-item").filter({ hasText: "Грудь" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Редактировать", exact: true }).click();
  const toast = page.locator(".toast");
  await expect(toast).toContainText("Сначала заверши или отмени текущий черновик.");
  await expect(toast).toHaveClass(/toast-warn/);
  await expect(toast.locator("svg").first()).not.toHaveClass(/lucide-check/);
  // Подписи цветов видны полностью.
  await page.getByRole("button", { name: "Свернуть тренировку", exact: true }).click();
  await page.getByRole("button", { name: "Мой профиль", exact: true }).click();
  const clipped = await page.locator(".theme-swatch-btn").evaluateAll((buttons) =>
    buttons
      .map((button) => {
        const label = button.querySelector(".swatch-label") as HTMLElement;
        const box = button.getBoundingClientRect();
        const text = label.getBoundingClientRect();
        return {
          name: label.textContent,
          cut: label.scrollWidth > label.clientWidth + 1 || text.right > box.right - 1 || text.left < box.left,
        };
      })
      .filter((x) => x.cut),
  );
  expect(clipped).toEqual([]);
});

test("R01-REQ10: завершение тренировки говорит только «Тренировка сохранена»", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, BENCH);
  await check(page, 1).click();
  await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
  await expect(page.locator(".toast")).toHaveText("Тренировка сохранена");
});

test("R01-REQ11: вес, введённый сразу после открытия профиля, не пропадает и попадает в «Вес тела»", async ({ page }) => {
  const f = await round01Fixture(page, { holdWeights: true });
  await page.getByRole("button", { name: "Мой профиль", exact: true }).click();
  const mass = page.getByLabel("Вес тела, кг");
  await mass.fill("82.5");
  // Журнал веса догружается уже после ввода.
  f.releaseWeights();
  await page.waitForResponse((r) => r.url().includes("/api/bodyweight") && r.request().method() === "GET");
  await expect(mass).toHaveValue("82.5");
  await page.getByRole("button", { name: "Сохранить профиль", exact: true }).click();
  await expect(page.getByText("Профиль сохранён", { exact: true })).toBeVisible();
  expect(f.profileBodies).toHaveLength(1);
  expect(f.profileBodies[0]).toMatchObject({ bodyMassKg: 82.5 });
  await expect.poll(() => [...f.weights.documents.values()].some((d) => JSON.stringify(d.value).includes("82.5"))).toBe(true);
  await page.keyboard.press("Escape");
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Вес тела", exact: true }).click();
  await expect(page.getByRole("tabpanel").or(page.locator(".page-content"))).toContainText("82,5");
});

test("R01-REQ11: вес, введённый вместе со сменой часового пояса, не стирается и попадает в журнал", async ({ page }) => {
  // Часовой пояс аккаунта — ключ журнала веса. При его смене журнал создаётся заново, и прежний код
  // сбрасывал поле веса и терял запись, только что сделанную в старом журнале.
  const f = await round01Fixture(page, { holdWeights: true });
  await page.getByRole("button", { name: "Мой профиль", exact: true }).click();
  const mass = page.getByLabel("Вес тела, кг");
  await mass.fill("82.5");
  await page.getByLabel("Часовой пояс").fill("Europe/Moscow");
  // Журнал веса всё ещё не ответил: ни сохранение, ни пересоздание журнала не должны ни стереть поле, ни потерять замер.
  await page.getByRole("button", { name: "Сохранить профиль", exact: true }).click();
  await expect(page.getByText("Профиль сохранён", { exact: true })).toBeVisible();
  expect(f.profileBodies[0]).toMatchObject({ bodyMassKg: 82.5, timeZone: "Europe/Moscow" });
  await expect(mass).toHaveValue("82.5");
  f.releaseWeights();
  await expect(mass).toHaveValue("82.5");
  await expect.poll(() => [...f.weights.documents.values()].some((d) => JSON.stringify(d.value).includes("82.5"))).toBe(true);
  await page.keyboard.press("Escape");
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Вес тела", exact: true }).click();
  await expect(page.locator(".page-content")).toContainText("82,5");
});

test("регрессия: черновик переживает перезагрузку, Enter ведёт вес → повторы → RIR, правка истории пересчитывает тоннаж", async ({ page }) => {
  await round01Fixture(page, { workouts: history });
  await startWith(page, BENCH);
  await weight(page, 1).fill("100");
  await reps(page, 1).fill("8");
  await check(page, 1).click();
  await page.reload();
  await page.getByRole("button", { name: "Продолжить тренировку", exact: true }).click();
  await expect(weight(page, 1)).toHaveValue("100");
  await expect(checked(page, 1)).toHaveAttribute("aria-pressed", "true");
  await weight(page, 2).focus();
  await page.keyboard.press("Enter");
  await expect(reps(page, 2)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(rir(page, 2)).toBeFocused();
});

// ───────────────────────── Доработка по QA (D1–D8) ─────────────────────────

const hitsItself = (el: Element) => {
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!top && (top === el || el.contains(top));
};

for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`D1: «Отменить удаление» и кнопки таймера отдыха не перекрывают друг друга на ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await round01Fixture(page);
    await startWith(page, BENCH);
    await check(page, 1).click(); // запустился «Отдых 01:30»
    await page.getByRole("button", { name: "Убрать последний подход" }).first().click();
    const buttons = [
      page.getByRole("button", { name: "Минус 15 секунд", exact: true }),
      page.getByRole("button", { name: "Плюс 15 секунд", exact: true }),
      page.getByRole("button", { name: "Приостановить таймер", exact: true }),
      page.getByRole("button", { name: "Пропустить отдых", exact: true }),
      page.getByRole("button", { name: "Отменить удаление", exact: true }),
    ];
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    const stops = new Set([0, total]);
    for (let y = 0; y < total; y += 150) stops.add(y);
    for (const y of stops) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      for (const button of buttons) {
        await expect(button).toBeInViewport({ ratio: 1 });
        expect(await button.evaluate(hitsItself), `«${await button.getAttribute("aria-label")}» перекрыта при прокрутке ${y}`).toBe(true);
      }
    }
    // Две панели — друг под другом, не друг на друге.
    const boxes = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const undo = box(".workout-undo");
      const rest = box(".rest-bar");
      return { undoBottom: undo.bottom, restTop: rest.top };
    });
    expect(boxes.undoBottom).toBeLessThanOrEqual(boxes.restTop);
    await buttons[3].click();
    await expect(page.locator(".rest-bar")).toHaveCount(0);
    await expect(buttons[4]).toBeInViewport({ ratio: 1 });
    await buttons[4].click();
    await expect(weight(page, 3)).toHaveCount(1);
  });
}

test("D2: шаги веса, RIR и «прошлый результат» тоже ведут нетронутые строки, а поправленные вручную остаются", async ({ page }) => {
  await round01Fixture(page, { workouts: history });
  await startWith(page, BENCH);
  await weight(page, 1).fill("60");
  await weight(page, 3).fill("90"); // поправлено вручную
  const dock = page.locator(".set-quick-controls-dock");
  await weight(page, 1).click();
  await dock.getByRole("button", { name: "+2.5", exact: true }).click();
  await expect(weight(page, 1)).toHaveValue("62.5");
  await expect(weight(page, 2)).toHaveValue("62.5");
  await expect(weight(page, 3)).toHaveValue("90");
  await dock.locator(".rir-quick-group").getByRole("button", { name: "1", exact: true }).click();
  await expect(rir(page, 1)).toHaveValue("1");
  await expect(rir(page, 2)).toHaveValue("1");
  // «Подставить прошлый результат» (100 × 8) переносится на строку 2, которая всё ещё равна строке 1.
  await page.getByRole("button", { name: /^Подставить прошлый результат: 100 × 8$/ }).first().click();
  await expect(weight(page, 1)).toHaveValue("100");
  await expect(weight(page, 2)).toHaveValue("100");
  await expect(reps(page, 2)).toHaveValue("8");
  await expect(weight(page, 3)).toHaveValue("90");
  // Выполненную строку ничто не трогает.
  await check(page, 2).click();
  await weight(page, 1).fill("110");
  await expect(weight(page, 2)).toHaveValue("100");
});

test("D3: цифры при наборе не затирают поправленную вручную строку (повторы, вес, RIR через «пусто»)", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, BENCH);
  // Повторы: [10, 10, 1] → набираем «12» в строке 1 → [12, 12, 1].
  await reps(page, 1).fill("10");
  await reps(page, 3).fill("1");
  await reps(page, 1).click();
  await page.keyboard.type("12");
  await expect(reps(page, 1)).toHaveValue("12");
  await expect(reps(page, 2)).toHaveValue("12");
  await expect(reps(page, 3)).toHaveValue("1");
  // Вес: [100, 100, 10] → набираем «105» → [105, 105, 10].
  await weight(page, 1).fill("100");
  await weight(page, 3).fill("10");
  await weight(page, 1).click();
  await page.keyboard.type("105");
  await expect(weight(page, 2)).toHaveValue("105");
  await expect(weight(page, 3)).toHaveValue("10");
  // RIR: [2, 2, пусто] → стираем строку 1 и набираем «3» → [3, 3, пусто].
  await rir(page, 1).fill("2");
  await rir(page, 3).fill("");
  await rir(page, 1).click();
  await page.keyboard.press("Backspace");
  await page.keyboard.type("3");
  await expect(rir(page, 1)).toHaveValue("3");
  await expect(rir(page, 2)).toHaveValue("3");
  await expect(rir(page, 3)).toHaveValue("");
});

const longHistory = [
  doneWorkout("Тяга и жим", "2026-11-09", [
    ["row-v-grip", 60, 10, 3],
    ["skullcrusher-ez", 40, 10, 3],
    ["bench", 100, 8, 3],
    ["squat", 120, 5, 3],
  ]),
];

for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]) {
  for (const scenario of [
    { name: "после «Повторить» и «+2.5 кг» на аккаунте с историей", names: [BENCH, SQUAT] },
    {
      name: "с длинными названиями",
      names: ["Тяга горизонтального блока с узкой V-рукоятью", "Французский жим с EZ-штангой лёжа на наклонной"],
    },
  ]) {
    test(`D4: на ${size.width}×${size.height} видно ≥5 строк подходов ${scenario.name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await round01Fixture(page, { workouts: longHistory });
      await startWith(page, ...scenario.names);
      for (const button of await page.getByRole("button", { name: /^Повторить прошлые/ }).all()) await button.click();
      for (const button of await page.getByRole("button", { name: "+2.5 кг", exact: true }).all()) await button.click();
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      let most = 0;
      let windowPx = 0;
      for (let y = 0; y < total; y += 4) {
        const visible = await page.evaluate((top) => {
          window.scrollTo(0, top);
          const bar = document.querySelector(".workout-bar")!.getBoundingClientRect();
          return [...document.querySelectorAll(".set-row")].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= bar.bottom && r.bottom <= innerHeight;
          }).length;
        }, y);
        if (visible >= 5) windowPx += 4;
        most = Math.max(most, visible);
      }
      expect(most).toBeGreaterThanOrEqual(5);
      // Не одно случайное положение прокрутки, а промежуток, на котором строки реально видны.
      expect(windowPx).toBeGreaterThanOrEqual(24);
    });
  }
}

test("D5: на 360 px в поле веса помещается «222,5», повторы — «200»", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await round01Fixture(page);
  await startWith(page, BENCH);
  await weight(page, 1).fill("222.5");
  await reps(page, 1).fill("200");
  for (const field of [weight(page, 1), reps(page, 1)]) {
    const clipped = await field.evaluate((el: HTMLInputElement) => el.scrollWidth > el.clientWidth);
    expect(clipped).toBe(false);
  }
});

test("D6: пояснение «число больше» не показывается при «0 / 80», а на «Мышцах» оно есть", async ({ page }) => {
  await round01Fixture(page);
  await expect(page.locator(".week-summary")).toContainText("0 / ");
  await expect(page.locator(".week-summary-note")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Поэтому число больше");
});

test("D6: после тренировки пояснение есть на «Сегодня» и на «Прогресс → Мышцы»", async ({ page }) => {
  await round01Fixture(page, { workouts: [doneWorkout("Грудь", "2026-11-10", [["bench", 100, 8, 3]])] });
  await expect(page.locator(".week-summary-note")).toContainText("Один подход засчитывается каждой зоне");
  await expect(page.locator(".week-summary-note")).toContainText("Поэтому число больше, чем подходов в записи");
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  await expect(page.locator(".zones-panel")).toContainText("по твоим целям");
  await expect(page.locator(".zones-panel")).toContainText("Один подход засчитывается каждой зоне");
});

test("D7: «Вес тела» при единственном замере показывает «—» в «Изменение за историю»", async ({ page }) => {
  await round01Fixture(page);
  await page.getByRole("button", { name: "Мой профиль", exact: true }).click();
  await page.getByLabel("Вес тела, кг").fill("82.5");
  await page.getByRole("button", { name: "Сохранить профиль", exact: true }).click();
  await expect(page.getByText("Профиль сохранён", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Вес тела", exact: true }).click();
  const card = page.locator(".progress-metric").filter({ hasText: "Изменение за историю" });
  await expect(card.locator("strong")).toContainText("—");
  await expect(card.locator("strong")).not.toContainText("0");
});

test("D8: в записи истории вес с запятой, в «Силе» склонение «1 рабочий подход»", async ({ page }) => {
  await round01Fixture(page, { workouts: [doneWorkout("Грудь", "2026-11-09", [["bench", 62.5, 9, 1]])] });
  await nav(page, "История").click();
  await page.locator(".session-item").filter({ hasText: "Грудь" }).click();
  const sets = page.getByRole("dialog").locator(".detail-sets").first();
  await expect(sets).toContainText("62,5 кг × 9");
  await expect(sets).not.toContainText("62.5");
  await page.keyboard.press("Escape");
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Сила", exact: true }).click();
  await expect(page.locator(".page-content")).toContainText("9 повторений · 1 рабочий подход");
  await expect(page.locator(".page-content")).not.toContainText("1 рабочих подходов");
});
