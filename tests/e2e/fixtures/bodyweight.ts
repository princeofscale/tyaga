import type { Page } from "@playwright/test";
import type { WeightDocument } from "../../../src/domain/BodyweightDocument";
export function weightFixture() {
  return { documents: new Map<string, WeightDocument>(), offline: false };
}
export async function mockWeights(
  page: Page,
  accountId: string,
  state = weightFixture(),
) {
  await page.route("**/api/bodyweight**", (route) => {
    if (state.offline) return route.abort("failed");
    const request = route.request();
    const json = (value: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(value),
      });
    if (request.method() === "GET")
      return json({ documents: [...state.documents.values()], accountId });
    const key = decodeURIComponent(
      new URL(request.url()).pathname.split("/").at(-1)!,
    );
    const input = request.postDataJSON();
    const current = state.documents.get(key);
    if (input.accountId !== accountId)
      return json({ error: "Аккаунт изменился" }, 401);
    if (current?.mutationId === input.mutationId)
      return json({ document: current });
    if ((current?.revision ?? 0) !== input.revision)
      return json(
        {
          error: "Замер изменён на другом устройстве",
          document: current ?? null,
        },
        409,
      );
    const document: WeightDocument = {
      key,
      value: input.value,
      revision: input.revision + 1,
      mutationId: input.mutationId,
      updatedAt: new Date().toISOString(),
    };
    state.documents.set(key, document);
    return json({ document });
  });
  return state;
}
