import { useCallback, useEffect, useRef, useState } from "react";
import { DraftTabs, type TabAction, type TabRole } from "./draftTabs";
import { draftRecord, matchesDraft, matchesDraftRecord, parseDraft, persistDraft, removeDraftRecord, type Draft, type DraftRecord, type PersistenceStatus } from "./draft";

// Действует на загрузку документа: «Дублировать вкладку» копирует sessionStorage (QA-R11-02).
const TAB_ID = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const HANDOFF_FAILED = "Не удалось передать тренировку в это окно. Проверь хранилище и попробуй снова.";

type Options = {
  draft: Draft | null;
  setDraft: (draft: Draft | null) => void;
  draftKey: string;
  accountId: string;
  notify: (text: string) => void;
  onClosed: () => void;
};

type HandoffResult = "claimed" | "closed" | "failed" | "none";

/** Один общий черновик на аккаунт. События обновляют вид, а из действий человека роль меняет только «Продолжить здесь». */
export function useDraftTabs(options: Options) {
  const { draft, setDraft, draftKey, accountId } = options;
  const [role, setRole] = useState<TabRole>(() => DraftTabs.initialRole(draft, TAB_ID, true));
  const roleRef = useRef(role);
  const [probing, setProbing] = useState(role === "follower");
  const [openNote, setOpenNote] = useState(false);
  const [persistence, setPersistence] = useState<PersistenceStatus>("pending");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const opts = useRef(options);
  opts.current = options;
  const observed = useRef<DraftRecord | null>(draft ? draftRecord(draft) : null);
  const lastClaim = useRef(draft?.claim ?? 0);
  const initialProbe = useRef(draft?.owner && draft.owner !== TAB_ID ? draftRecord(draft) : null);
  const mounted = useRef(true);
  // Этот объект уже прочитан из ключа или записан синхронно при передаче; эхо не нужно.
  const synced = useRef<Draft | null>(null);

  const changeRole = useCallback((next: TabRole) => {
    roleRef.current = next;
    setRole(next);
  }, []);

  const replaceDraft = useCallback((next: Draft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, [setDraft]);

  const context = useCallback(() => ({ mine: draftRef.current, observed: observed.current, tab: TAB_ID }), []);

  const reset = useCallback(() => {
    synced.current = null;
    observed.current = null;
    changeRole("owner");
    replaceDraft(null);
    setOpenNote(false);
    setProbing(false);
  }, [changeRole, replaceDraft]);

  const apply = useCallback((action: TabAction) => {
    if (action.kind === "adopt") {
      synced.current = action.draft;
      observed.current = draftRecord(action.draft);
      setPersistence("saved");
      changeRole("follower");
      setOpenNote(false);
      replaceDraft(action.draft);
      if (action.note === "other") opts.current.notify(DraftTabs.OTHER_NOTE);
    } else if (action.kind === "close") {
      reset();
      opts.current.notify(DraftTabs.CLOSED_NOTE);
      opts.current.onClosed();
    }
  }, [changeRole, replaceDraft, reset]);

  const writeCurrent = useCallback((mine: Draft, raw: string | null | undefined) => {
    // undefined означает отказ чтения, а не удаление ключа: свой черновик остаётся в памяти.
    if (raw === undefined) {
      setPersistence("failed");
      return;
    }
    const verdict = DraftTabs.beforeWrite({ ...context(), mine }, raw);
    if (verdict !== "write") {
      apply(verdict);
      return;
    }
    const record = observed.current;
    const keepClaim = record?.owner === TAB_ID && matchesDraft(mine, record);
    const claim = keepClaim && record.claim !== undefined
      ? record.claim
      : DraftTabs.nextClaim(parseDraft(raw), Math.max(Date.now(), lastClaim.current + 1));
    const stamped = DraftTabs.stamp(mine, TAB_ID, claim);
    const status = writeDraft(stamped, draftKey);
    if (status === "saved") {
      observed.current = draftRecord(stamped);
      lastClaim.current = claim;
    }
    setPersistence(status);
  }, [apply, context, draftKey]);

  useEffect(() => {
    if (!draft || draftRef.current !== draft || synced.current === draft || roleRef.current !== "owner") return;
    writeCurrent(draft, readRaw(draftKey));
  }, [draft, draftKey, role, writeCurrent]);

  useEffect(() => {
    mounted.current = true;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== draftKey && event.key !== null) return;
      try {
        if (event.storageArea !== localStorage) return;
      } catch {
        return;
      }
      // Событие может отстать от следующей записи, в том числе после удаления ключа.
      const raw = readRaw(draftKey);
      if (raw === undefined) return;
      const removed = event.key === draftKey && event.newValue === null ? event.oldValue : undefined;
      apply(DraftTabs.onKey(context(), raw, removed));
    };
    const recheck = () => {
      const raw = readRaw(draftKey);
      if (raw === undefined) return;
      // Возврат на страницу сам не захватывает роль и не пишет в ключ.
      apply(DraftTabs.onKey(context(), raw));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") recheck();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", recheck);
    window.addEventListener("pageshow", recheck);
    document.addEventListener("visibilitychange", onVisible);
    recheck();
    return () => {
      mounted.current = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("pageshow", recheck);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [apply, context, draftKey]);

  /** Роль из рендера может отставать: сверяем ключ до изменения полей, отмены или отправки. Не пишем. */
  const canEdit = useCallback((requireReadable = false): boolean => {
    const ctx = context();
    if (!mounted.current || !ctx.mine) return false;
    const raw = readRaw(draftKey);
    if (raw === undefined) {
      setPersistence("failed");
      if (requireReadable && ctx.observed) return false;
    } else apply(DraftTabs.beforeEdit({ ...ctx, mine: ctx.mine }, raw));
    return roleRef.current === "owner" && draftRef.current !== null;
  }, [apply, context, draftKey]);

  /** Следим за тем же сеансом владения через await, даже если окно успело снова забрать черновик. */
  const guardEdit = useCallback((): (() => boolean) | null => {
    if (!canEdit(true)) return null;
    const mine = draftRef.current;
    const claim = lastClaim.current;
    return () => {
      if (!canEdit(true)) return false;
      const current = draftRef.current;
      return !!mine && !!current && DraftTabs.sameDraft(mine, current) && claim === lastClaim.current;
    };
  }, [canEdit]);

  /** Удаляем только ту запись и ту сессию владения, которые проверили. */
  const closeDraft = useCallback((): boolean => {
    if (!canEdit()) return false;
    const record = observed.current;
    if (record) {
      const result = removeDraftRecord(() => localStorage, draftKey, record);
      if (result === "failed") {
        setPersistence("failed");
        return false;
      }
      if (result === "changed") {
        const raw = readRaw(draftKey);
        if (raw !== undefined) apply(DraftTabs.onKey(context(), raw));
        return false;
      }
    }
    reset();
    return true;
  }, [apply, canEdit, context, draftKey, reset]);

  const claimHere = useCallback((probe?: DraftRecord): HandoffResult => {
    const mine = draftRef.current;
    if (!mine || roleRef.current === "owner") return "none";
    const failed = (): HandoffResult => {
      setPersistence("failed");
      opts.current.notify(HANDOFF_FAILED);
      return "failed";
    };
    const raw = readRaw(draftKey);
    if (raw === undefined) return failed();
    if (raw === null) {
      const action = DraftTabs.onKey(context(), raw);
      apply(action);
      return action.kind === "close" ? "closed" : "none";
    }
    const stored = parseDraft(raw, probe ? "restore" : "handoff");
    if (!stored) return failed();
    if (!DraftTabs.sameDraft(stored, mine) || (probe && !matchesDraftRecord(stored, probe))) {
      apply(DraftTabs.beforeEdit({ ...context(), mine }, raw));
      return "none";
    }
    const nextClaim = DraftTabs.nextClaim(stored, Math.max(Date.now(), lastClaim.current + 1));
    const stamped = DraftTabs.stamp(stored, TAB_ID, nextClaim);
    // Сначала публикуем владельца, а уже затем разрешаем действия в этом окне.
    if (writeDraft(stamped, draftKey) !== "saved") return failed();
    lastClaim.current = nextClaim;
    synced.current = stamped;
    observed.current = draftRecord(stamped);
    setPersistence("saved");
    changeRole("owner");
    replaceDraft(stamped);
    setOpenNote(!probe);
    return "claimed";
  }, [apply, changeRole, context, draftKey, replaceDraft]);

  // Только при загрузке: восстановление, если владелец уже закрыл окно или перезагрузился.
  useEffect(() => {
    const probe = initialProbe.current;
    const owner = roleRef.current === "follower" ? probe?.owner : undefined;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(`tyaga-draft-presence:${accountId}`);
    } catch {
      setProbing(false); // Без канала — только явная передача, молча ничего не отбираем.
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    channel.onmessage = ({ data }) => {
      if (data?.t === "who" && data.owner === TAB_ID && typeof data.from === "string" && roleRef.current === "owner") {
        channel.postMessage({ t: "alive", from: TAB_ID, to: data.from });
      }
      if (data?.t === "alive" && data.from === owner && data.to === TAB_ID) {
        clearTimeout(timer);
        setProbing(false);
      }
    };
    if (owner && probe) {
      channel.postMessage({ t: "who", from: TAB_ID, owner });
      timer = setTimeout(() => {
        claimHere(probe);
        setProbing(false);
      }, 400);
    } else setProbing(false);
    return () => {
      clearTimeout(timer);
      channel.close();
    };
  }, [accountId, claimHere]);

  /** «Начать» при черновике, который только что начали в другом окне: открыть его без перезаписи. */
  const takeStored = useCallback((): boolean => {
    if (draftRef.current) return true;
    const stored = parseDraft(readRaw(draftKey) ?? null, "handoff");
    if (!stored) return false;
    apply({ kind: "adopt", draft: stored, note: null });
    return true;
  }, [apply, draftKey]);

  const openHere = useCallback(() => claimHere(), [claimHere]);
  const dismissNote = useCallback(() => setOpenNote(false), []);
  const follower = role === "follower" && !!draft && !probing;
  const banner: "follower" | "open" | null = follower ? "follower" : draft && openNote ? "open" : null;
  return { role, canEdit, guardEdit, closeDraft, follower, banner, persistence, openHere, dismissNote, takeStored, tab: TAB_ID };
}

function readRaw(key: string): string | null | undefined {
  try {
    return localStorage.getItem(key);
  } catch {
    return undefined;
  }
}

function writeDraft(draft: Draft, key: string): PersistenceStatus {
  try {
    return persistDraft(localStorage, draft, key);
  } catch {
    return "failed";
  }
}
