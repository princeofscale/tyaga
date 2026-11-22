import { expect, test, type Page } from "@playwright/test";
import { PersonalExerciseFactory } from "../../server/PersonalExerciseFactory";
import { doneWorkout, NOW, round01Fixture, startWith } from "./fixtures/round01";

const BENCH = "Жим штанги лёжа";
const enterGym = (page: Page) => page.getByRole("button", { name: "Режим «В зале»", exact: true });
const fullList = (page: Page) => page.getByRole("button", { name: "Весь список", exact: true });
const chooseSet = (page: Page) => page.getByRole("combobox", { name: "Выбрать подход" });
const check = (page: Page, n: number, name = BENCH) =>
  page.getByRole("button", { name: `Отметить выполненным: ${name}, подход ${n}`, exact: true });

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
        const targets = [fullList(page), chooseSet(page), weight, check(page, 1)];
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
      const field = (n: number, name: string) => page.getByLabel(`${BENCH}, подход ${n}, ${name}`, { exact: true });
      await field(1, "вес").fill("60");
      await field(1, "повторы").fill("8");
      await check(page, 1).tap();
      const rest = page.getByRole("region", { name: "Таймер отдыха" });
      const paused = rest.getByRole("button", { name: "Продолжить таймер" });
      await rest.getByRole("button", { name: "Приостановить таймер" }).tap();
      await rest.getByRole("button", { name: "Плюс 15 секунд" }).tap();
      await expect(rest).toContainText("01:45");
      await chooseSet(page).selectOption({ label: "Рабочий 3 / 3" });
      await field(3, "вес").fill("65");
      await field(3, "RIR").fill("0");

      await page.reload();
      await page.getByRole("button", { name: "Продолжить тренировку", exact: true }).first().tap();
      await expect(fullList(page)).toBeVisible();
      await expect(paused).toBeVisible();
      await expect(rest).toContainText("01:45");
      await expect(field(3, "вес")).toHaveValue("65");
      await expect(field(3, "RIR")).toHaveValue("0");
      await expect(page.locator(".gym-set-editor input:focus")).toHaveCount(0);

      await fullList(page).tap();
      const details = page.getByText("Детали тренировки", { exact: true });
      await details.tap();
      const resumeClock = page.getByRole("button", { name: "Продолжить счётчик тренировки" });
      await resumeClock.tap();
      await page.getByRole("button", { name: "Приостановить счётчик тренировки" }).tap();
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
      await expect(chooseSet(page)).toHaveValue("");
      await expect(page.locator(".gym-set-editor input:focus")).toHaveCount(0);
      await rest.getByRole("button", { name: "Пропустить отдых" }).tap();
      await expect(rest).toBeHidden();
      expect(fixture.errors).toEqual([]);
      expect(fixture.unexpected).toEqual([]);
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

      const setIds = await Promise.all(["lat-pulldown", "pullup-assisted", "pullup", timed.id].map((id) =>
        page.locator('.set-row[data-exercise-id="'+id+'"]').first().getAttribute("data-set-id")));
      const field = (exercise: string, name: string) => page.getByLabel(`${exercise}, подход 1, ${name}`, { exact: true });
      const past = page.getByRole("region", { name: "Текущий подход" }).getByRole("button", { name: /^Подставить прошлый результат: / });
      await enterGym(page).tap();
      await expectNoEquipmentPicker(page);
      await chooseSet(page).selectOption(setIds[0]!);
      await expect(past).toHaveText("Прошлый: 35,5 × 9");
      await field(stack, "вес").fill("40");
      await past.tap();
      await expect(field(stack, "вес")).toHaveValue("35.5");
      await expect(field(stack, "повторы")).toHaveValue("9");

      await chooseSet(page).selectOption(setIds[1]!);
      await expect(past).toHaveText("Прошлый: 22,5 × 6");
      await expect(field(assisted, "вес")).toHaveCount(0);
      await expect(field(assisted, "помощь")).toHaveValue("22.5");
      await field(assisted, "помощь").fill("0");
      await check(page, 1, assisted).tap();

      await chooseSet(page).selectOption(setIds[2]!);
      await expect(past).toHaveText("Прошлый: × 12");
      await expect(field(body, "вес")).toHaveCount(0);
      await expect(field(body, "повторы")).toHaveValue("12");

      await chooseSet(page).selectOption(setIds[3]!);
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
