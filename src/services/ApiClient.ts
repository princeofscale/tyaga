import type { Settings, Workout } from "../lib/types";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: { current?: Workout | null; settings?: Settings },
  ) {
    super(message);
  }
}
export class ApiClient {
  constructor(
    private transport: typeof fetch = (input, init) => fetch(input, init),
  ) {}
  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000);
    let response: Response;
    try {
      response = await this.transport(path, {
        method,
        signal: requestSignal,
        headers: method === "GET" ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(
        "Запрос не завершился. Введённые данные остаются в форме; можно повторить запрос.",
      );
    }
    let data: T & {
      error?: string;
      current?: Workout | null;
      settings?: Settings;
    };
    try {
      data = await response.json();
    } catch {
      throw new Error("Сервис временно недоступен. Попробуй ещё раз.");
    }
    if (!response.ok)
      throw new ApiError(
        data.error ?? "Не удалось выполнить запрос",
        response.status,
        data,
      );
    return data;
  }
}
export const apiClient = new ApiClient();
export const api = <T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
) => apiClient.request<T>(path, method, body, signal);
