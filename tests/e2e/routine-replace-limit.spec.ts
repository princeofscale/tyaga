import { expect, test } from "@playwright/test";
import { makeExerciseEntry } from "../../src/lib/model";
import type { Routine } from "../../src/lib/types";
import { nav, round01Fixture } from "./fixtures/round01";

function makeRoutines(count: number): Routine[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `routine-${i + 1}`,
    name: `Программа ${i + 1}`,
    notes: "",
    days: [i % 7],
    exercises: [makeExerciseEntry("bench")],
    restSeconds: 120,
    progression: "repeat",
    repMin: 8,
    repMax: 12,
    incrementKg: 2.5,
    revision: i + 1,
  }));
}

test("Замена 49 программ на шаблон блокируется до запросов и не удаляет существующие программы", async ({ page }) => {
  const initial = makeRoutines(49);
  const store = [...initial];
  const ops: Array<{ method: string; path: string }> = [];

  await round01Fixture(page, { routines: initial });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    if (path === "/api/product" && method === "GET") {
      return route.fulfill({ status: 200, json: { routines: store, favorites: [], customExercises: [] } });
    }
    if (path === "/api/routines" && method === "PUT") {
      ops.push({ method, path });
      return route.fulfill({ status: 503, json: { error: "Временно недоступно" } });
    }
    if (path.startsWith("/api/routines/") && method === "DELETE") {
      ops.push({ method, path });
      const id = decodeURIComponent(path.slice("/api/routines/".length));
      const idx = store.findIndex((r) => r.id === id);
      if (idx !== -1) store.splice(idx, 1);
      return route.fulfill({ status: 200, json: { deleted: id } });
    }
    return route.fallback();
  });

  await nav(page, "Программы").click();
  await page.getByRole("button", { name: /Верх \/ низ/ }).click();
  await page.getByRole("button", { name: "Заменить текущие (49)", exact: true }).click();

  await expect(page.getByRole("alert")).toContainText(/50/);
  expect(ops).toEqual([]);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  expect(store.map((r) => [r.id, r.revision])).toEqual(initial.map((r) => [r.id, r.revision]));
});

test("Замена 48 программ на шаблон из 2 программ сохраняет новые перед удалением старых", async ({ page }) => {
  const initial = makeRoutines(48);
  const store = [...initial];
  const methods: string[] = [];

  await round01Fixture(page, { routines: initial });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    if (path === "/api/product" && method === "GET") {
      return route.fulfill({ status: 200, json: { routines: store, favorites: [], customExercises: [] } });
    }
    if (path === "/api/routines" && method === "PUT") {
      methods.push("PUT");
      const body = req.postDataJSON();
      const saved = { ...body, revision: (body.revision ?? 0) + 1 };
      store.unshift(saved);
      return route.fulfill({ status: 200, json: { routine: saved } });
    }
    if (path.startsWith("/api/routines/") && method === "DELETE") {
      methods.push("DELETE");
      const id = decodeURIComponent(path.slice("/api/routines/".length));
      const idx = store.findIndex((r) => r.id === id);
      if (idx !== -1) store.splice(idx, 1);
      return route.fulfill({ status: 200, json: { deleted: id } });
    }
    return route.fallback();
  });

  await nav(page, "Программы").click();
  await page.getByRole("button", { name: /Верх \/ низ/ }).click();
  await page.getByRole("button", { name: "Заменить текущие (48)", exact: true }).click();

  await expect(page.getByRole("status").filter({ hasText: /установлено тренировок — 2/ })).toBeVisible();
  expect(methods.slice(0, 2)).toEqual(["PUT", "PUT"]);
  expect(methods.slice(2).every((m) => m === "DELETE")).toBe(true);
  expect(store).toHaveLength(2);
});
