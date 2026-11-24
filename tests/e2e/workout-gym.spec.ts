import { expect, test, type Page } from "@playwright/test";
import { PersonalExerciseFactory } from "../../server/PersonalExerciseFactory";
import { doneWorkout, mark, NOW, round01Fixture, startWith } from "./fixtures/round01";

const BENCH = "Жим штанги лёжа";
const EXERCISES = [
  BENCH, "Тяга верхнего блока", "Отжимания от пола", "Подтягивания прямым хватом",
  "Жим гантелей сидя", "Приседания со штангой", "Румынская тяга со штангой",
] as const;
const LAST_EXERCISE = EXERCISES[6];
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const enterGym = (page: Page) => button(page, "Режим «В зале»");
const fullList = (page: Page) => button(page, "Весь список");
const exerciseChoice = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Упражнения тренировки", exact: true }).getByRole("button", { name, exact: true });
const exercisesToggle = (page: Page) => exerciseChoice(page, "Упражнения");
const workingSet = (page: Page, n: number, total: number, done = false) =>
  button(page, `Рабочий ${n} из ${total}${done ? ", выполнен" : ""}`);
const warmupSet = (page: Page, done = false) => button(page, `Разминка 1 из 1${done ? ", выполнен" : ""}`);
const setField = (page: Page, n: number, field: string, name = BENCH) =>
  page.getByLabel(`${name}, подход ${n}, ${field}`, { exact: true });
const check = (page: Page, n: number, name = BENCH) => button(page, `Отметить выполненным: ${name}, подход ${n}`);
const expectWorking = (page: Page, done: number, total: number) =>
  expect(page.locator(".hud-working")).toContainText(new RegExp(String.raw`\b${done}\s*/\s*${total}\b`));

async function tapExercise(page: Page, name: string) {
  if (await exercisesToggle(page).getAttribute("aria-expanded") === "false") await exercisesToggle(page).tap();
  await exerciseChoice(page, name).tap();
}

async function expectNoEquipmentPicker(page: Page) {
  await expect(page.getByText(/^(Тренажёр \/ блок|Блок \/ тренажёр|Сохранённый тренажёр)$/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /добавить или изменить тренажёр/i })).toHaveCount(0);
  await expect(page.locator(".workout-screen .machine-picker")).toHaveCount(0);
}

for (const width of [320, 390]) {
  test.describe(`Chromium touch ${width}px`, () => {
    test.use({ viewport: { width, height: width === 320 ? 640 : 844 }, isMobile: true, hasTouch: true });

    test("one compact editor shares data with the full list and reflows at 200% text", async ({ page, browserName }, testInfo) => {
      test.skip(browserName !== "chromium", "Touch layout is measured in Chromium");
      const fixture = await round01Fixture(page, { workouts: [doneWorkout("Прошлый жим", "2026-11-07", [["bench", 72.5, 8, 3]])] });
      await startWith(page, BENCH, "Тяга верхнего блока");
      await page.getByLabel("Название тренировки", { exact: true }).fill("Силовая");
      await expect(page.locator(".sets-table")).toHaveCount(2);
      await expectNoEquipmentPicker(page);
      await enterGym(page).tap();
      await expect(fullList(page)).toBeVisible();
      await expect(page.locator(".sets-table")).toHaveCount(0);
      await expect(page.locator(".gym-set-editor")).toHaveCount(1);
      await expectNoEquipmentPicker(page);
      const weight = page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true });
      await expect(page.getByRole("button", { name: /^Подставить прошлый результат: / })).toHaveText("Прошлый: 72,5 × 8");
      await weight.fill("75");
      await fullList(page).tap();
      await expect(page.locator(".sets-table")).toHaveCount(2);
      await expect(weight).toHaveValue("75");
      await expect(page.getByLabel(`${BENCH}, подход 1, RIR`, { exact: true })).toBeVisible();
      const rowMetrics = await page.locator(".sets-table").first().locator(".set-row").evaluateAll((rows) =>
        rows.map((row) => row.getBoundingClientRect()));
      expect(rowMetrics[1].top - rowMetrics[0].top).toBeLessThanOrEqual(85);
      await enterGym(page).tap();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      for (const scale of [100, 200]) {
        await page.evaluate((scale) => { document.documentElement.style.fontSize = `${scale}%`; }, scale);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
        const metric = (await page.locator(".hud-working").boundingBox())!;
        const listButton = (await fullList(page).boundingBox())!;
        expect(listButton.y).toBeGreaterThanOrEqual(metric.y + metric.height - 1);
        const targets = [fullList(page), exercisesToggle(page), workingSet(page, 1, 3), weight, check(page, 1)];
        for (const target of targets) {
          const bounds = await target.boundingBox();
          expect(bounds?.width).toBeGreaterThanOrEqual(44);
          expect(bounds?.height).toBeGreaterThanOrEqual(44);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
        }
        await page.screenshot({ path: testInfo.outputPath(`workout-gym-${width}-${scale}.png`), fullPage: true });
      }
      await expect(page.getByRole("button", { name: "Завершить тренировку" })).toBeDisabled();
      await check(page, 1).scrollIntoViewIfNeeded();
      const scrollTop = await page.evaluate(() => scrollY);
      await check(page, 1).tap();
      await expect(check(page, 2)).toBeVisible();
      expect(await page.evaluate(() => scrollY)).toBe(scrollTop);
      await expect(page.locator(".gym-set-editor input:focus")).toHaveCount(0);
      const rest = page.getByRole("region", { name: "Таймер отдыха" });
      await rest.getByRole("button", { name: "Приостановить таймер" }).tap();
      await fullList(page).tap();
      await expect(rest.getByRole("button", { name: "Продолжить таймер" })).toBeVisible();
      expect(fixture.errors).toEqual([]);
      expect(fixture.unexpected).toEqual([]);
    });

    test("restores an explicitly selected set and paused rest in the same tab", async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "Touch layout is measured in Chromium");
      const fixture = await round01Fixture(page);
      await startWith(page, BENCH);
      await enterGym(page).tap();
      const field = (n: number, name: string) => setField(page, n, name);
      await field(1, "вес").fill("60");
      await field(1, "повторы").fill("8");
      await check(page, 1).tap();
      const rest = page.getByRole("region", { name: "Таймер отдыха" });
      const paused = rest.getByRole("button", { name: "Продолжить таймер" });
      await rest.getByRole("button", { name: "Приостановить таймер" }).tap();
      await rest.getByRole("button", { name: "Плюс 15 секунд" }).tap();
      await expect(rest).toContainText("01:45");
      await workingSet(page, 3, 3).tap();
      await field(3, "вес").fill("65");
      await field(3, "повторы").fill("8");
      await field(3, "RIR").fill("0");

      await page.reload();
      await page.getByRole("button", { name: "Продолжить тренировку", exact: true }).first().tap();
      await expect(fullList(page)).toBeVisible();
      await expect(paused).toBeVisible();
      await expect(rest).toContainText("01:45");
      await expect(workingSet(page, 3, 3)).toHaveAttribute("aria-pressed", "true");
      await expect(field(3, "вес")).toHaveValue("65");
      await expect(field(3, "RIR")).toHaveValue("0");
      await expect(page.locator(".gym-set-editor input:focus")).toHaveCount(0);

      await fullList(page).tap();
      const resumeClock = button(page, "Возобновить таймер тренировки");
      await resumeClock.tap();
      await button(page, "Пауза таймера тренировки").tap();
      await expect(resumeClock).toBeVisible();
      await enterGym(page).tap();
      await expect(check(page, 3)).toBeVisible();
      await rest.getByRole("button", { name: "Минус 15 секунд" }).tap();
      await expect(rest).toContainText("01:30");
      await paused.tap();
      await expect(rest.getByRole("button", { name: "Приостановить таймер" })).toBeVisible();
      await page.clock.setFixedTime(new Date(NOW.getTime() + 91_000));
      await expect(rest).toBeHidden();
      await expect(page.getByText("Отдых завершён", { exact: true })).toHaveCount(1);
      await check(page, 3).tap();
      await expect(check(page, 2)).toBeVisible();
      await expect(workingSet(page, 2, 3)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".gym-set-editor input:focus")).toHaveCount(0);
      await rest.getByRole("button", { name: "Пропустить отдых" }).tap();
      await expect(rest).toBeHidden();
      expect(fixture.errors).toEqual([]);
      expect(fixture.unexpected).toEqual([]);
    });

    test("the collapsed exercise list opens directly to the seventh exercise", async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "Touch layout is measured in Chromium");
      await round01Fixture(page);
      await startWith(page, ...EXERCISES);
      await enterGym(page).tap();
      const toggle = exercisesToggle(page);
      const last = exerciseChoice(page, LAST_EXERCISE);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(last).toBeHidden();
      await toggle.tap();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(last).toBeVisible();
      await last.tap();
      await expect(check(page, 1, LAST_EXERCISE)).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.tap();
      await expect(last).toHaveAttribute("aria-pressed", "true");
      await expect(exerciseChoice(page, BENCH)).toHaveAttribute("aria-pressed", "false");
    });

    test("compares past loads by exercise context and keeps distinct measurement fields", async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "Touch layout is measured in Chromium");
      const stack = "Тяга верхнего блока";
      const assisted = "Подтягивания с помощью тренажёра";
      const body = "Подтягивания прямым хватом";
      const timed = await new PersonalExerciseFactory().create({
        familyId: "gym-timed-fixture", name: "Планка на время", equipment: "bodyweight",
        aliases: [], notes: "", recording: { type: "duration", loadMode: "bodyweight", implementCount: 1, laterality: "bilateral" },
      });
      const comparable = doneWorkout("Прошлые подходы", "2026-11-07", [
        ["lat-pulldown", 35.5, 9, 3], ["pullup-assisted", 0, 6, 3], ["pullup", 0, 12, 3],
      ]);
      comparable.exercises[1].sets.forEach((set) => { set.assistanceKg = 22.5; });
      comparable.exercises.push({
        exerciseId: timed.id, catalogRevision: timed.catalogRevision, externalDefinition: timed,
        sets: [{ id: "past-timed-set", weight: 0, reps: 1, durationSeconds: 45, rir: null, warmup: false, done: true }],
      });
      const legacy = doneWorkout("Другой блок", "2026-11-08", [["lat-pulldown", 80, 10, 3]]);
      legacy.exercises[0].equipmentNote = "Чужой блок";
      const fixture = await round01Fixture(page, { workouts: [legacy, comparable], customExercises: [timed] });
      await startWith(page, stack, assisted, body);
      await page.getByRole("button", { name: "Добавить упражнение", exact: true }).tap();
      await page.getByRole("button", { name: /^Мои / }).tap();
      await page.getByRole("button", { name: `Добавить ${timed.name}`, exact: true }).tap();
      await page.getByRole("button", { name: "Готово", exact: true }).tap();
      await expectNoEquipmentPicker(page);
      await expect(page.getByText("Чужой блок", { exact: true })).toHaveCount(0);

      const field = (exercise: string, name: string) => setField(page, 1, name, exercise);
      const past = page.getByRole("region", { name: "Текущий подход" }).getByRole("button", { name: /^Подставить прошлый результат: / });
      await enterGym(page).tap();
      await expectNoEquipmentPicker(page);
      await tapExercise(page, stack);
      await expect(past).toHaveText("Прошлый: 35,5 × 9");
      await field(stack, "вес").fill("40");
      await past.tap();
      await expect(field(stack, "вес")).toHaveValue("35.5");
      await expect(field(stack, "повторы")).toHaveValue("9");

      await tapExercise(page, assisted);
      await expect(past).toHaveText("Прошлый: 22,5 × 6");
      await expect(field(assisted, "вес")).toHaveCount(0);
      await expect(field(assisted, "помощь")).toHaveValue("22.5");
      await field(assisted, "помощь").fill("0");
      await check(page, 1, assisted).tap();

      await tapExercise(page, body);
      await expect(past).toHaveText("Прошлый: × 12");
      await expect(field(body, "вес")).toHaveCount(0);
      await expect(field(body, "повторы")).toHaveValue("12");

      await tapExercise(page, timed.name);
      await expect(past).toHaveText("Прошлый: 45 с");
      await expect(field(timed.name, "повторы")).toHaveCount(0);
      await expect(field(timed.name, "RIR")).toHaveCount(0);
      await expect(field(timed.name, "секунды")).toHaveValue("45");
      await field(timed.name, "секунды").fill("50");
      await field(timed.name, "дистанция, км").fill("0.15");
      await fullList(page).tap();
      await expect(field(timed.name, "секунды")).toHaveValue("50");
      await expect(field(timed.name, "дистанция, км")).toHaveValue("0.15");
      await expect(field(assisted, "помощь")).toHaveValue("0");
      await expect(page.getByRole("button", { name: `Снять отметку: ${assisted}, подход 1` })).toBeVisible();
      await expect(field(body, "повторы")).toHaveValue("12");
      expect(fixture.errors).toEqual([]);
      expect(fixture.unexpected).toEqual([]);
    });
  });
}

test("jumps to the seventh exercise and selects a set with the keyboard on desktop", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, ...EXERCISES);
  await enterGym(page).click();
  await expect(page.locator(".workout-bar")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(exercisesToggle(page)).toBeHidden();
  await expect(exerciseChoice(page, BENCH)).toHaveAttribute("aria-pressed", "true");
  const last = exerciseChoice(page, LAST_EXERCISE);
  await exerciseChoice(page, EXERCISES[5]).focus();
  await page.keyboard.press("Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await expect(check(page, 1, LAST_EXERCISE)).toBeVisible();

  await workingSet(page, 2, 3).focus();
  await page.keyboard.press("Tab");
  await expect(workingSet(page, 3, 3)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(workingSet(page, 3, 3)).toHaveAttribute("aria-pressed", "true");
  await expect(check(page, 3, LAST_EXERCISE)).toBeVisible();
  await expect(page.locator(".gym-set-editor input:focus")).toHaveCount(0);
});

test("a manual jump distinguishes skipped sets from next sets and keeps the working count in sync", async ({ page }) => {
  await round01Fixture(page, { workouts: [doneWorkout("Прошлый жим", "2026-11-07", [["bench", 60, 8, 3]])] });
  await startWith(page, BENCH);
  await enterGym(page).click();
  const footer = page.locator(".gym-next-set");
  await expectWorking(page, 0, 3);
  await workingSet(page, 3, 3).click();
  await expect(workingSet(page, 3, 3)).toHaveAttribute("aria-pressed", "true");
  await expect(footer).toContainText("Пропущенный подход");
  await expect(footer).toContainText("Рабочий 1 из 3");
  await expect(footer).not.toContainText("Дальше");

  await check(page, 3).dblclick();
  await expect(workingSet(page, 3, 3, true)).toBeVisible();
  await expect(workingSet(page, 1, 3)).toHaveAttribute("aria-pressed", "true");
  await expectWorking(page, 1, 3);
  await expect(footer).toContainText("Дальше");
  await expect(footer).toContainText("Рабочий 2 из 3");
  await check(page, 1).click();
  await expect(workingSet(page, 2, 3)).toHaveAttribute("aria-pressed", "true");
  await check(page, 2).click();
  await expectWorking(page, 3, 3);
  await expect(footer).toContainText("Все подходы отмечены");

  await button(page, "Добавить рабочий подход").click();
  await expectWorking(page, 3, 4);
  await workingSet(page, 4, 4).click();
  await mark(page, 4);
  await expectWorking(page, 4, 4);
  await expect(workingSet(page, 4, 4, true)).toBeVisible();
  await expect(footer).toContainText("Все подходы отмечены");
});

test("deletes the selected working set or warmup and restores each in its original position", async ({ page }) => {
  const previous = doneWorkout("Прошлый жим", "2026-11-07", [["bench", 60, 8, 3]]);
  previous.exercises[0].sets[1].weight = 65;
  previous.exercises[0].sets[2].weight = 70;
  await round01Fixture(page, { workouts: [previous] });
  await startWith(page, BENCH);
  await enterGym(page).click();
  const remove = button(page, "Удалить выбранный подход");
  const undo = button(page, "Отменить удаление");
  await button(page, "Добавить разминочный подход").click();
  await warmupSet(page).click();
  await expect(warmupSet(page)).toHaveAttribute("aria-pressed", "true");
  await setField(page, 1, "вес").fill("25");
  await setField(page, 1, "повторы").fill("10");
  await check(page, 1).click();
  await expect(warmupSet(page, true)).toBeVisible();
  await expectWorking(page, 0, 3);

  await workingSet(page, 2, 3).click();
  await expect(setField(page, 3, "вес")).toHaveValue("65");
  await remove.click();
  await expectWorking(page, 0, 2);
  await workingSet(page, 2, 2).click();
  await expect(setField(page, 3, "вес")).toHaveValue("70");
  await undo.click();
  await expectWorking(page, 0, 3);
  await workingSet(page, 2, 3).click();
  await expect(setField(page, 3, "вес")).toHaveValue("65");
  await workingSet(page, 3, 3).click();
  await expect(setField(page, 4, "вес")).toHaveValue("70");

  await warmupSet(page, true).click();
  await remove.click();
  await expect(warmupSet(page)).toHaveCount(0);
  await expect(warmupSet(page, true)).toHaveCount(0);
  await expectWorking(page, 0, 3);
  await undo.click();
  await warmupSet(page, true).click();
  await expect(setField(page, 1, "вес")).toHaveValue("25");
  await expect(setField(page, 1, "повторы")).toHaveValue("10");
  await expect(button(page, `Снять отметку: ${BENCH}, подход 1`)).toBeVisible();
});
