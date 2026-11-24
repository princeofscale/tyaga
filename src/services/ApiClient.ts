import type { Settings, Workout, Routine } from "../lib/types";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: {
      current?: Workout | null;
      settings?: Settings;
      currentRoutine?: Routine | null;
    },
  ) {
    super(message);
  }
}
export class ApiClient {
  constructor(
    private transport: typeof fetch = (input, init) => fetch(input, init),
    private expireLocalSession = true,
  ) {}
  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000);
    let response: Response;
    try {
      const headers: Record<string, string> = {
        ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
        ...(extraHeaders ?? {}),
      };
      response = await this.transport(path, {
        method,
        signal: requestSignal,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(
        "Запрос не завершился. Введённые данные остаются в форме; можно повторить запрос.",
        { cause: error },
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
    if (response.status === 401 && this.expireLocalSession && !path.startsWith("/api/auth/") && typeof window !== "undefined")
      window.dispatchEvent(new Event("tyaga:auth-expired"));
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
  extraHeaders?: Record<string, string>,
) => apiClient.request<T>(path, method, body, signal, extraHeaders);
