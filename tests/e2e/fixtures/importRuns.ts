import type { Page } from "@playwright/test";

/**
 * Приложение при каждой загрузке спрашивает сервер о записанных и незавершённых импортах
 * (`GET /api/import/runs`). В строгих проверках «каждый запрос замокан» этот маршрут
 * должен быть явным: по умолчанию ни записанных, ни незавершённых импортов нет.
 */
export type ImportRunsMock = {
  runs: Array<{ runId: string; manifestHash: string; at: string; total: number; activeCount: number }>;
  pending: Array<{ runId: string; manifestHash: string; at: string; total: number }>;
  /** Сколько раз приложение спросило. */
  asked: number;
};

export async function mockImportRuns(page: Page, initial: Partial<Pick<ImportRunsMock, "runs" | "pending">> = {}) {
  const state: ImportRunsMock = { runs: [], pending: [], asked: 0, ...initial };
  await page.route("**/api/import/runs", (route) => {
    state.asked++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ runs: state.runs, pending: state.pending }),
    });
  });
  return state;
}
