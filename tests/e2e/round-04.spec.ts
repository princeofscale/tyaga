import { test, expect, type Page } from "@playwright/test";
import { nav, round01Fixture, startWith } from "./fixtures/round01";
import { liveMock, mockLive, roomWithPartner, ROOM_CODE } from "./fixtures/live";
import { makeWorkout } from "../../src/lib/model";
import { TrainingProgram } from "../../src/domain/TrainingProgram";

/**
 * Раунд 4: R04-REQ01…REQ09 на телефоне, приложение на подставных ответах (ни один запрос не уходит на воркер или D1).
 */
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  locale: "ru-RU",
  timezoneId: "Europe/Saratov",
});

const BENCH = "Жим штанги лёжа";
const SIZES = [{ width: 390, height: 844 }, { width: 360, height: 800 }];
const openTool = async (page: Page, name: RegExp | string) => {
  await page.getByRole("button", { name: /^Инструменты/ }).last().click();
  await page.getByRole("button", { name: typeof name === "string" ? new RegExp(name) : name }).click();
};
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Всё нажимаемое внутри открытого окна: размеры меньше 44×44 (кроме скрытого). */
const smallTargets = (page: Page) =>
  page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]")!;
    const small: string[] = [];
    for (const el of dialog.querySelectorAll<HTMLElement>("button, summary, select, input:not([type=hidden]), [role=button]")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.width < 43.99 || r.height < 43.99)
        small.push(`${el.tagName}.${el.className}|${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20)}|${r.width.toFixed(1)}×${r.height.toFixed(1)}`);
    }
    return small;
  });

test("R04-REQ01: лесенка — набрано «77.5» и «100», в поле ровно набранное, расчёт для него; пустое поле не становится 20", async ({ page }) => {
  await round01Fixture(page);
  await openTool(page, "Разминочная лесенка");
  const field = page.getByLabel("Рабочий вес, кг", { exact: true });
  const last = page.locator(".ladder-step-card.work-set .step-weight");
  await field.fill("");
  await expect(field).toHaveValue("", "пустое поле остаётся пустым, а не 20");
  await field.pressSequentially("77.5", { delay: 60 });
  await expect(field).toHaveValue("77.5");
  await expect(last).toHaveText("77,5 кг");
  await field.fill("");
  await field.pressSequentially("100", { delay: 60 });
  await expect(field).toHaveValue("100");
  await expect(last).toHaveText("100 кг");
  // Меньше минимума: подсказка вместо подмены текста.
  await field.fill("");
  await field.pressSequentially("7", { delay: 60 });
  await expect(field).toHaveValue("7");
  await expect(page.getByRole("dialog").locator(".field-hint")).toContainText("Минимум 20 кг");
  // Пустое поле, уход из поля — возвращается последнее число, а не 20.
  await field.pressSequentially("7", { delay: 60 });
  await field.fill("");
  await field.blur();
  await expect(field).toHaveValue("77");
  expect(await field.inputValue()).not.toBe("20");
});

test("R04-REQ01: калькулятор разгрузки — «Обычный рабочий вес» принимает набранное 77.5", async ({ page }) => {
  await round01Fixture(page);
  await openTool(page, "Разгрузочная неделя");
  const field = page.getByLabel("Обычный рабочий вес, кг", { exact: true });
  await field.fill("");
  await expect(field).toHaveValue("");
  await field.pressSequentially("77.5", { delay: 60 });
  await expect(field).toHaveValue("77.5");
  await expect(page.locator(".sim-before b")).toContainText("77,5 кг");
  await field.fill("");
  await field.pressSequentially("100", { delay: 60 });
  await expect(page.locator(".sim-before b")).toContainText("100 кг");
});

function routineToday() {
  const w = makeWorkout(["bench", "lat-pulldown"], [], "Europe/Saratov", true);
  w.exercises.forEach((e) => (e.sets = e.sets.slice(0, 4).map((s) => ({ ...s, weight: 80, reps: 8 }))));
  return {
    ...TrainingProgram.empty(), id: "r-upper", name: "Верх тела", days: [1], revision: 1, exercises: w.exercises,
  };
}
const discard = async (page: Page) => {
  await page.getByTitle("Отменить тренировку без сохранения").click();
  const yes = page.getByRole("button", { name: "Да, отменить тренировку", exact: true });
  if (await yes.isVisible().catch(() => false)) await yes.click();
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
};
const setsOnScreen = (page: Page) => page.getByLabel(/, подход \d+, вес$/).count();

test("R04-REQ02: «Применить разгрузку» сообщает результат, видна в «Программах» и на тренировке, «Отменить» возвращает прежние подходы", async ({ page }) => {
  await round01Fixture(page, { routines: [routineToday()] });
  await openTool(page, "Разгрузочная неделя");
  // «Небольшой записанный объём» — ни один формат не «Рекомендован».
  await expect(page.locator(".rec-badge")).toHaveCount(0);
  await page.getByRole("button", { name: "Применить разгрузку к тренировкам", exact: true }).click();
  const result = page.getByRole("dialog").getByRole("status").filter({ hasText: "Разгрузка на неделю" });
  await expect(result).toContainText("85% веса, 50% подходов — применена к программам Верх тела");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Отменить", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click();
  // В «Программах» видно, что разгрузка активна.
  await nav(page, "Программы").click();
  await expect(page.locator(".deload-active-banner")).toContainText("Разгрузка активна до");
  // Запуск программы — уменьшенный: 2 + 2 подхода, вес 80 × 85% → 67,5.
  await nav(page, "Сегодня").click();
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Название тренировки" })).toHaveValue("Верх тела [Разгрузка]");
  expect(await setsOnScreen(page)).toBe(4);
  await expect(page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("67.5");
  await discard(page);
  // «Отменить»: программа снова запускается прежней.
  await nav(page, "Программы").click();
  await page.locator(".deload-active-banner").getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(page.locator(".deload-active-banner")).toHaveCount(0);
  await nav(page, "Сегодня").click();
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  expect(await setsOnScreen(page)).toBe(6);
  await expect(page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("80");
});

test("R04-REQ02: без сохранённых программ — «Нечего менять», ничего не включается", async ({ page }) => {
  await round01Fixture(page);
  await openTool(page, "Разгрузочная неделя");
  await page.getByRole("button", { name: "Применить разгрузку к тренировкам", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("status").filter({ hasText: "Нечего менять" })).toContainText("нет сохранённых программ");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Отменить", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tyaga-deload")))).toEqual([]);
});

test.describe("R04-REQ03: код восстановления", () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

  test("«Мой профиль» → пароль → новый код; закрыть можно только после «Я сохранил код»", async ({ page }) => {
    const f = await round01Fixture(page);
    await page.locator(".profile-button").click();
    const dialog = page.getByRole("dialog", { name: "Мой профиль" });
    // Поля профиля по-прежнему доступны сразу (AGENTS.md §2.1).
    await expect(dialog.getByLabel("Имя", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Вес тела, кг", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Часовой пояс", { exact: true })).toBeVisible();
    await dialog.getByText("Код восстановления", { exact: true }).click();
    await dialog.getByLabel("Текущий пароль для нового кода").fill("wrong wrong wrong");
    await dialog.getByRole("button", { name: "Выпустить новый код", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Текущий пароль не подошёл");
    await expect(page.getByRole("dialog", { name: "Код восстановления" })).toHaveCount(0);
    await dialog.getByLabel("Текущий пароль для нового кода").fill("correct horse battery");
    await dialog.getByRole("button", { name: "Выпустить новый код", exact: true }).click();
    const code = page.getByRole("dialog", { name: "Код восстановления" });
    await expect(code.locator(".recovery-code")).toHaveText(/^[a-f0-9]{32}$/);
    await expect(code).toContainText("Прежний больше не подходит");
    const done = code.getByRole("button", { name: "Код сохранён", exact: true });
    await expect(done).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(code.getByRole("alert")).toContainText("отметь «Я сохранил код»");
    await expect(code).toBeVisible();
    await code.getByLabel("Я сохранил код").check();
    await expect(done).toBeEnabled();
    await done.click();
    await expect(code).toHaveCount(0);
    expect(f.recoveryRequests).toHaveLength(2);
  });

  test("регистрация: окно с кодом нельзя закрыть без подтверждения; на экране «Забыл пароль» — что делать без кода", async ({ page }) => {
    await round01Fixture(page, { signedOut: true });
    await page.getByRole("button", { name: "Забыл пароль", exact: true }).click();
    await expect(page.locator(".recover-no-code")).toContainText("Нет кода?");
    await expect(page.locator(".recover-no-code")).toContainText("выпусти новый код в профиле");
    await page.getByRole("button", { name: "Вернуться ко входу", exact: true }).click();
    await page.getByRole("button", { name: "Регистрация", exact: true }).click();
    await page.getByLabel("Как тебя зовут").fill("Саша");
    await page.getByLabel("Почта").fill("fresh@example.test");
    await page.getByLabel("Пароль", { exact: true }).fill("correct horse battery");
    await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Код восстановления" });
    await expect(dialog).toContainText("RECOVERY-1");
    await expect(dialog).toContainText("выпусти новый в профиле");
    await expect(dialog.getByRole("button", { name: "Код сохранён", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Я сохранил код").check();
    await dialog.getByRole("button", { name: "Код сохранён", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
});

for (const size of SIZES) {
  test(`R04-REQ04: комната на экране тренировки ${size.width}×${size.height} — плашка с кодом и числом участников, «Поделиться», «Выйти из комнаты» с вопросом, без перекрытия`, async ({ page }) => {
    await page.setViewportSize(size);
    await round01Fixture(page);
    const live = await mockLive(page, liveMock(roomWithPartner()));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
    await startWith(page, BENCH);
    const badge = page.locator(".room-badge");
    await expect(badge).toContainText(`Комната ${ROOM_CODE} · 2 участника`);
    await expect(badge.getByRole("button", { name: "Поделиться", exact: true })).toBeVisible();
    // Отметить подход, чтобы появился таймер отдыха, и проверить, что плашка ничего не перекрывает.
    await page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true }).fill("60");
    await page.getByLabel(`${BENCH}, подход 1, повторы`, { exact: true }).fill("8");
    await page.getByRole("button", { name: `Отметить выполненным: ${BENCH}, подход 1`, exact: true }).click();
    await expect(page.locator(".workout-dock")).toBeVisible();
    const boxes = await page.evaluate(() => {
      const rect = (s: string) => document.querySelector(s)?.getBoundingClientRect();
      const b = rect(".room-badge")!, d = rect(".workout-dock")!;
      const check = [...document.querySelectorAll<HTMLElement>("button")].find((x) => x.getAttribute("aria-label")?.startsWith("Снять отметку"))!.getBoundingClientRect();
      const hit = (a: DOMRect, c: DOMRect) => !(a.right <= c.left || a.left >= c.right || a.bottom <= c.top || a.top >= c.bottom);
      return { dock: hit(b, d), check: hit(b, check), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(boxes.dock, "плашка не перекрывает таймер отдыха").toBe(false);
    expect(boxes.check, "плашка не перекрывает ✓").toBe(false);
    expect(boxes.overflow).toBeLessThanOrEqual(0);
    for (const button of await badge.getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(43.99);
      expect(box.height).toBeGreaterThanOrEqual(43.99);
    }
    // Выход — со вторым касанием: вопрос, «Остаться» ничего не меняет, «Выйти» выходит.
    await badge.getByRole("button", { name: "Выйти из комнаты", exact: true }).click();
    await expect(badge.getByRole("alertdialog")).toContainText("Напарники перестанут видеть твою тренировку");
    await badge.getByRole("button", { name: "Остаться", exact: true }).click();
    await expect(badge.getByRole("alertdialog")).toHaveCount(0);
    expect(live.seen.filter((s) => s.startsWith("DELETE"))).toEqual([]);
    await badge.getByRole("button", { name: "Выйти из комнаты", exact: true }).click();
    await badge.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page.locator(".room-badge")).toHaveCount(0);
    expect(live.seen).toContain("DELETE /api/friends/live");
    // Сама тренировка продолжается.
    await expect(page.getByRole("button", { name: `Снять отметку: ${BENCH}, подход 1`, exact: true })).toBeVisible();
  });
}

test("R04-REQ04: вне комнаты плашки нет", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, BENCH);
  await expect(page.locator(".room-badge")).toHaveCount(0);
});

for (const size of SIZES) {
  test(`R04-REQ05: калькуляторы блинов, 1ПМ и лесенки ${size.width}×${size.height} — все цели ≥44×44, без горизонтального скролла, один крестик у блинов`, async ({ page }) => {
    await page.setViewportSize(size);
    await round01Fixture(page);
    for (const [tool, title] of [["Калькулятор блинов", "Калькулятор блинов"], ["Калькулятор 1ПМ", "Калькулятор 1ПМ"], ["Разминочная лесенка", "Разминочная лесенка (OpenGym)"]] as const) {
      await openTool(page, tool);
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeVisible();
      expect(await smallTargets(page), `${tool}: цели меньше 44×44`).toEqual([]);
      expect(await overflow(page), `${tool}: горизонтальный скролл`).toBeLessThanOrEqual(0);
      if (tool === "Калькулятор блинов") {
        await expect(dialog.getByRole("button", { name: /^Закрыть/ })).toHaveCount(1);
        await expect(dialog.getByRole("button", { name: "Закрыть окно", exact: true })).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
  });
}

test("R04-REQ06: калькуляторы без десятичной точки; 1ПМ 77,5 × 8 по умолчанию 98,2 (Эпли), как в «Зале рекордов»; поле «Вес, кг» с запятой", async ({ page }) => {
  await round01Fixture(page);
  await openTool(page, "Калькулятор блинов");
  await page.getByRole("button", { name: "Минус 2,5 кг", exact: true }).click();
  await expect(page.locator(".target-val")).toHaveText("77,5");
  await expect(page.locator(".barbell-sleeve-label b")).toHaveText("28,75 кг");
  await expect(page.getByRole("dialog")).not.toContainText(/\d\.\d/);
  await page.keyboard.press("Escape");
  await openTool(page, "Калькулятор 1ПМ");
  const weight = page.getByLabel("Рабочий вес, кг", { exact: true });
  await weight.fill("77.5");
  await expect(page.locator(".orm-hero-digits")).toHaveText("98,2");
  await expect(page.locator(".formula-primary")).toContainText("Epley (основная): 98,2 кг");
  await expect(page.locator(".orm-formula-note")).toContainText("Основная формула в приложении — Эпли");
  await expect(page.getByRole("dialog")).not.toContainText(/\d\.\d/);
  await page.keyboard.press("Escape");
  await openTool(page, "Разминочная лесенка");
  await expect(page.getByRole("dialog")).not.toContainText(/\d\.\d/);
  await page.keyboard.press("Escape");
  // «Вес тела»: после сохранения 80.6 поле показывает 80,6.
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Вес тела", exact: true }).click();
  await page.getByLabel("Вес, кг", { exact: true }).fill("80.6");
  await page.getByRole("button", { name: "Сохранить замер", exact: true }).click();
  await expect(page.getByLabel("Вес, кг", { exact: true })).toHaveValue("80,6");
});

test("R04-REQ06: «Зал рекордов» считает 77,5 × 8 так же, как калькулятор (98,2 кг)", async ({ page }) => {
  const { doneWorkout } = await import("./fixtures/round01");
  const w = doneWorkout("Грудь", "2026-11-03", [["bench", 77.5, 8, 1]]);
  await round01Fixture(page, { workouts: [w] });
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Сила", exact: true }).click();
  await expect(page.getByText(/98,2/).first()).toBeVisible();
});

for (const size of SIZES) {
  test(`R04-REQ07: «Быстрая правка» ${size.width}×${size.height} — кнопки панели и «Контекст подхода» ≥44×44, строка ≤56 px, без скролла, ✓ не перекрыт`, async ({ page }) => {
    await page.setViewportSize(size);
    await round01Fixture(page);
    await startWith(page, BENCH);
    const weight = page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true });
    await weight.fill("60");
    await weight.focus();
    await expect(page.getByRole("button", { name: /^Контекст подхода 1/ })).toBeVisible();
    const m = await page.evaluate(() => {
      const dock = document.querySelector<HTMLElement>(".set-quick-controls-dock")!;
      const small = [...dock.querySelectorAll<HTMLElement>("button")]
        .map((b) => ({ n: b.getAttribute("aria-label") ?? b.textContent?.trim(), r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.width < 43.99 || r.height < 43.99)
        .map(({ n, r }) => `${n}|${r.width.toFixed(1)}×${r.height.toFixed(1)}`);
      const row = document.querySelector<HTMLElement>(".set-row")!.getBoundingClientRect();
      const tick = [...document.querySelectorAll<HTMLElement>("button")].find((b) => b.getAttribute("aria-label")?.startsWith("Отметить выполненным"))!.getBoundingClientRect();
      const buttons = [...dock.querySelectorAll<HTMLElement>("button")].map((b) => b.getBoundingClientRect());
      const hit = buttons.some((r) => !(r.right <= tick.left || r.left >= tick.right || r.bottom <= tick.top || r.top >= tick.bottom));
      return { small, row: row.height, hit, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(m.small, "кнопки панели меньше 44×44").toEqual([]);
    expect(m.row).toBeLessThanOrEqual(56);
    expect(m.hit, "панель не перекрывает ✓").toBe(false);
    expect(m.overflow).toBeLessThanOrEqual(0);
  });
}

test("R04-REQ08: у групп мышц одно название в «Мышцах» и «Ориентирах»; часовой пояс выбирается из списка, определяется автоматически", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await round01Fixture(page);
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  const muscles = await page.locator("main").innerText();
  for (const name of ["Сгибатели рук", "Икры", "Пресс", "Задняя часть бедра"]) expect(muscles, `«${name}» в «Мышцах»`).toContain(name);
  for (const old of ["Сгибатели локтя", "Мышцы голени", "Мышцы живота", "Задняя поверхность бедра", "Ягодицы и приводящие"]) expect(muscles).not.toContain(old);
  // «Мои ориентиры» (настройки): те же названия и список поясов.
  await page.getByRole("button", { name: /Мои ориентиры|Настройки/ }).first().click().catch(async () => openTool(page, /Мои ориентиры|Настройки/));
  const dialog = page.getByRole("dialog").last();
  const targets = await dialog.innerText();
  for (const name of ["Сгибатели рук", "Икры", "Пресс", "Задняя часть бедра"]) expect(targets, `«${name}» в «Ориентирах»`).toContain(name);
  for (const old of ["Сгибатели локтя", "Мышцы голени", "Мышцы живота", "Задняя поверхность бедра", "Ягодицы и приводящие"]) expect(targets).not.toContain(old);
  const zone = dialog.getByLabel("Часовой пояс календаря", { exact: true });
  await expect(zone).toBeVisible();
  await dialog.getByLabel("Выбрать пояс из списка").selectOption("Europe/Saratov");
  await expect(zone).toHaveValue("Europe/Saratov");
  await expect(dialog.getByText("Сейчас: Саратов, UTC+4.")).toBeVisible();
  await dialog.getByLabel("Выбрать пояс из списка").selectOption("Europe/Moscow");
  await expect(zone).toHaveValue("Europe/Moscow");
  await expect(dialog.getByText("Сейчас: Москва, UTC+3.")).toBeVisible();
  await dialog.getByRole("button", { name: /^Определить автоматически/ }).click();
  await expect(zone).toHaveValue("Europe/Saratov");
});

test("R04-REQ08: в профиле часовой пояс выбирается из списка и сохраняется; ручной ввод остаётся", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const f = await round01Fixture(page);
  await page.locator(".profile-button").click();
  const dialog = page.getByRole("dialog", { name: "Мой профиль" });
  await dialog.getByLabel("Выбрать пояс из списка").selectOption("Asia/Yekaterinburg");
  await expect(dialog.getByLabel("Часовой пояс", { exact: true })).toHaveValue("Asia/Yekaterinburg");
  await expect(dialog.getByText("Сейчас: Екатеринбург, UTC+5.")).toBeVisible();
  await dialog.getByRole("button", { name: "Сохранить профиль", exact: true }).click();
  await expect(dialog.getByText("Профиль сохранён", { exact: true })).toBeVisible();
  expect((f.profileBodies.at(-1) as { timeZone: string }).timeZone).toBe("Asia/Yekaterinburg");
  await dialog.getByLabel("Часовой пояс", { exact: true }).fill("UTC");
  await expect(dialog.getByText("Сейчас: UTC, всемирное время.")).toBeVisible();
});

test("R04-REQ09: «Создать программу» — поле названия пустое, набранное имя не дописывается к чужому тексту", async ({ page }) => {
  await round01Fixture(page);
  await nav(page, "Программы").click();
  await page.getByRole("button", { name: /Создать программу|Новая программа/ }).first().click();
  const name = page.getByLabel("Название программы", { exact: true });
  await expect(name).toHaveValue("");
  await expect(name).toHaveAttribute("placeholder", /Мой push/);
  await name.pressSequentially("Мой push", { delay: 40 });
  await expect(name).toHaveValue("Мой push");
});

test("R04-REQ09: «База» → «присед» — «Приседания со штангой» в первых пяти строках", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await round01Fixture(page);
  await page.route("**/api/exercises**", (route) => {
    const names = ["Приседания", "Приседания сумо", "Приседание «дракон»", "Приседание «креветка»", "Приседание у стены", "Приседания на ящик"];
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        importing: false, total: names.length, catalogTotal: 918,
        exercises: names.map((name, i) => ({
          id: `wger:${i}`, name, nameEn: name, primary: ["quads"], secondary: [], equipment: "gym", tip: "",
          catalogRevision: 3, familyId: `wger-${i}`, variant: "", jointActions: [], aliases: [], muscles: [], evidence: [], limitations: "",
          provenance: { curator: "wger", reviewedAt: null, license: "CC-BY-SA", reviewStatus: "source-unreviewed" },
          recording: { type: "reps", loadMode: "total_external", implementCount: 1, laterality: "bilateral", repsMode: "total", e1rmEligible: false },
        })),
      }),
    });
  });
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: /^База/ }).click();
  await picker.getByLabel("Поиск упражнений").fill("присед");
  const titles = picker.locator("button[aria-label^='Добавить ']");
  await expect(titles.first()).toHaveAttribute("aria-label", "Добавить Приседания со штангой", { timeout: 10000 });
  const first5 = (await titles.evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute("aria-label"))));
  expect(first5).toContain("Добавить Приседания со штангой");
});
