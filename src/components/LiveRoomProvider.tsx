import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LiveLink, LivePushPolicy, LIVE_RETRY_MS, LIVE_REQUEST_TIMEOUT_MS, type LiveLinkIssue, type LivePush } from "../domain/LiveSession";
import { ApiError } from "../services/ApiClient";
import { CLOUD_URL, cloudState } from "../device/cloudSync";
import type { LiveRoom, LiveState } from "../lib/liveRoom";
import { liveRoomApi } from "../services/LiveRoomApi";
import "../styles/together.css";

const POLL_MS = 5_000;
const HEARTBEAT_CHECK_MS = 15_000;
const SEND_DELAY_MS = 700;
const onDevice = import.meta.env.MODE === "device";
const message = (error: unknown) => (error instanceof Error ? error.message : "Не удалось выполнить запрос");

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
const LiveRoomContext = createContext<LiveRoomApiState>(idle);
export const useLiveRoom = () => useContext(LiveRoomContext);

/** На Android комнаты живут в облаке: без подключённого облака спрашивать некого. В браузере связь всегда «есть». */
function useCloudReachable() {
  const [token, setToken] = useState(() => (onDevice ? (cloudState()?.token ?? null) : null));
  useEffect(() => {
    if (!onDevice) return;
    const changed = () => setToken(cloudState()?.token ?? null);
    window.addEventListener("tyaga:cloud", changed);
    return () => window.removeEventListener("tyaga:cloud", changed);
  }, []);
  return !onDevice || !!(CLOUD_URL && token);
}

/**
 * Одна комната на человека. Ответы сервера, пришедшие после выхода или входа в другую
 * комнату, отбрасываются по номеру эпохи, чтобы старый опрос не вернул человека назад.
 * Вне комнаты приложение спрашивает о ней один раз при запуске и больше не опрашивает.
 */
export function LiveRoomProvider({ children }: { children: ReactNode }) {
  const [room, setRoom] = useState<LiveRoom | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [watchers, setWatchers] = useState(0);
  const reachable = useCloudReachable();
  const epoch = useRef(0);
  const roomRef = useRef(room);
  roomRef.current = room;
  const latest = useRef<LiveState | null>(null);
  const lastPush = useRef<LivePush | null>(null);
  const delay = useRef<number | undefined>(undefined);
  /** Что не дошло до комнаты и ждёт повтора, пока нет более свежего состояния. */
  const unsent = useRef<LiveState | null>(null);
  const retry = useRef<number | undefined>(undefined);
  /** Когда в последний раз запрос к комнате удался (монотонные часы). */
  const lastOk = useRef(performance.now());
  /** Неудачи опроса (GET) и отправки состояния (PUT) считаются отдельно: удавшийся опрос не доказывает, что дошло наше состояние (R09-QA-12). */
  const [pollIssue, setPollIssue] = useState<LiveLinkIssue | null>(null);
  const [sendIssue, setSendIssue] = useState<LiveLinkIssue | null>(null);
  // Для «Нет связи» считаем по монотонным часам: перевод стрелок и подмена даты не должны ни прятать, ни выдумывать потерю связи.
  const [clock, setClock] = useState(() => performance.now());

  /** Опрос удался: снимает свои неудачи, а «Нет связи» из-за неотправленного состояния остаётся, пока оно не дойдёт. */
  const pollOk = useCallback(() => {
    lastOk.current = performance.now();
    setPollIssue(null);
    if (!unsent.current) setSendIssue(null);
  }, []);
  /** Отправка удалась: состояние дошло, значит связь с комнатой есть — снимаем «Нет связи» целиком. */
  const sendOk = useCallback(() => {
    lastOk.current = performance.now();
    setPollIssue(null);
    setSendIssue(null);
  }, []);
  /**
   * Запрос к комнате не дошёл (сеть, обрыв, воркер 5xx): считаем неудачу и повторяем, а не ждём опрос и heartbeat.
   * Повтор — через LIVE_RETRY_MS после начала неудавшегося запроса: если он провисел до тайм-аута, повторяем почти сразу (не реже чем через секунду), иначе счёт до «Нет связи» растянулся бы.
   */
  const linkFailed = useCallback((kind: "poll" | "send", startedAt = performance.now()) => {
    if (!roomRef.current) return;
    const now = performance.now();
    (kind === "send" ? setSendIssue : setPollIssue)((was) => LiveLink.failed(was, now, lastOk.current));
    setClock(now);
    window.clearTimeout(retry.current);
    retry.current = window.setTimeout(() => {
      if (!roomRef.current) return;
      const next = latest.current ?? unsent.current;
      if (next) void sendRef.current(next);
      else void refreshRef.current();
    }, Math.max(1_000, LIVE_RETRY_MS - (now - startedAt)));
  }, []);

  const refresh = useCallback(async () => {
    const mine = epoch.current;
    const startedAt = performance.now();
    try {
      const reply = await liveRoomApi.current(AbortSignal.timeout(LIVE_REQUEST_TIMEOUT_MS));
      if (epoch.current !== mine) return;
      setRoom(reply.room);
      pollOk();
    } catch (error) {
      // Связи нет: оставляем то, что было, и спросим снова на следующем опросе.
      if (epoch.current === mine && (!(error instanceof ApiError) || error.status >= 500)) linkFailed("poll", startedAt);
    }
  }, [pollOk, linkFailed]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!reachable) {
      ++epoch.current;
      setRoom(null);
      setReady(true);
      return;
    }
    void refresh().finally(() => setReady(true));
  }, [refresh, reachable]);

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
      const startedAt = performance.now();
      lastPush.current = LivePushPolicy.mark(state, Date.now());
      try {
        const reply = await liveRoomApi.push(state, AbortSignal.timeout(LIVE_REQUEST_TIMEOUT_MS));
        if (epoch.current === mine) setRoom(reply.room);
        unsent.current = null;
        sendOk();
      } catch (error) {
        // Не дошло: следующий heartbeat отправит снова, а если комната закрылась — refresh это покажет.
        lastPush.current = null;
        // Отказ «комнаты нет» — не потеря связи; сеть, обрыв и ответы воркера 5xx — да.
        if (epoch.current === mine && (!(error instanceof ApiError) || error.status >= 500)) {
          unsent.current = state;
          linkFailed("send", startedAt);
        }
        void refresh();
      }
    },
    [refresh, sendOk, linkFailed],
  );
  const sendRef = useRef(send);
  sendRef.current = send;

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

  useEffect(() => () => { window.clearTimeout(delay.current); window.clearTimeout(retry.current); }, []);

  // Пока есть неудачи, раз в секунду проверяем, не пора ли сказать «Нет связи»; без комнаты счёт сбрасывается.
  useEffect(() => {
    if (!pollIssue && !sendIssue) return;
    const timer = window.setInterval(() => setClock(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pollIssue, sendIssue]);
  // Быстрый путь: браузер сам сообщает, что сети нет или она вернулась, — не ждём очередного опроса.
  useEffect(() => {
    if (!inRoom) return;
    const gone = () => linkFailed("poll");
    const back = () => {
      const next = latest.current ?? unsent.current;
      if (next) void sendRef.current(next);
      else void refreshRef.current();
    };
    window.addEventListener("offline", gone);
    window.addEventListener("online", back);
    return () => {
      window.removeEventListener("offline", gone);
      window.removeEventListener("online", back);
    };
  }, [inRoom, linkFailed]);
  useEffect(() => {
    if (inRoom) return;
    unsent.current = null;
    window.clearTimeout(retry.current);
    setPollIssue(null);
    setSendIssue(null);
  }, [inRoom]);

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

  const enter = useCallback(async (request: () => Promise<{ room: LiveRoom | null }>) => {
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
  const create = useCallback(() => enter(() => liveRoomApi.create()), [enter]);
  const join = useCallback((code: string) => enter(() => liveRoomApi.join(code)), [enter]);

  const leave = useCallback(async () => {
    const mine = ++epoch.current;
    window.clearTimeout(delay.current);
    window.clearTimeout(retry.current);
    lastPush.current = null;
    unsent.current = null;
    setPollIssue(null);
    setSendIssue(null);
    setRoom(null);
    setError("");
    try {
      await liveRoomApi.leave();
    } catch (e) {
      if (epoch.current === mine) {
        setError(message(e));
        void refresh();
      }
    }
  }, [refresh]);

  const clearError = useCallback(() => setError(""), []);

  const watch = useCallback(() => {
    setWatchers((n) => n + 1);
    return () => setWatchers((n) => n - 1);
  }, []);

  const linkLost = inRoom && (LiveLink.lost(pollIssue, clock) || LiveLink.lost(sendIssue, clock));
  const value = useMemo<LiveRoomApiState>(
    () => ({ room, ready, busy, error, create, join, leave, clearError, watch, broadcast, finish, linkLost }),
    [room, ready, busy, error, create, join, leave, clearError, watch, broadcast, finish, linkLost],
  );
  return <LiveRoomContext.Provider value={value}>{children}</LiveRoomContext.Provider>;
}
