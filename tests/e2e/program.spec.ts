import { test, expect } from "@playwright/test";
const BASE = "http://localhost:5173";
const WORKER = "http://127.0.0.1:8787";
const headers = { Origin: BASE };

test("программа v2 добавляется из шаблона и показывается с подходами и разгрузкой", async ({ page, context, playwright }) => {
  const request = await playwright.request.newContext({ baseURL: BASE });
  const session = await (await request.get("/api/auth/session")).json();
  const response = await request.post(`/api/auth/${session.registered ? "login" : "register"}`, {
    headers,
    data: { email: "gym-e2e@example.test", password: "test account passphrase", displayName: "[E2E] Атлет", timeZone: "UTC" },
  });
  expect(response.ok()).toBeTruthy();
  const cookie = response.headers()["set-cookie"].split(";")[0];
  const [name, value] = cookie.split("=");
  await context.addCookies([{ name, value, url: BASE }]);
  const api = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { Cookie: cookie } });

  // Чистим прошлый прогон, чтобы шаблон добавлялся с нуля.
  const product = await (await api.get("/api/product")).json();
  for (const routine of product.routines ?? [])
    if (routine.cycle)
      await api.delete("/api/routines/" + routine.id, { headers, data: { revision: routine.revision } });

  await page.goto("/");
  await page.getByRole("link", { name: "Программы" }).or(page.getByRole("button", { name: "Программы" })).first().click();
  await expect(page.getByText("Программа v2 · 5 дней")).toBeVisible();
  await page.getByText("Программа v2 · 5 дней").click();

  for (const name of ["Верх: грудь, спина, трапеция", "Плечи и руки", "Верх: спина, грудь, трапеция", "Руки, плечи, предплечья", "Ноги и икры"])
    await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 20000 });

  // Диапазоны повторений из плана видны в карточке программы.
  await expect(page.getByText("3 × 6–8").first()).toBeVisible();
  await expect(page.getByText("6 × 12–20").first()).toBeVisible();

  // Программа сохранилась на сервере вместе с циклом разгрузки.
  const saved = await (await api.get("/api/product")).json();
  expect(saved.routines.length).toBe(5);
  for (const routine of saved.routines) {
    expect(routine.cycle).toEqual({ weeks: 5, deloadWeek: 4, setFactor: 0.5, weightFactor: 0.7, deloadRir: 4 });
    expect(routine.exercises.every((e: any) => Number.isInteger(e.repMin) && Number.isInteger(e.repMax))).toBeTruthy();
  }
  const upper = saved.routines.find((r: any) => r.name === "Верх: грудь, спина, трапеция");
  expect(upper.exercises[0]).toMatchObject({ exerciseId: "incline-bar", repMin: 6, repMax: 8 });
  expect(upper.exercises.reduce((n: number, e: any) => n + e.sets.filter((s: any) => !s.warmup).length, 0)).toBe(22);
  expect(upper.days).toEqual([0]);

  for (const routine of saved.routines)
    if (routine.cycle)
      await api.delete("/api/routines/" + routine.id, { headers, data: { revision: routine.revision } });
  await api.dispose();
  await request.dispose();
});