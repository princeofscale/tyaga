import type { Page } from "@playwright/test";
import type { LiveMember, LiveRoom, LiveState } from "../../../src/lib/liveRoom";

/** Состояние комнаты «Вместе» для UI-проверок: ни один запрос не уходит на настоящий воркер или D1. */
export type LiveMock = {
  room: LiveRoom | null;
  /** "МЕТОД /путь" для каждого запроса приложения к маршрутам комнат, по порядку. */
  seen: string[];
  /** Коды, с которыми приложение входило в комнату. */
  joined: string[];
  /** Состояния, которые приложение выложило в комнату. */
  pushed: LiveState[];
  /** Пока задан, ответы на GET ждут его и отдают комнату такой, какой она была в момент запроса. */
  hold: Promise<void> | null;
};

export const ROOM_CODE = "K7M2Q";
/** Код, который сервер не знает: «Комната не найдена или уже закрыта». */
export const UNKNOWN_CODE = "ZZZZZ";

export const liveState = (patch: Partial<LiveState> = {}): LiveState => ({
  phase: "lifting",
  exercise: "Жим штанги лёжа",
  setsDone: 2,
  setsTotal: 4,
  tonnageKg: 1200,
  lastSet: { kg: 80, reps: 8 },
  restEndsAt: null,
  ...patch,
});

export const member = (patch: Partial<LiveMember> & Pick<LiveMember, "id" | "displayName">): LiveMember => ({
  isMe: false,
  state: null,
  updatedAt: new Date().toISOString(),
  ...patch,
});

/** Дмитрий уже в комнате и жмёт; ты вошёл следом. */
export const roomWithPartner = (me = "Саша"): LiveRoom => ({
  code: ROOM_CODE,
  members: [
    member({ id: 7, displayName: "Дмитрий", state: liveState() }),
    member({ id: 8, displayName: me, isMe: true }),
  ],
});

export const liveMock = (room: LiveRoom | null = null): LiveMock => ({ room, seen: [], joined: [], pushed: [], hold: null });

/** Маршруты `/api/friends/live`. Регистрируется после общего `**\/api/**`, поэтому перехватывает свои адреса первым. */
export async function mockLive(page: Page, state: LiveMock = liveMock(), me = "Саша") {
  await page.route("**/api/friends/live**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    state.seen.push(`${method} ${path}`);
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (method === "GET" && path === "/api/friends/live") {
      const snapshot = state.room;
      return (state.hold ?? Promise.resolve()).then(() => json({ room: snapshot }));
    }
    if (method === "POST" && path === "/api/friends/live") {
      state.room = { code: "H7KQ2", members: [member({ id: 1, displayName: me, isMe: true })] };
      return json({ room: state.room });
    }
    if (method === "POST" && path === "/api/friends/live/join") {
      const code = String(request.postDataJSON().code);
      state.joined.push(code);
      if (code !== ROOM_CODE) return json({ error: "Комната не найдена или уже закрыта" }, 400);
      state.room = roomWithPartner(me);
      return json({ room: state.room });
    }
    if (method === "PUT" && path === "/api/friends/live/state") {
      state.pushed.push(request.postDataJSON());
      return json({ room: state.room });
    }
    if (method === "DELETE" && path === "/api/friends/live") {
      state.room = null;
      return json({ room: null });
    }
    return json({ error: "Не найдено" }, 404);
  });
  return state;
}
