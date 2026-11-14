import { newDraft } from "../../src/lib/draft";
import type { MachineInstance } from "../../src/lib/types";
import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import {
  DEFAULT_SETTINGS,
  addCalendarDays,
  localDate,
  makeWorkout,
} from "../../src/lib/model";
import { mockWeights } from "./fixtures/bodyweight";
import type { Workout } from "../../src/lib/types";

const today = localDate(new Date(), "UTC");

function fixture(id: string, date = today, count = 4) {
  const w = makeWorkout([id], [], "UTC");
  w.date = date;
  w.exercises[0].sets = Array.from({ length: count }, (_, i) => ({
    id: `s-${i}`,
    weight: 60,
    reps: 10,
    rir: 2,
    warmup: false,
    done: true,
  }));
  return w;
}

async function preview(page: Page, workouts: Workout[]) {
  const errors: string[] = [];
  let machines: MachineInstance[] = [];
  let history = workouts;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/machines" && route.request().method() === "PUT") {
      const machine = { ...route.request().postDataJSON(), revision: 1 };
      machines = [machine, ...machines.filter((m) => m.id !== machine.id)];
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ machine }),
      });
    }
    if (path === "/api/workouts" && route.request().method() === "PUT") {
      const workout = { ...route.request().postDataJSON(), revision: 1 };
      history = [workout, ...history.filter((w) => w.id !== workout.id)];
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ workout }),
      });
    }
    const data =
      path === "/api/auth/session"
        ? {
            registered: true,
            profile: {
              id: "biomechanics",
              email: "biomechanics@example.test",
              displayName: "Атлет",
              timeZone: "UTC",
              revision: 1,
              createdAt: new Date().toISOString(),
            },
          }
        : path === "/api/data"
          ? {
              workouts: history,
              settings: { ...DEFAULT_SETTINGS, timeZone: "UTC", revision: 1 },
            }
          : path === "/api/product"
            ? { routines: [], customExercises: [], favorites: [], machines }
            : { error: `Unexpected fixture request: ${path}` };
    return route.fulfill({
      status: "error" in data ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await mockWeights(page, "biomechanics");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Сегодня", exact: true }),
  ).toBeVisible();
  return () => expect(errors).toEqual([]);
}

async function tool(page: Page, name: string) {
  await page
    .getByRole("button", { name: /^Инструменты/ })
    .last()
    .click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
}

test("volume tool uses a full rolling week and assistance despite the atlas week/RIR filter", async ({
  page,
}) => {
  const pull = fixture("lat-pulldown");
  pull.exercises[0].sets.forEach((s, i) => (s.rir = [0, 3, 4, null][i]));
  const clean = await preview(page, [
    pull,
    fixture("bench", addCalendarDays(today, -7), 30),
    fixture("bench", addCalendarDays(today, 1), 30),
  ]);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("button", { name: "Прогресс", exact: true })
    .click();
  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  await page
    .getByRole("button", { name: "Предыдущая неделя", exact: true })
    .click();
  await page.getByLabel("Только RIR ≤ 3").check();
  await tool(page, "Объём по мышцам");
  const dialog = page.getByRole("dialog", {
    name: "Ориентиры недельного объёма",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/последние 7 дней/)).toBeVisible();
  const biceps = dialog
    .locator(".rp-muscle-item")
    .filter({ hasText: "Сгибатели локтя" });
  await expect(biceps.locator(".rp-sets-counter b")).toHaveText("2");
  await expect(biceps).toContainText("из них при RIR ≤ 3: 1 экв. подх.");
  await expect(dialog).toContainText("Без RIR: 1 из 4 рабочих подходов");
  const chest = dialog.locator(".rp-muscle-item").filter({ hasText: "Грудь" });
  await expect(chest.locator(".rp-sets-counter b")).toHaveText("0");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
  await page.screenshot({
    path: "artifacts/biomechanics-volume.png",
    fullPage: true,
  });
  clean();
});

test("library, atlas and regional counters agree on rear deltoid fly", async ({
  page,
}) => {
  const clean = await preview(page, [fixture("rear-delt-fly", today, 3)]);
  const nav = page.getByRole("navigation", { name: "Основная навигация" });
  await nav.getByRole("button", { name: "Упражнения", exact: true }).click();
  await page
    .getByLabel("Поиск упражнений", { exact: true })
    .fill("Обратные разведения");
  // A label comes from the explicit deltoid role, never the word 'fly'.
  await expect(
    page.locator(".library-head-tag").filter({ hasText: "Задняя дельта" }),
  ).toBeVisible();
  await expect(
    page.locator(".library-head-tag").filter({ hasText: "Середина груди" }),
  ).toHaveCount(0);
  await nav.getByRole("button", { name: "Прогресс", exact: true }).click();
  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  await page.getByRole("tab", { name: "Карта мышц", exact: true }).click();
  await page.getByRole("button", { name: "Плечи", exact: true }).click();
  const head = page.locator(".head-card").filter({ hasText: "Задняя дельта" });
  await expect(head).toContainText("3 прямых");
  await expect(page.locator(".anatomy-recommendations")).toContainText(
    "Обратные разведения на заднюю дельту",
  );
  clean();
});

test("deload never treats a planned or future workout as completed work", async ({
  page,
}) => {
  const planned = fixture("bench", today, 20);
  planned.exercises[0].sets.forEach((s) => {
    s.done = false;
    s.rir = 0;
  });
  const clean = await preview(page, [
    planned,
    fixture("bench", addCalendarDays(today, 1), 20),
  ]);
  await tool(page, "Разгрузочная неделя");
  const dialog = page.getByRole("dialog", {
    name: "Настройка разгрузочной недели",
    exact: true,
  });
  await expect(dialog).toContainText("Нет записанной работы за 30 дней");
  await expect(dialog.locator(".fatigue-score-val")).toHaveText("0");
  await expect(dialog).toContainText(
    "не измерение усталости или восстановления",
  );
  clean();
});

test("real MediaPipe runtime analyzes local video without uploading its frames", async ({
  page,
}) => {
  test.setTimeout(120000);
  test.skip(
    !existsSync("artifacts/models/pose_landmarker_lite_v1.task"),
    "Run npm run test:e2e:prepare to fetch the pinned official test model",
  );
  const clean = await preview(page, []);
  let modelDownloads = 0;
  await page.route(
    "https://storage.googleapis.com/mediapipe-models/**",
    async (route) => {
      modelDownloads++;
      await route.fulfill({
        path: "artifacts/models/pose_landmarker_lite_v1.task",
        contentType: "application/octet-stream",
      });
    },
  );
  const externalPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && !request.url().includes("/api/"))
      externalPosts.push(request.url());
  });
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<Blob>(
      (resolve) =>
        (recorder.onstop = () =>
          resolve(new Blob(chunks, { type: "video/webm" }))),
    );
    recorder.start();
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 ? "#303030" : "#383838";
      ctx.fillRect(0, 0, 320, 240);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    const blob = await done;
    stream.getTracks().forEach((t) => t.stop());
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await tool(page, "Анализ техники по видео");
  await page
    .getByLabel("Видео подхода", { exact: true })
    .setInputFiles({
      name: "blank.webm",
      mimeType: "video/webm",
      buffer: Buffer.from(bytes),
    });
  const start = page.getByRole("button", {
    name: "Проанализировать видео",
    exact: true,
  });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(
    page.getByRole("heading", { name: "Оценочная амплитуда", exact: true }),
  ).toBeVisible({ timeout: 100000 });
  await expect(
    page.getByText("Не удалось уверенно распознать суставы.", { exact: false }),
  ).toBeVisible();
  expect(modelDownloads).toBe(1);
  expect(externalPosts).toEqual([]);
  await expect(page.locator(".pose-joints")).toContainText(
    "Мало достоверных кадров",
  );
  clean();
});

test("machine picker and per-set execution survive draft reload and save with separate machine volume", async ({
  page,
}) => {
  const workout = makeWorkout(["row", "db-row"], [], "UTC");
  workout.exercises[0].sets.forEach((s) => (s.weight = 50));
  workout.exercises[1].sets.forEach((s) => (s.weight = 20));
  const draft = newDraft(workout);
  await page.addInitScript((value) => {
    if (!localStorage.getItem("biomechanics-seeded")) {
      localStorage.setItem(
        "tyaga-draft-account:biomechanics",
        JSON.stringify(value),
      );
      localStorage.setItem("biomechanics-seeded", "1");
    }
  }, draft);
  const clean = await preview(page, []);
  await tool(page, "Мои тренажёры");
  await page
    .getByLabel("Название станции", { exact: true })
    .fill("Блок у окна");
  await page.getByLabel("Модель тренажёра", { exact: true }).fill("Row 100");
  await page
    .getByLabel("Другие названия тренажёра", { exact: true })
    .fill("Старый блок, Блок A");
  await page
    .getByRole("button", { name: "Сохранить тренажёр", exact: true })
    .click();
  await expect(page.locator(".machine-list")).toContainText("Блок у окна");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Продолжить тренировку", exact: true })
    .click();
  await page.getByLabel("Сохранённый тренажёр", { exact: true }).click();
  await page
    .getByRole("option", { name: "Блок у окна · Row 100", exact: true })
    .click();
  const single = page
    .locator(".exercise-card")
    .filter({
      has: page.getByRole("heading", {
        name: "Тяга гантели одной рукой с опорой",
        exact: true,
      }),
    });
  const row = single.locator(".set-row-wrapper").first();
  await row.getByText("Контекст подхода 1", { exact: true }).click();
  await row
    .getByLabel("Тяга гантели одной рукой с опорой, подход 1, стороны", {
      exact: true,
    })
    .click();
  await page.getByRole("option", { name: "Только левая", exact: true }).click();
  await row
    .getByText("Подход 1: амплитуда, хват и углы", { exact: true })
    .click();
  await row.getByLabel("Подход 1: амплитуда", { exact: true }).click();
  await page
    .getByRole("option", {
      name: "Частичная в растянутой позиции",
      exact: true,
    })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Продолжить тренировку", exact: true })
    .click();
  const persisted = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("tyaga-draft-account:biomechanics")!)
        .workout,
  );
  expect(persisted.exercises[0].machineInstanceId).toBeTruthy();
  expect(persisted.exercises[1].sets[0].performedSides).toBe("left");
  expect(persisted.exercises[1].sets[0].execution.rom).toBe(
    "lengthened_partial",
  );
  await page
    .getByRole("button", {
      name: "Отметить выполненным: Тяга горизонтального блока, подход 1",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Отметить выполненным: Тяга гантели одной рукой с опорой, подход 1",
      exact: true,
    })
    .click();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".session-machine-volume")).toContainText(
    "Блок у окна: 500",
  );
  clean();
});

test("bulk previous-work autofill keeps warmups outside the working-set order", async ({ page }) => {
  const previous = fixture("bench", addCalendarDays(today, -1), 2);
  previous.exercises[0].sets[1].weight = 70;
  previous.exercises[0].sets[1].reps = 8;
  const workout = makeWorkout(["bench"], [], "UTC");
  const base = workout.exercises[0].sets[0];
  workout.exercises[0].sets = [
    { ...base, id: "warm", weight: 20, reps: 5, warmup: true },
    { ...base, id: "work-1", weight: 50, reps: 6, warmup: false },
    { ...base, id: "work-2", weight: 50, reps: 6, warmup: false },
  ];
  await page.addInitScript((value) => {
    localStorage.setItem("tyaga-draft-account:biomechanics", JSON.stringify(value));
  }, newDraft(workout));
  const clean = await preview(page, [previous]);
  await page.getByRole("button", { name: "Продолжить тренировку", exact: true }).click();
  const first = page.locator(".exercise-card").first();
  const weights = first.locator("input[aria-label$=', вес']");
  const reps = first.locator("input[aria-label$=', повторы']");
  await first.locator(".autofill-pill-btn.repeat").click();
  await expect(weights.nth(0)).toHaveValue("20");
  await expect(weights.nth(1)).toHaveValue("60");
  await expect(weights.nth(2)).toHaveValue("70");
  await expect(reps.nth(0)).toHaveValue("5");
  await expect(reps.nth(1)).toHaveValue("10");
  await expect(reps.nth(2)).toHaveValue("8");
  await first.locator(".autofill-pill-btn.progress").click();
  await expect(weights.nth(0)).toHaveValue("20");
  await expect(weights.nth(1)).toHaveValue("62.5");
  await expect(weights.nth(2)).toHaveValue("72.5");
  clean();
});

test("real MediaPipe detects visible joints in an official pose fixture", async ({
  page,
}) => {
  test.setTimeout(120000);
  test.skip(
    !existsSync("artifacts/models/pose.jpg") ||
      !existsSync("artifacts/models/pose_landmarker_lite_v1.task"),
    "Run npm run test:e2e:prepare",
  );
  const clean = await preview(page, []);
  await page.route(
    "https://storage.googleapis.com/mediapipe-models/**",
    (route) =>
      route.fulfill({
        path: "artifacts/models/pose_landmarker_lite_v1.task",
        contentType: "application/octet-stream",
      }),
  );
  await page.route("**/test-pose.jpg", (route) =>
    route.fulfill({
      path: "artifacts/models/pose.jpg",
      contentType: "image/jpeg",
    }),
  );
  const bytes = await page.evaluate(async () => {
    const image = new Image();
    image.src = "/test-pose.jpg";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise<Blob>(
      (resolve) =>
        (recorder.onstop = () =>
          resolve(new Blob(chunks, { type: "video/webm" }))),
    );
    recorder.start();
    for (let i = 0; i < 16; i++) {
      ctx.drawImage(image, 0, 0, 640, 480);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    const blob = await stopped;
    stream.getTracks().forEach((track) => track.stop());
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await tool(page, "Анализ техники по видео");
  await page
    .getByLabel("Видео подхода", { exact: true })
    .setInputFiles({
      name: "pose.webm",
      mimeType: "video/webm",
      buffer: Buffer.from(bytes),
    });
  await page
    .getByRole("button", { name: "Проанализировать видео", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Оценочная амплитуда", exact: true }),
  ).toBeVisible({ timeout: 100000 });
  const jointRows = page.locator(".pose-joints > div");
  await expect(
    jointRows.filter({ hasText: "амплитуда" }).first(),
  ).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
  await page.screenshot({
    path: "artifacts/pose-analysis.png",
    fullPage: true,
  });
  clean();
});
