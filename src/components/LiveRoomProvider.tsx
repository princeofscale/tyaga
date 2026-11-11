import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LivePushPolicy, type LivePush } from "../domain/LiveSession";
import type { LiveRoom, LiveState } from "../lib/social";
import { socialService } from "../services/SocialService";

const POLL_MS = 5_000;
const HEARTBEAT_CHECK_MS = 15_000;
const SEND_DELAY_MS = 700;
const onDevice = import.meta.env.MODE === "device";
const message = (error: unknown) => (error instanceof Error ? error.message : "Не удалось выполнить запрос");

export type LiveRoomApi = {
  room: LiveRoom | null;
  /** Первая загрузка завершена: до этого нельзя утверждать, что комнаты нет. */
  ready: boolean;
  busy: boolean;
  error: string;
  create: () => Promise<boolean>;
  join: (code: string) => Promise<boolean>;
  leave: () => Promise<void>;
  /** Пока кто-то на экране показывает комнату, она опрашивается. Возвращает отписку. */
  watch: () => () => void;
  /** Состояние идущей тренировки. Изменения уходят сразу, повтор без изменений — раз в LIVE_HEARTBEAT_MS. */
  broadcast: (state: LiveState | null) => void;
  /** Тренировка закончена: итог уходит без задержки. */
  finish: (state: LiveState) => void;
};

const idle: LiveRoomApi = {
  room: null,
  ready: true,
  busy: false,
  error: "",
  create: async () => false,
  join: async () => false,
  leave: async () => {},
  watch: () => () => {},
  broadcast: () => {},
  finish: () => {},
};
const LiveRoomContext = createContext<LiveRoomApi>(idle);
export const useLiveRoom = () => useContext(LiveRoomContext);

/**
 * Одна комната на человека. Ответы сервера, пришедшие после выхода или входа в другую
 * комнату, отбрасываются по номеру эпохи, чтобы старый опрос не вернул человека назад.
 */
export function LiveRoomProvider({ children }: { children: ReactNode }) {
  const [room, setRoom] = useState<LiveRoom | null>(null);
  const [ready, setReady] = useState(onDevice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [watchers, setWatchers] = useState(0);
  const epoch = useRef(0);
  const roomRef = useRef(room);
  roomRef.current = room;
  const latest = useRef<LiveState | null>(null);
  const lastPush = useRef<LivePush | null>(null);
  const delay = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const mine = epoch.current;
    try {
      const reply = await socialService.liveRoom();
      if (epoch.current === mine) setRoom(reply.room);
    } catch {
      // Связи нет: оставляем то, что было, и спросим снова на следующем опросе.
    }
  }, []);

  useEffect(() => {
    if (onDevice) return;
    void refresh().finally(() => setReady(true));
  }, [refresh]);

  const inRoom = room !== null;
  const watching = watchers > 0;
  useEffect(() => {
    if (!inRoom || !watching) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [inRoom, watching, refresh]);

  const send = useCallback(
    async (state: LiveState) => {
      const mine = epoch.current;
      lastPush.current = LivePushPolicy.mark(state, Date.now());
      try {
        const reply = await socialService.pushLive(state);
        if (epoch.current === mine) setRoom(reply.room);
      } catch {
        // Не дошло: следующий heartbeat отправит снова, а если комната закрылась — refresh это покажет.
        lastPush.current = null;
        void refresh();
      }
    },
    [refresh],
  );

  const flush = useCallback(() => {
    const state = latest.current;
    if (state && roomRef.current && LivePushPolicy.due(lastPush.current, state, Date.now())) void send(state);
  }, [send]);

  // Вошли в комнату во время тренировки — сразу сообщаем, где мы; дальше следим за heartbeat.
  useEffect(() => {
    if (!inRoom) return;
    flush();
    const timer = window.setInterval(flush, HEARTBEAT_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [inRoom, flush]);

  useEffect(() => () => window.clearTimeout(delay.current), []);

  const broadcast = useCallback(
    (state: LiveState | null) => {
      latest.current = state;
      window.clearTimeout(delay.current);
      if (state) delay.current = window.setTimeout(flush, SEND_DELAY_MS);
    },
    [flush],
  );

  const finish = useCallback(
    (state: LiveState) => {
      window.clearTimeout(delay.current);
      latest.current = null;
      if (roomRef.current) void send(state);
    },
    [send],
  );

  const enter = useCallback(async (request: () => Promise<{ room: LiveRoom }>) => {
    const mine = ++epoch.current;
    setBusy(true);
    setError("");
    try {
      const reply = await request();
      if (epoch.current !== mine) return false;
      lastPush.current = null;
      setRoom(reply.room);
      return true;
    } catch (e) {
      if (epoch.current === mine) setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  const create = useCallback(() => enter(() => socialService.createRoom()), [enter]);
  const join = useCallback((code: string) => enter(() => socialService.joinRoom(code)), [enter]);

  const leave = useCallback(async () => {
    const mine = ++epoch.current;
    window.clearTimeout(delay.current);
    lastPush.current = null;
    setRoom(null);
    setError("");
    try {
      await socialService.leaveRoom();
    } catch (e) {
      if (epoch.current === mine) {
        setError(message(e));
        void refresh();
      }
    }
  }, [refresh]);

  const watch = useCallback(() => {
    setWatchers((n) => n + 1);
    return () => setWatchers((n) => n - 1);
  }, []);

  const value = useMemo<LiveRoomApi>(
    () => ({ room, ready, busy, error, create, join, leave, watch, broadcast, finish }),
    [room, ready, busy, error, create, join, leave, watch, broadcast, finish],
  );
  return <LiveRoomContext.Provider value={value}>{children}</LiveRoomContext.Provider>;
}
