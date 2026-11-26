import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { nav, round01Fixture, doneWorkout } from "./fixtures/round01";
import { smallTargets, clipped } from "./fixtures/touch";
import { LaidDupPlan } from "../../src/domain/LaidDupPlan";
import { TrainingProgram } from "../../src/domain/TrainingProgram";
import type { LaidMaxes, Routine, Workout } from "../../src/lib/types";

/**
 * Раунд 10: программа Дэвида Лейда (DUP, 9 недель, 6 дней) на телефоне (390×844, 360×800, 320×640).
 * Приложение на подставных ответах; «сегодня» — вторник 10 нояб. 2026, неделя с понедельника 9-го; подмена даты — через часы страницы.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "ru-RU", timezoneId: "Europe/Saratov" });

const SIZES = [{ width: 390, height: 844 }, { width: 360, height: 800 }, { width: 320, height: 640 }];
const MAXES: LaidMaxes = { squat: 100, bench: 80, deadlift: 140, ohp: 60 };
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const sixRoutines = (extras = true, light = false, startMonday = "2026-11-09") =>
  LaidDupPlan.routines({ maxes: MAXES, extras, light, startMonday }).map((r) => ({ ...r, revision: 1 }));

/** Приложение + программы в памяти: PUT /api/routines сохраняет, GET /api/product отдаёт (повторный вход видит то же). */
async function laidApp(page: Page, options: { routines?: Routine[]; workouts?: Workout[] } = {}) {
  await round01Fixture(page, { workouts: options.workouts });
  const store: Routine[] = [...(options.routines ?? [])];
  const puts: Routine[] = [];
  await page.route("**/api/product", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ routines: store, favorites: [], customExercises: [] }) }),
  );
  await page.route("**/api/routines", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as Routine;
    const at = store.findIndex((r) => r.id === body.id);
    const saved = { ...body, revision: (at === -1 ? 0 : store[at].revision) + 1, updatedAt: new Date().toISOString() };
    if (at === -1) store.unshift(saved);
    else store[at] = saved;
    puts.push(saved);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ routine: saved }) });
  });
  await page.reload();
  return { store, puts };
}
/** Шесть дней цикла живут под спойлером «Отдельные дни цикла Лейда» — раскрываем его, чтобы карточки были видны. */
const openLaidDays = async (page: Page) => {
  const disclosure = page.locator("details.laid-routines-disclosure").first();
  await disclosure.waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
  if (!(await disclosure.count())) return;
  await disclosure.evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
};
const openPrograms = async (page: Page) => {
  await nav(page, "Программы").click();
  await expect(page.getByRole("heading", { name: "Сохранённые программы" })).toBeVisible();
  await openLaidDays(page);
};
/** Подмена даты: часы страницы показывают `iso`, приложение перезагружается. */
const setToday = async (page: Page, iso: string) => {
  await page.clock.setFixedTime(new Date(`${iso}T12:00:00Z`));
  await page.reload();
};
const card = (page: Page, name: string) => page.locator("article.routine-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
const dialog = (page: Page) => page.getByRole("dialog");
/** Цели касания в окне: каждый элемент сначала прокручивается в видимую часть окна, потом меряется (размер ≥ 44 px, не перекрыт). */
async function touchInDialog(page: Page) {
  const out: string[] = [];
  const items = await dialog(page).locator("button, a, input:not([type=hidden]), select, summary").elementHandles();
  for (const el of items) {
    await el.evaluate((raw) => (raw as HTMLElement).scrollIntoView({ block: "center" }));
    const bad = await el.evaluate((raw) => {
      const node = raw as HTMLElement;
      const style = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || r.width === 0 || r.height === 0) return null;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const covered = !!hit && hit !== node && !node.contains(hit) && !hit.contains(node);
      if (r.width + 0.5 >= 44 && r.height + 0.5 >= 44 && !covered) return null;
      return `${node.innerText?.trim().slice(0, 40) || node.getAttribute("placeholder") || node.tagName} ${Math.round(r.width)}×${Math.round(r.height)}${covered ? ` перекрыт ${(hit as HTMLElement)?.tagName}.${(hit as HTMLElement)?.className}` : ""}`;
    });
    if (bad) out.push(bad);
  }
  return out;
}


async function fillMaxes(page: Page, m: LaidMaxes = MAXES) {
  const d = dialog(page);
  await d.getByLabel("1ПМ: присед").fill(String(m.squat).replace(".", ","));
  await d.getByLabel("1ПМ: жим лёжа").fill(String(m.bench));
  await d.getByLabel("1ПМ: становая").fill(String(m.deadlift));
  await d.getByLabel("1ПМ: армейский жим").fill(String(m.ohp));
}

/** Начать программу и вернуть значения подходов базового упражнения: «вес×повторы». */
async function startAndRead(page: Page, routineName: string, exercise: string, count = 5) {
  await openPrograms(page);
  await card(page, routineName).getByRole("button", { name: "Начать", exact: true }).click();
  await expect(page.getByLabel(`${exercise}, подход 1, вес`, { exact: true })).toBeVisible();
  const out: string[] = [];
  for (let n = 1; n <= count; n++)
    out.push(`${await page.getByLabel(`${exercise}, подход ${n}, вес`, { exact: true }).inputValue()}×${await page.getByLabel(`${exercise}, подход ${n}, повторы`, { exact: true }).inputValue()}`);
  return out;
}
async function discard(page: Page) {
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  // подтверждение спрашивается, только если есть отмеченные подходы
  const yes = page.getByRole("button", { name: "Да, отменить тренировку", exact: true });
  if (await yes.isVisible().catch(() => false)) await yes.click();
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
}

// ───────────── R10-REQ02: создание программы ─────────────
for (const size of SIZES) {
  test(`R10-REQ02: окно «Дэвид Лейд» ${size.width}×${size.height} — четыре максимума, ошибки, старт, переключатели, без скролла и обрезки; цели ≥ 44 px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(size);
    await laidApp(page);
    await openPrograms(page);
    await expect(page.getByRole("button", { name: /Дэвид Лейд · DUP · 9 недель · 6 дней/ })).toBeVisible();
    await page.getByRole("button", { name: /Дэвид Лейд · DUP · 9 недель · 6 дней/ }).click();
    const d = dialog(page);
    for (const label of ["1ПМ: присед", "1ПМ: жим лёжа", "1ПМ: становая", "1ПМ: армейский жим"]) await expect(d.getByLabel(label)).toBeVisible();
    await expect(d).toContainText("1ПМ — максимум на одно повторение; вводи осторожный тренировочный максимум (92,5 % от 1ПМ)");
    await expect(d).toContainText("Шесть тренировок в неделю и тяжёлые подходы — вводи осторожный тренировочный максимум (90–95 % от реального 1ПМ)");
    await expect(d).toContainText("Веса восстановлены по опубликованной таблице и округлены; официальный калькулятор может дать другие числа");
    // сегодня вторник: по умолчанию «с понедельника этой недели»
    await expect(d.getByRole("button", { name: /^с понедельника этой недели/ })).toHaveAttribute("aria-pressed", "true");
    await expect(d.getByRole("button", { name: /^со следующего понедельника/ })).toHaveAttribute("aria-pressed", "false");
    await expect(d.getByRole("switch", { name: /^Добавить к оригиналу: задняя дельта, отведения, икры, пресс/ })).toHaveAttribute("aria-checked", "true");
    await expect(d.getByRole("switch", { name: /^Облегчённо: вместо одного повторения — три/ })).toHaveAttribute("aria-checked", "false");
    // пустые поля: создать нельзя, причина названа
    await d.getByRole("button", { name: "Создать программу", exact: true }).click();
    await expect(d.getByText("Введи максимум в килограммах.").first()).toBeVisible();
    await d.getByLabel("1ПМ: присед").fill("0");
    await d.getByLabel("1ПМ: жим лёжа").fill("501");
    await d.getByLabel("1ПМ: становая").fill("abc");
    await d.getByRole("button", { name: "Создать программу", exact: true }).click();
    await expect(d.getByText("Максимум должен быть больше нуля.")).toBeVisible();
    await expect(d.getByText("Максимум не больше 500 кг: проверь число.")).toBeVisible();
    await expect(d.getByText("Максимум — число в килограммах.")).toBeVisible();
    await expect(dialog(page)).toHaveCount(1);
    await fillMaxes(page);
    await expect(d.getByRole("list", { name: "Занятые дни" })).toHaveCount(0);
    await expect(d.locator(".laid-preview")).toContainText("1 × 5 × 85 кг · 4 × 12 × 65 кг");
    await expect(d.locator(".laid-preview")).toContainText("1 × 1 × 75 кг · 4 × 4 × 67,5 кг");
    await expect(d.locator(".laid-preview")).toContainText("1 × 1 × 132,5 кг · 4 × 2 × 130 кг");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    expect(await touchInDialog(page)).toEqual([]);
    expect((await clipped(page, "dialog[open]")).wide).toEqual([]);
    expect(await d.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  });
}

test("R10-REQ02: «Создать программу» — шесть программ с русскими названиями, ритмом 3 + 1 + 3 по умолчанию, общей настройкой и выбранным стартом", async ({ page }) => {
  test.setTimeout(90_000);
  const { puts } = await laidApp(page);
  await openPrograms(page);
  await page.getByRole("button", { name: /Дэвид Лейд · DUP/ }).click();
  await fillMaxes(page);
  await dialog(page).getByRole("button", { name: /^со следующего понедельника/ }).click();
  await dialog(page).getByRole("button", { name: "Создать программу", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await openLaidDays(page);
  for (const name of ["Лейд · Ноги 1", "Лейд · Жим 1", "Лейд · Тяга 1", "Лейд · Ноги 2", "Лейд · Жим 2", "Лейд · Тяга 2"])
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect(puts).toHaveLength(6);
  // по умолчанию — 3 + 1 + 3: Пн, Вт, Ср, Пт, Сб, Вс (четверг — выходной)
  expect(puts.map((r) => r.days)).toEqual([[0], [1], [2], [4], [5], [6]]);
  expect(new Set(puts.map((r) => r.periodization!.cycleId)).size).toBe(1);
  for (const r of puts) {
    expect(r.periodization).toMatchObject({ kind: "laid-dup", startMonday: "2026-11-16", maxes: MAXES, maxesFromWeek: 0, extras: true, light: false });
    expect(r.cycle).toBeUndefined();
  }
  await expect(page.locator(".laid-notice")).toContainText("Программа Лейда создана");
  // карточка Лейда: до старта — старт и «Впереди»
  const lead = page.getByLabel("Программа Дэвида Лейда");
  await expect(lead).toContainText("Старт 16 нояб. · неделя 1 из 9 · волна 1");
  await expect(lead.getByText("Пропущена")).toHaveCount(0);
  // состав без выдуманных чисел: у Ноги 1 подписи упражнений как у Лейда
  await expect(card(page, "Лейд · Ноги 1")).toContainText("Приседания со штангой");
});

test("R10-REQ02: «Пн уже занят программой …» — окно говорит об этом до создания; наложение разрешено, четверг свободен", async ({ page }) => {
  const mine = { ...TrainingProgram.empty(), id: "mine", name: "Моя тяга", days: [0, 3], exercises: [TrainingProgram.starter("full")[0].exercises[0]], revision: 1 };
  await laidApp(page, { routines: [mine] });
  await openPrograms(page);
  await page.getByRole("button", { name: /Дэвид Лейд · DUP/ }).click();
  const taken = dialog(page).getByRole("list", { name: "Занятые дни" });
  await expect(taken).toContainText("Пн уже занят программой «Моя тяга»: обе будут в плане недели.");
  await expect(taken).not.toContainText("Вт уже занят");
  // 3 + 1 + 3: четверг — выходной, поэтому «Моя тяга» в четверг никому не мешает
  await expect(taken).not.toContainText("Чт уже занят");
  await fillMaxes(page);
  await dialog(page).getByRole("button", { name: "Создать программу", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await openLaidDays(page);
  await expect(page.getByRole("heading", { name: "Лейд · Ноги 1", exact: true })).toBeVisible();
});

test("R10-REQ02: подсказка по истории подставляет тренировочный максимум (92,5 %), а в режиме 100 % — оценку Эпли", async ({ page }) => {
  const history = doneWorkout("Жим", "2026-11-02", [["bench", 100, 8, 3]]);
  await laidApp(page, { workouts: [history] });
  await openPrograms(page);
  await page.getByRole("button", { name: /Дэвид Лейд · DUP/ }).click();
  const d = dialog(page);
  // по умолчанию включён тренировочный максимум: 92,5 % от оценки Эпли
  const hint = d.getByRole("button", { name: /^ТМ 92,5 % ≈ 117,5 кг \(1ПМ 126,7\)$/ });
  await expect(hint).toBeVisible();
  await expect(d.getByRole("button", { name: /^ТМ 92,5 % ≈/ })).toHaveCount(1);
  await hint.click();
  await expect(d.getByLabel("1ПМ: жим лёжа")).toHaveValue("117,5");
  // выключили тренировочный максимум — подсказка возвращается к чистой оценке Эпли
  await d.getByRole("button", { name: /^ТМ 92,5 % · вкл$/ }).click();
  await d.getByLabel("1ПМ: жим лёжа").fill("");
  const plain = d.getByRole("button", { name: "по истории ≈ 126,7 кг (Эпли)" });
  await expect(plain).toBeVisible();
  await plain.click();
  await expect(d.getByLabel("1ПМ: жим лёжа")).toHaveValue("126,7");
});

test("R10-REQ02: переключатель «Добавить к оригиналу» выключен — добавленных упражнений в программах нет; «Облегчённо» — три повторения", async ({ page }) => {
  test.setTimeout(90_000);
  const { puts } = await laidApp(page);
  await openPrograms(page);
  await page.getByRole("button", { name: /Дэвид Лейд · DUP/ }).click();
  await fillMaxes(page);
  await dialog(page).getByRole("switch", { name: /^Добавить к оригиналу: задняя дельта, отведения, икры, пресс/ }).click();
  await dialog(page).getByRole("switch", { name: /^Облегчённо: вместо одного повторения — три/ }).click();
  await dialog(page).getByRole("button", { name: "Создать программу", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const ids = puts.flatMap((r) => r.exercises.map((e) => e.exerciseId));
  for (const added of ["rear-delt-fly", "lateral-cable-single", "calf-standing-machine", "calf-seated", "hanging-leg-raise", "ab-roller"]) expect(ids).not.toContain(added);
  expect(puts.every((r) => r.periodization!.extras === false && r.periodization!.light === true)).toBe(true);
  // неделя 2: по таблице 1 × 1 — облегчённо 1 × 3 × 90 %
  await setToday(page, "2026-11-17");
  expect(await startAndRead(page, "Лейд · Ноги 1", "Приседания со штангой")).toEqual(["90×3", "85×4", "85×4", "85×4", "85×4"]);
  await expect(page.getByText(/облегчённо, не по оригиналу/)).toBeVisible();
});

test("R10-REQ02: Лейд уже есть — повторное нажатие спрашивает: «Обновить максимумы» или «Создать ещё раз»; копий без спроса нет", async ({ page }) => {
  test.setTimeout(90_000);
  const { puts, store } = await laidApp(page, { routines: sixRoutines() });
  await openPrograms(page);
  await page.getByRole("button", { name: /Дэвид Лейд · DUP/ }).click();
  await expect(dialog(page)).toContainText("Программа Лейда уже есть");
  expect(puts).toHaveLength(0);
  await dialog(page).getByRole("button", { name: "Обновить максимумы", exact: true }).click();
  const d = dialog(page);
  await expect(d.getByLabel("1ПМ: присед")).toHaveValue("100");
  await d.getByLabel("1ПМ: присед").fill("110");
  await d.getByRole("button", { name: "Обновить максимумы", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(puts).toHaveLength(6);
  expect(store).toHaveLength(6);
  expect(puts.every((r) => r.periodization!.maxes.squat === 110 && r.periodization!.maxesFromWeek === 0)).toBe(true);
  await expect(page.locator(".laid-notice")).toContainText("Максимумы обновлены");
  // «Создать ещё раз» добавляет второй цикл — только по явному выбору
  await page.getByRole("button", { name: /Дэвид Лейд · DUP/ }).click();
  await dialog(page).getByRole("button", { name: "Добавить ещё один", exact: true }).click();
  await expect(dialog(page).getByLabel("1ПМ: присед")).toHaveValue("");
});

test("DUP v2: «Улучшить программу» доступна в окне «Обновить максимумы» и переводит весь цикл на v2 одной кнопкой; после апгрейда старые переключатели скрыты", async ({ page }) => {
  test.setTimeout(90_000);
  const { store } = await laidApp(page, { routines: sixRoutines() });
  await openPrograms(page);
  await page.getByRole("button", { name: /Дэвид Лейд · DUP/ }).click();
  await dialog(page).getByRole("button", { name: "Обновить максимумы", exact: true }).click();
  const d = dialog(page);
  const upgrade = d.getByRole("button", { name: "Улучшить программу", exact: true });
  await expect(upgrade).toBeVisible();
  await upgrade.click();
  await expect(dialog(page)).toHaveCount(0);
  expect(store).toHaveLength(6);
  expect(store.every((r) => r.periodization!.version === "v2")).toBe(true);
  await expect(page.locator(".laid-notice")).toContainText("Умного DUP v2");
  // Карточка переименовалась и перестала предлагать апгрейд
  await expect(page.getByRole("heading", { name: "Умный DUP v2 · Баланс и защита" })).toBeVisible();
  await expect(page.locator(".laid-v2-upgrade-btn")).toHaveCount(0);
  // В окне «Обновить максимумы» цикла v2 переключателей больше нет: цикл управляется сам
  await page.getByRole("button", { name: /Дэвид Лейд · DUP/ }).click();
  await dialog(page).getByRole("button", { name: "Обновить максимумы", exact: true }).click();
  const d2 = dialog(page);
  await expect(d2.getByText("Умный DUP v2 · Баланс и защита")).toBeVisible();
  await expect(d2.getByRole("switch", { name: /Плавающая неделя/ })).toHaveCount(0);
  await expect(d2.getByRole("button", { name: "Улучшить программу", exact: true })).toHaveCount(0);
});

// ───────────── R10-REQ03: тренировка по плану ─────────────
test("R10-REQ03: критерий 3 — Ноги 1, Жим 1, Тяга 2 недели 1: тяжёлый подход и четыре рабочих; заметка недели; «добавлено» помечено", async ({ page }) => {
  test.setTimeout(120_000);
  await laidApp(page, { routines: sixRoutines() });
  expect(await startAndRead(page, "Лейд · Ноги 1", "Приседания со штангой")).toEqual(["85×5", "65×12", "65×12", "65×12", "65×12"]);
  await expect(page.getByText("Тяжёлый подход: 1 × 5 повторений · 85 % от 1ПМ (100 кг) = 85 кг.")).toBeVisible();
  await expect(page.getByText("Затем 4 × 12 повторений · 65 % = 65 кг.")).toBeVisible();
  // план недели теперь читается в самом экране (плашка фазы + заметка упражнения), а не дублируется в поле заметок
  await expect(page.getByText(/Неделя 1 из 9 · волна 1\. Тяжёлый подход/).first()).toBeVisible();
  await expect(page.getByText("Добавлено к оригиналу Лейда: в его таблице этого нет.").first()).toBeVisible();
  await expect(page.getByText("Добавлено к оригиналу Лейда: в его таблице этого нет.")).toHaveCount(2);
  // вспомогательное: без выдуманных чисел — вес пуст
  await expect(page.getByLabel("Румынская тяга со штангой, подход 1, вес", { exact: true })).toHaveValue("");
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await discard(page);
  expect(await startAndRead(page, "Лейд · Жим 1", "Жим штанги лёжа")).toEqual(["75×1", "67.5×4", "67.5×4", "67.5×4", "67.5×4"]);
  await discard(page);
  expect(await startAndRead(page, "Лейд · Тяга 2", "Становая тяга со штангой")).toEqual(["132.5×1", "130×2", "130×2", "130×2", "130×2"]);
});

test("R10-REQ03: подмена даты — неделя 2, 5, 9 и 10 меняют схему; неделя 10 — схема недели 9 с пометкой «цикл закончен»", async ({ page }) => {
  test.setTimeout(150_000);
  await laidApp(page, { routines: sixRoutines() });
  const legs = "Приседания со штангой";
  await setToday(page, "2026-11-17");
  expect(await startAndRead(page, "Лейд · Ноги 1", legs)).toEqual(["95×1", "85×4", "85×4", "85×4", "85×4"]);
  await expect(page.getByText(/Неделя 2 из 9 · волна 1\./).first()).toBeVisible();
  await discard(page);
  await setToday(page, "2026-12-07");
  expect(await startAndRead(page, "Лейд · Ноги 1", legs)).toEqual(["97.5×1", "85×4", "85×4", "85×4", "85×4"]);
  await expect(page.getByText(/Неделя 5 из 9 · волна 2\./).first()).toBeVisible();
  await discard(page);
  await setToday(page, "2027-01-04");
  expect(await startAndRead(page, "Лейд · Ноги 1", legs)).toEqual(["92.5×3", "77.5×8", "77.5×8", "77.5×8", "77.5×8"]);
  await expect(page.getByText(/Неделя 9 из 9 · волна 3\./).first()).toBeVisible();
  await discard(page);
  await setToday(page, "2027-01-11");
  expect(await startAndRead(page, "Лейд · Ноги 1", legs)).toEqual(["92.5×3", "77.5×8", "77.5×8", "77.5×8", "77.5×8"]);
  await expect(page.getByText(/цикл закончен — обнови максимумы/).first()).toBeVisible();
});

test("R10-REQ03: пропущенный день не ломает следующий; «Сегодня» и карточка показывают «Пропущена» / «Сделана 10 нояб.»", async ({ page }) => {
  test.setTimeout(90_000);
  const routines = sixRoutines();
  const legs1 = routines[0];
  const saved: Workout = { ...doneWorkout("Лейд · Ноги 1", "2026-11-10", [["squat", 85, 5, 1]]), routineId: legs1.id };
  await laidApp(page, { routines, workouts: [saved] });
  await setToday(page, "2026-11-12");
  await openPrograms(page);
  const lead = page.getByLabel("Программа Дэвида Лейда");
  await expect(lead).toContainText("Неделя 1 из 9 · волна 1");
  const row = (name: string) => lead.locator("li", { hasText: name }).first();
  await expect(row("Ноги 1")).toContainText("Сделана 10 нояб.");
  await expect(row("Жим 1")).toContainText("Пропущена");
  await expect(row("Тяга 1")).toContainText("Пропущена");
  await expect(row("Ноги 2")).toContainText("Впереди");
  await expect(row("Жим 2")).toContainText("Впереди");
  await expect(card(page, "Лейд · Жим 1")).toContainText("Пропущена");
  await expect(card(page, "Лейд · Ноги 1")).toContainText("Сделана 10 нояб.");
  // пропущенный Жим 1 не сдвигает счёт: Ноги 2 собираются по неделе 1 — 1 × 3 × 90 кг, затем 4 × 8 × 75 кг
  expect(await startAndRead(page, "Лейд · Ноги 2", "Приседания со штангой")).toEqual(["90×3", "75×8", "75×8", "75×8", "75×8"]);
});

// ───────────── R10-REQ04: расписание на 9 недель ─────────────
for (const size of SIZES) {
  test(`R10-REQ04: «Расписание на 9 недель» ${size.width}×${size.height} — текущая неделя выделена, схемы числами, отметки; без скролла и обрезки`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(size);
    const routines = sixRoutines();
    const saved: Workout = { ...doneWorkout("Лейд · Ноги 1", "2026-11-10", [["squat", 85, 5, 1]]), routineId: routines[0].id };
    await laidApp(page, { routines, workouts: [saved] });
    await setToday(page, "2026-11-12");
    await openPrograms(page);
    expect(await smallTargets(page)).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    expect((await clipped(page)).wide).toEqual([]);
    await page.getByRole("button", { name: "Расписание (9 нед.)", exact: true }).click();
    const d = dialog(page);
    await expect(d.getByRole("heading", { name: "Расписание на 9 нед." })).toBeVisible();
    await expect(d).toContainText("Неделя 1 из 9 · волна 1");
    // восстановленные веса — честная оговорка, объяснение DUP не длиннее пяти предложений
    await expect(d).toContainText("Веса восстановлены по опубликованной таблице и округлены");
    const explain = (await d.locator(".laid-explain").innerText()).trim();
    expect(explain.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(5);
    expect(explain.length).toBeLessThan(520);
    // максимумы и «по истории»
    await expect(d.getByRole("list", { name: "Максимумы" })).toContainText("присед");
    await expect(d.getByRole("list", { name: "Максимумы" })).toContainText("100 кг");
    await expect(d.getByRole("list", { name: "Максимумы" })).toContainText("истории нет");
    // девять недель; текущая выделена и одна
    const weeks = d.locator(".laid-week-card");
    await expect(weeks).toHaveCount(9);
    await expect(d.locator(".laid-week-card.current")).toHaveCount(1);
    await expect(d.locator(".laid-week-card.current")).toContainText("Неделя 1 · волна 1");
    await expect(d.locator(".laid-week-card.current")).toContainText("сейчас");
    // схема каждого дня числами от введённых максимумов
    const w1 = weeks.nth(0);
    await expect(w1).toContainText("1 × 5 × 85 кг · 4 × 12 × 65 кг");
    await expect(w1).toContainText("1 × 1 × 75 кг · 4 × 4 × 67,5 кг");
    await expect(w1).toContainText("1 × 1 × 132,5 кг · 4 × 2 × 130 кг");
    await expect(w1.locator("li", { hasText: "Ноги 1" })).toContainText("Сделана 10 нояб.");
    await expect(w1.locator("li", { hasText: "Жим 1" })).toContainText("Пропущена");
    await expect(w1.locator("li", { hasText: "Тяга 2" })).toContainText("Впереди");
    await expect(weeks.nth(1).locator("li", { hasText: "Ноги 1" })).toContainText("Впереди");
    await expect(weeks.nth(1)).toContainText("1 × 1 × 95 кг · 4 × 4 × 85 кг");
    await expect(weeks.nth(3)).toContainText("1 × 5 × 85 кг · 4 × 12 × 65 кг");
    await expect(weeks.nth(8)).toContainText("Неделя 9 · волна 3");
    // фильтр волн Motion: выбор волны показывает 3 недели и баннер фазы, возврат — все 9
    await d.getByRole("button", { name: "Волна 2", exact: true }).click();
    await expect(weeks).toHaveCount(3);
    await expect(d.locator(".laid-wave-banner")).toContainText("Недели 4–6 · Интенсификация");
    await d.getByRole("button", { name: "Все 9 нед.", exact: true }).click();
    await expect(weeks).toHaveCount(9);
    // состав дней: оригинал и добавленное
    await d.getByText("Состав дней: оригинал и добавленное").click();
    await expect(d.locator(".laid-comp-day").first()).toContainText("Подъём на носки стоя в тренажёре");
    await expect(d.locator(".laid-comp-day").first()).toContainText("Подъём ног в висе");
    await expect(d.locator(".laid-comp-day").first().locator(".laid-origin.added").first()).toHaveText("добавлено");
    await expect(d.locator(".laid-comp-day").first().locator(".laid-origin.original").first()).toHaveText("оригинал");
    expect(await d.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    expect(await touchInDialog(page)).toEqual([]);
    expect((await clipped(page, "dialog[open]")).wide).toEqual([]);
    // плашки не сжаты и не обрезаны
    const chips = await d.locator(".laid-status, .laid-origin, .laid-now").evaluateAll((els) =>
      els.filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().height > 26).map((el) => (el as HTMLElement).innerText),
    );
    expect(chips).toEqual([]);
  });
}

test("R10-REQ04: на неделе 10 расписание говорит «цикл закончен — обнови максимумы», а кнопка начинает новый цикл с новой датой старта", async ({ page }) => {
  test.setTimeout(90_000);
  const { puts } = await laidApp(page, { routines: sixRoutines() });
  await setToday(page, "2027-01-11");
  await openPrograms(page);
  const lead = page.getByLabel("Программа Дэвида Лейда");
  await expect(lead).toContainText("Неделя 10 · схема недели 9 · цикл закончен — обнови максимумы");
  await lead.getByRole("button", { name: "Расписание (9 нед.)", exact: true }).click();
  await expect(dialog(page)).toContainText("цикл закончен — обнови максимумы");
  await dialog(page).getByRole("button", { name: "Начать новый цикл", exact: true }).first().click();
  const d = dialog(page);
  await expect(d.getByRole("heading", { name: "Новый цикл Лейда" })).toBeVisible();
  await d.getByLabel("1ПМ: присед").fill("105");
  await d.getByRole("button", { name: /^со следующего понедельника/ }).click();
  await d.getByRole("button", { name: "Начать новый цикл", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(puts).toHaveLength(6);
  expect(puts.every((r) => r.periodization!.startMonday === "2027-01-18" && r.periodization!.maxes.squat === 105 && r.periodization!.maxesFromWeek === 0 && !r.periodization!.earlier)).toBe(true);
  await expect(page.getByLabel("Программа Дэвида Лейда")).toContainText("Старт 18 янв. · неделя 1 из 9 · волна 1");
});

test("R10-REQ04: «Можно обновить максимум» — оценка по свежим подходам на 5 % выше; кнопка пересчитывает план с текущей недели", async ({ page }) => {
  test.setTimeout(90_000);
  // жим 90 × 1 — на 12,5 % выше введённых 80 → подсказка; присед 100 × 4 даёт 113,3 → тоже выше, но подсказки по неподходящим упражнениям нет
  const strong = doneWorkout("Жим", "2026-11-17", [["bench", 90, 1, 1]]);
  const { puts } = await laidApp(page, { routines: sixRoutines(), workouts: [strong] });
  await setToday(page, "2026-11-18");
  await openPrograms(page);
  const lead = page.getByLabel("Программа Дэвида Лейда");
  await expect(lead.locator(".laid-suggest")).toContainText("Можно обновить максимум: жим лёжа 80 → 90 кг.");
  await lead.getByRole("button", { name: "Пересчитать с недели 2", exact: true }).click();
  await expect(page.locator(".laid-notice")).toContainText("новые веса — с недели 2, прошлые недели не меняются");
  expect(puts).toHaveLength(6);
  for (const r of puts) expect(r.periodization).toMatchObject({ maxes: { ...MAXES, bench: 90 }, maxesFromWeek: 1, earlier: [{ fromWeek: 0, maxes: MAXES }] });
  await expect(lead.locator(".laid-suggest")).toHaveCount(0);
  // жим лёжа на этой неделе — от новых 90, а прошлая неделя осталась по 80
  await lead.getByRole("button", { name: "Расписание (9 нед.)", exact: true }).click();
  const weeks = dialog(page).locator(".laid-week-card");
  await expect(weeks.nth(0).locator("li", { hasText: "Жим 1" })).toContainText("1 × 1 × 75 кг");
  await expect(weeks.nth(1).locator("li", { hasText: "Жим 1" })).toContainText("1 × 3 × 80 кг · 4 × 8 × 67,5 кг");
});

// ───────────── R10-REQ05: редактирование дней и резервная копия ─────────────
test("R10-REQ05: дни программы Лейда меняются обычным редактором; периодизация и состав сохраняются", async ({ page }) => {
  test.setTimeout(90_000);
  const { puts } = await laidApp(page, { routines: sixRoutines() });
  await openPrograms(page);
  await page.getByRole("button", { name: "Редактировать программу Лейд · Ноги 1", exact: true }).click();
  const editor = dialog(page);
  await expect(editor.getByRole("heading", { name: "Редактировать программу" })).toBeVisible();
  await editor.getByRole("button", { name: "Пн", exact: true }).click();
  await editor.getByRole("button", { name: "Сб", exact: true }).click();
  await editor.getByRole("button", { name: "Сохранить программу", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(puts).toHaveLength(1);
  expect(puts[0].days).toEqual([5]);
  expect(puts[0].periodization).toMatchObject({ kind: "laid-dup", day: "legs1", maxes: MAXES });
  expect(puts[0].exercises[0].exerciseId).toBe("squat");
  expect(puts[0].exercises[0].sets).toHaveLength(5);
  // копия — обычная программа: в цикле Лейда у каждого дня одна запись
  await page.getByRole("button", { name: "Копировать программу Лейд · Жим 1", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Сохранить программу", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const copy = puts.at(-1)!;
  expect(copy.name).toBe("Лейд · Жим 1 (копия)");
  expect(copy.periodization).toBeUndefined();
});

test("R10-REQ05: резервная копия содержит периодизацию всех шести программ; старые программы целы", async ({ page }) => {
  test.setTimeout(90_000);
  const old = { ...TrainingProgram.empty(), id: "old", name: "Старая программа", days: [6], exercises: [TrainingProgram.starter("full")[0].exercises[0]], revision: 3 };
  await laidApp(page, { routines: [...sixRoutines(), old] });
  await page.getByRole("button", { name: "Ещё", exact: true }).last().click();
  await page.getByRole("button", { name: /^Резервная копия/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать полную копию", exact: true }).click();
  const backup = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const laid = (backup.routines as Routine[]).filter((r) => r.periodization);
  expect(laid).toHaveLength(6);
  expect(laid.map((r) => r.periodization!.day).sort()).toEqual([...LaidDupPlan.DAYS].sort());
  for (const r of laid) expect(r.periodization).toMatchObject({ kind: "laid-dup", startMonday: "2026-11-09", maxes: MAXES, extras: true, light: false });
  const untouched = (backup.routines as Routine[]).find((r) => r.id === "old")!;
  expect(untouched.periodization).toBeUndefined();
  expect(untouched.name).toBe("Старая программа");
  // повторный вход: программы и их периодизация читаются заново
  await page.reload();
  await openPrograms(page);
  await expect(page.getByLabel("Программа Дэвида Лейда")).toContainText("Неделя 1 из 9 · волна 1");
  await expect(page.getByRole("heading", { name: "Старая программа" })).toBeVisible();
});

// ───────────── Доработка 1 ─────────────
test("QA-R10-03: «Блины» на Лейде применяют вес только к тяжёлому подходу — откатные 4 × 65 и заметка остаются", async ({ page }) => {
  test.setTimeout(90_000);
  await laidApp(page, { routines: sixRoutines() });
  expect(await startAndRead(page, "Лейд · Ноги 1", "Приседания со штангой")).toEqual(["85×5", "65×12", "65×12", "65×12", "65×12"]);
  // кнопка «Блины» стоит прямо в шапке упражнения (без меню «Ещё для упражнения»)
  await page.getByRole("button", { name: "Блины: Приседания со штангой", exact: true }).first().click();
  const calc = dialog(page);
  await expect(calc.getByRole("button", { name: "Применить 85 кг к подходу 1", exact: true })).toBeVisible();
  await calc.getByRole("button", { name: "Плюс 2,5 кг", exact: true }).click();
  await calc.getByRole("button", { name: "Применить 87,5 кг к подходу 1", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  for (const [n, want] of [[1, "87.5"], [2, "65"], [3, "65"], [4, "65"], [5, "65"]] as const)
    await expect(page.getByLabel(`Приседания со штангой, подход ${n}, вес`, { exact: true })).toHaveValue(want);
  await expect(page.getByText("Затем 4 × 12 повторений · 65 % = 65 кг.")).toBeVisible();
});

test("QA-R10-07: программа с битой периодизацией, назначенная на сегодня, не гасит приложение — открывается как обычная", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const good = sixRoutines()[0];
  const variants: unknown[] = [
    { kind: "laid-dup" },
    { ...good.periodization, startMonday: "garbage", day: "xyz" },
    { ...good.periodization, maxes: "100" },
    { ...good.periodization, maxes: { ...MAXES, squat: -5 } },
  ];
  for (const bad of variants) {
    const routine = { ...good, id: "broken-laid", name: "Битая программа", days: [0, 1, 2, 3, 4, 5, 6], periodization: bad } as unknown as Routine;
    await laidApp(page, { routines: [routine] });
    await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
    for (const tab of ["История", "Прогресс", "Программы", "Сегодня"]) {
      await nav(page, tab).click();
      await expect(page.locator("main")).not.toBeEmpty();
    }
    await nav(page, "Программы").click();
    await expect(page.getByRole("heading", { name: "Сохранённые программы" })).toBeVisible();
    await expect(card(page, "Битая программа")).toBeVisible();
    // как обычная: без строки «Неделя N из 9»
    await expect(card(page, "Битая программа").getByText(/Неделя \d из 9/)).toHaveCount(0);
    await expect(page.getByLabel("Программа Дэвида Лейда")).toHaveCount(0);
    await card(page, "Битая программа").getByRole("button", { name: "Начать", exact: true }).click();
    await expect(page.getByLabel("Приседания со штангой, подход 1, вес").first()).toBeVisible();
    await discard(page);
  }
  expect(errors).toEqual([]);
});

test("QA-R10-07: сбой одной вкладки не гасит приложение — меню и другие вкладки остаются", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await round01Fixture(page);
  // «Программы» получают данные, на которых вкладка падает (exercises не массив)
  const bad = { ...sixRoutines()[0], id: "bad-shape", periodization: undefined, days: [], exercises: "нет" } as unknown as Routine;
  await page.route("**/api/product", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ routines: [bad], favorites: [], customExercises: [] }) }),
  );
  await page.reload();
  await nav(page, "Программы").click();
  await expect(page.getByRole("alert").filter({ hasText: "Не удалось открыть вкладку" })).toBeVisible();
  await expect(nav(page, "История")).toBeVisible();
  await nav(page, "История").click();
  await expect(page.getByRole("alert").filter({ hasText: "Не удалось открыть вкладку" })).toHaveCount(0);
  await expect(page.locator("main")).not.toBeEmpty();
});

test("QA-R10-08: редактор Лейда — у основного лифта пояснение вместо плоской схемы, схема не затирается; вспомогательные правятся как обычно", async ({ page }) => {
  test.setTimeout(90_000);
  const { puts } = await laidApp(page, { routines: sixRoutines() });
  await openPrograms(page);
  await page.getByRole("button", { name: "Редактировать программу Лейд · Ноги 1", exact: true }).click();
  const editor = dialog(page);
  const lift = editor.locator("article.routine-editor-exercise").first();
  await expect(lift.getByRole("heading", { name: "Приседания со штангой" })).toBeVisible();
  await expect(lift.getByTestId("laid-editor-note")).toContainText("Схема Лейда: веса и подходы считаются по неделе цикла; меняются максимумы и дни.");
  await expect(lift.getByTestId("laid-editor-note")).toContainText("Сейчас: 1 × 5 × 85 кг · 4 × 12 × 65 кг");
  await expect(lift.getByLabel("Начальный вес, кг")).toBeHidden();
  await expect(lift.getByLabel("Подходы", { exact: true })).toBeHidden();
  await expect(lift.getByLabel("Повторы", { exact: true })).toBeHidden();
  // вспомогательное — обычные поля
  const aux = editor.locator("article.routine-editor-exercise").nth(1);
  await expect(aux.getByLabel("Начальный вес, кг")).toBeEnabled();
  await expect(aux.getByTestId("laid-editor-note")).toHaveCount(0);
  await aux.getByLabel("Начальный вес, кг").fill("60");
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await editor.getByRole("button", { name: "Сохранить программу", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(puts).toHaveLength(1);
  const saved = puts[0];
  // периодизация цела, лифт — тот же набор подходов (1 + 4), не плоская схема
  expect(saved.periodization).toMatchObject({ kind: "laid-dup", day: "legs1", maxes: MAXES });
  expect(saved.exercises[0].sets.map((s) => [s.weight, s.reps])).toEqual([[85, 5], [65, 12], [65, 12], [65, 12], [65, 12]]);
  expect(saved.exercises[1].sets.every((s) => s.weight === 60)).toBe(true);
  // тренировка стартует по плану
  expect(await startAndRead(page, "Лейд · Ноги 1", "Приседания со штангой")).toEqual(["85×5", "65×12", "65×12", "65×12", "65×12"]);
});

test("QA-R10-06: шесть программ Лейда в «Программах» идут Пн → Сб, даже если пришли в обратном порядке", async ({ page }) => {
  test.setTimeout(60_000);
  await laidApp(page, { routines: [...sixRoutines()].reverse() });
  await openPrograms(page);
  const names = await page.locator("article.routine-card h3").allTextContents();
  expect(names.filter((n) => n.startsWith("Лейд"))).toEqual(LaidDupPlan.DAYS.map((d) => LaidDupPlan.NAMES[d]));
});

test("QA-R10-05: фиолетовая тема — акцентный текст Лейда не ниже 4,5:1", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem("tyaga_theme_accent", "violet"));
  await laidApp(page, { routines: sixRoutines() });
  await openPrograms(page);
  const worst = async () =>
    page.evaluate(() => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const bgOf = (el: Element) => {
        for (let n: Element | null = el; n; n = n.parentElement) {
          const [r, g, b, a = 1] = parse(getComputedStyle(n).backgroundColor);
          if (a > 0.5) return [r, g, b];
        }
        return [0, 0, 0];
      };
      const out: string[] = [];
      let seen = 0;
      for (const el of document.querySelectorAll(".laid-week, .laid-origin.added, .laid-switch-state, .laid-card .laid-phase-badge, .laid-status.done, .laid-estimate")) {
        const rect = el.getBoundingClientRect();
        if (!rect.width) continue;
        const fg = parse(getComputedStyle(el).color).slice(0, 3);
        const [l1, l2] = [lum(fg), lum(bgOf(el))].sort((a, b) => b - a);
        const ratio = (l1 + 0.05) / (l2 + 0.05);
        seen++;
        if (ratio < 4.5) out.push(`${(el as HTMLElement).className} ${ratio.toFixed(2)}`);
      }
      return { seen, out };
    });
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme-accent"))).toBe("violet");
  const card = await worst();
  expect(card.seen, "проверены неделя, фаза и статусы карточки").toBeGreaterThanOrEqual(2);
  expect(card.out).toEqual([]);
  await page.getByRole("button", { name: "Расписание (9 нед.)" }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByText("Состав дней: оригинал и добавленное").click();
  const schedule = await worst();
  expect(schedule.seen).toBeGreaterThan(card.seen);
  expect(schedule.out).toEqual([]);
});

// ───────────── Доработка 2 ─────────────
/**
 * Только для теста: бандл подменяется на лету — подпись вкладки превращается в выражение, бросающее ошибку,
 * пока в странице стоит флаг.
 * Каждая вкладка теперь ленивая и обёрнута собственной границей ошибок, поэтому сбой тела вкладки
 * показывает панель «Не удалось открыть вкладку» и оставляет навигацию живой — корневая панель
 * ловит только сбой оболочки (её проверяют отдельные тесты ниже).
 */
// Подпись выбирается внутри тела вкладки: сбой шапки ловит корневая граница (её проверяют тесты
// с SHELL_LITERAL), а нам нужен именно сбой ленивой вкладки. У «Сегодня» и «Упражнений» подходящего
// литерала в теле нет — их границы покрывает тест «сбой внутри вкладки-компонента» ниже.
const FAULTS: { tab: string; literal: string }[] = [
  { tab: "История", literal: 'children:"История тренировок"' },
  { tab: "Прогресс", literal: 'children:"Прогресс"' },
];
/** Литерал оболочки (заголовок шапки): сбой здесь обязан поймать корневая граница. */
const SHELL_LITERAL = 'children:"Сегодня"';
async function injectFault(page: Page) {
  // чанки: подписи вкладок живут и в index-*.js, и в App-*.js — патчим любой JS-чанк
  await page.route("**/assets/*.js", async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    const patch = (literal: string, tab: string) => {
      const text = literal.slice(literal.indexOf('"') + 1, -1);
      body = body.replace(
        literal,
        `children:(window.__fault===${JSON.stringify(tab)}?(()=>{throw new Error("fault-${tab}")})():${JSON.stringify(text)})`,
      );
    };
    patch(SHELL_LITERAL, "Сегодня");
    for (const { tab, literal } of FAULTS) patch(literal, tab);
    await route.fulfill({ response, body });
  });
}
for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  for (const { tab } of FAULTS) {
    test(`QA-R10-09: сбой в теле «${tab}» — панель вкладки, живая навигация и «Попробовать снова» ${size.width}×${size.height}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(size);
      const consoleErrors: string[] = [];
      page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
      await injectFault(page);
      await round01Fixture(page);
      // флаг ставится в уже открытой странице; на «Сегодня» сначала уходим на другую вкладку
      if (tab === "Сегодня") await nav(page, "История").click();
      await page.evaluate((name) => ((window as unknown as { __fault: string }).__fault = name), tab);
      await nav(page, tab).click();
      const panel = page.getByRole("alert").filter({ hasText: "Не удалось открыть вкладку" });
      await expect(panel).toBeVisible();
      // приложение не пустое и навигация жива
      await expect(page.locator("body")).not.toBeEmpty();
      await expect(nav(page, "Сегодня")).toBeVisible();
      // ошибка не проглочена
      expect(consoleErrors.join("\n")).toContain("Вкладка не открылась");
      // стиль панели: отступы, ничего не вылезает, цели касания ≥ 44 px
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      expect(await smallTargets(page)).toEqual([]);
      const box = await panel.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(8);
      // «Попробовать снова» при сохраняющемся сбое — панель возвращается
      await panel.getByRole("button", { name: "Попробовать снова", exact: true }).click();
      await expect(panel).toBeVisible();
      // сбой устранён — вкладка открывается
      await page.evaluate(() => delete (window as unknown as { __fault?: string }).__fault);
      await panel.getByRole("button", { name: "Попробовать снова", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Не удалось открыть вкладку" })).toHaveCount(0);
      await expect(nav(page, "Сегодня")).toBeVisible();
    });
  }
}
test("QA-R10-09: «Выйти из аккаунта» на панели ошибки работает без состояния приложения и возвращает на экран входа (390×844)", async ({ page }) => {
  test.setTimeout(60_000);
  await injectFault(page);
  await round01Fixture(page);
  await nav(page, "История").click();
  await page.evaluate(() => ((window as unknown as { __fault: string }).__fault = "Сегодня"));
  await nav(page, "Сегодня").click();
  const panel = page.getByRole("alert").filter({ hasText: "Не удалось открыть приложение" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
  await expect(page.getByRole("button", { name: "Войти в Тягу", exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
});
test("QA-R10-09: сбой внутри вкладки-компонента ловит граница вкладки, корневая панель не показывается", async ({ page }) => {
  test.setTimeout(60_000);
  await round01Fixture(page);
  const bad = { ...sixRoutines()[0], id: "bad-shape", periodization: undefined, days: [], exercises: "нет" } as unknown as Routine;
  await page.route("**/api/product", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ routines: [bad], favorites: [], customExercises: [] }) }),
  );
  await page.reload();
  await nav(page, "Программы").click();
  await expect(page.getByRole("alert").filter({ hasText: "Не удалось открыть вкладку" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Не удалось открыть приложение" })).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  const box = await page.getByRole("alert").filter({ hasText: "Не удалось открыть вкладку" }).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(8);
});

test("QA-R10-11: программа с битой периодизацией сохраняется как обычная — поле убрано, уведомление есть, 400 нет", async ({ page }) => {
  test.setTimeout(90_000);
  const good = sixRoutines()[0];
  const broken = { ...good, name: "Битый Лейд", periodization: { ...good.periodization, startMonday: "2026-11-10" } } as unknown as Routine;
  const { puts } = await laidApp(page, { routines: [broken] });
  await openPrograms(page);
  await page.getByRole("button", { name: "Редактировать программу Битый Лейд", exact: true }).click();
  await dialog(page).getByLabel("Название программы").fill("Битый Лейд (правка)");
  await dialog(page).getByRole("button", { name: "Сохранить программу", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(puts).toHaveLength(1);
  expect(puts[0].periodization).toBeUndefined();
  expect(puts[0].name).toBe("Битый Лейд (правка)");
  await expect(page.getByText("Периодизация программы повреждена и убрана — программа сохранена как обычная.")).toBeVisible();
});

test("QA-R10-14: копия программы Лейда — веса текущей недели по плану, уведомление про неделю; периодизации у копии нет", async ({ page }) => {
  test.setTimeout(90_000);
  // сегодня вторник 10 нояб.; старт 26 окт. → неделя 3: Ноги 1 — 3 повторения и четыре по 8
  const routines = sixRoutines(true, false, "2026-10-26");
  const { puts } = await laidApp(page, { routines });
  const legs1 = routines.find((r) => r.periodization!.day === "legs1")!;
  const plan = LaidDupPlan.planFor(legs1, "2026-11-10")!;
  const want = LaidDupPlan.liftSets(plan).map((s) => [s.weight, s.reps]);
  expect(want[0]).not.toEqual([85, 5]);
  await openPrograms(page);
  await page.getByRole("button", { name: "Копировать программу Лейд · Ноги 1", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Сохранить программу", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const copy = puts.at(-1)!;
  expect(copy.periodization).toBeUndefined();
  expect(copy.exercises[0].sets.map((s) => [s.weight, s.reps])).toEqual(want);
  await expect(page.getByText("Копия сохранена. Веса из недели 3, без периодизации.")).toBeVisible();
});

for (const size of [{ width: 360, height: 800 }, { width: 320, height: 640 }]) {
  test(`QA-R10-12: панель «Не удалось открыть приложение / вкладку» на ${size.width}×${size.height} — без сдвига и срезов, цели ≥ 44 px`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(size);
    await injectFault(page);
    await round01Fixture(page);
    await nav(page, "История").click();
    await page.evaluate(() => ((window as unknown as { __fault: string }).__fault = "Сегодня"));
    await nav(page, "Сегодня").click();
    await expect(page.getByRole("alert").filter({ hasText: "Не удалось открыть приложение" })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    expect(await smallTargets(page)).toEqual([]);
    expect((await clipped(page, "main")).wide).toEqual([]);
  });
}

test.describe("Motion UI & улучшенный план Лейда (без reducedMotion)", () => {
  test.use({ reducedMotion: "no-preference" });

  test("Motion domMax: выбор ритма 3+1+3 (отдых Чт), пружинные тумблеры, облегчённый режим на Тяге 2 и фильтр волн работают без ошибок", async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const history = [
      doneWorkout("База", "2026-11-02", [
        ["squat", 100, 5, 2],
        ["bench", 80, 5, 2],
        ["deadlift-bar", 140, 3, 1],
        ["ohp-bar", 55, 5, 2],
      ]),
    ];
    const { puts } = await laidApp(page, { workouts: history });
    await openPrograms(page);
    await page.getByRole("button", { name: /Дэвид Лейд · DUP/ }).click();
    const d = dialog(page);
    await fillMaxes(page);
    await d.getByRole("button", { name: /3 \+ 1 \+ 3 · выходной Чт/ }).click();
    await expect(d.getByRole("button", { name: /3 \+ 1 \+ 3 · выходной Чт/ })).toHaveAttribute("aria-pressed", "true");
    await d.getByRole("switch", { name: /^Облегчённо/ }).click();
    await expect(d.locator(".laid-preview")).toContainText("1 × 3 × 125 кг · 4 × 4 × 120 кг");
    await d.getByRole("button", { name: "Создать программу", exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(puts).toHaveLength(6);
    expect(puts.map((r) => r.days)).toEqual([[0], [1], [2], [4], [5], [6]]);
    expect(puts.every((r) => r.restSeconds === 180)).toBe(true);

    const lead = page.getByLabel("Программа Дэвида Лейда");
    await expect(lead.locator(".laid-card-maxes")).toContainText("140 кг");
    await lead.getByRole("button", { name: "Расписание (9 нед.)", exact: true }).click();
    const sched = dialog(page);
    await sched.getByRole("button", { name: "Волна 3", exact: true }).click();
    await expect(sched.locator(".laid-wave-banner")).toContainText("Пик силы");
    await expect(sched.locator(".laid-week-card")).toHaveCount(3);
    await sched.getByText("Состав дней: оригинал и добавленное").click();
    await expect(sched.locator(".laid-audit-card")).toContainText("Push 2 выстроен строго по листу оригинала");
    expect(errors).toEqual([]);
  });
});
