import { expect, test } from "@playwright/test";
import { mark, round01Fixture, startWith } from "./fixtures/round01";

const BENCH = "Жим штанги лёжа";
const SQUAT = "Приседания со штангой";
const VALIDATION_ERROR = "Проверьте текстовые поля";

test("Ответ 400 не удаляет незавершённые подходы из черновика после перезагрузки", async ({ page }) => {
  const fixture = await round01Fixture(page);
  await page.route("**/api/workouts", (route) => {
    const request = route.request();
    if (request.method() !== "PUT" || request.postDataJSON().name.trim()) return route.fallback();
    return route.fulfill({ status: 400, json: { error: VALIDATION_ERROR } });
  });
  await startWith(page, BENCH, SQUAT);
  await mark(page, 1, BENCH);
  const benchWeight = page.getByLabel(`${BENCH}, подход 2, вес`, { exact: true });
  const squatWeight = page.getByLabel(`${SQUAT}, подход 1, вес`, { exact: true });
  const squatReps = page.getByLabel(`${SQUAT}, подход 1, повторы`, { exact: true });
  await benchWeight.fill("65");
  for (const n of [2, 3]) {
    await page.getByLabel(`${BENCH}, подход ${n}, повторы`, { exact: true }).fill("");
  }
  await squatWeight.fill("72");
  await squatReps.fill("7");

  const title = page.getByRole("textbox", { name: "Название тренировки", exact: true });
  const finish = page.getByRole("button", { name: "Завершить тренировку", exact: true });
  await title.fill("");
  await finish.click();
  await expect(page.getByRole("alert").filter({ hasText: VALIDATION_ERROR })).toBeVisible();

  const expectDraftRows = async () => {
    await expect(benchWeight).toHaveValue("65");
    await expect(squatWeight).toHaveValue("72");
    await expect(squatReps).toHaveValue("7");
    await expect(page.getByRole("button", { name: `Снять отметку: ${BENCH}, подход 1`, exact: true })).toBeVisible();
  };
  await expectDraftRows();
  await page.reload();
  await page.getByRole("button", { name: "Продолжить тренировку", exact: true }).first().click();
  await expectDraftRows();

  await title.fill("Проверка сохранения");
  await finish.click();
  await expect(page.getByRole("heading", { name: "История тренировок", exact: true })).toBeVisible();
  expect(fixture.savedBodies).toHaveLength(1);
  expect(fixture.savedBodies[0].exercises).toMatchObject([
    { exerciseId: "bench", sets: [{ weight: 60, reps: 8, done: true }] },
  ]);
});
