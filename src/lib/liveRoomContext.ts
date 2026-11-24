import { createContext, useContext } from "react";
import type { LiveRoom, LiveState } from "./liveRoom";

export type LiveRoomApiState = {
  room: LiveRoom | null;
  /** Первая загрузка завершена: до этого нельзя утверждать, что комнаты нет. */
  ready: boolean;
  busy: boolean;
  error: string;
  create: () => Promise<boolean>;
  join: (code: string) => Promise<boolean>;
  leave: () => Promise<void>;
  /** Забыть причину прошлого отказа: нужна, когда человек закрыл приглашение и не хочет видеть чужую ошибку. */
  clearError: () => void;
  /** Пока кто-то на экране показывает комнату, она опрашивается. Возвращает отписку. */
  watch: () => () => void;
  /** Состояние идущей тренировки. Изменения уходят через SEND_DELAY_MS, повтор без изменений — раз в LIVE_HEARTBEAT_MS. */
  broadcast: (state: LiveState | null) => void;
  /** Тренировка закончена: итог уходит без задержки. */
  finish: (state: LiveState) => void;
  /** Состояние комнаты дольше ~10 с не доходит до напарников (нет сети, воркер не отвечает). */
  linkLost: boolean;
};

const idle: LiveRoomApiState = {
  room: null,
  ready: true,
  busy: false,
  error: "",
  create: async () => false,
  join: async () => false,
  leave: async () => {},
  clearError: () => {},
  watch: () => () => {},
  broadcast: () => {},
  finish: () => {},
  linkLost: false,
};

export const LiveRoomContext = createContext<LiveRoomApiState>(idle);
export const useLiveRoom = () => useContext(LiveRoomContext);
