import { useCallback, useEffect, useRef, useState } from "react";
import { DraftTabs, type TabAction, type TabRole } from "./draftTabs";
import { parseDraft, persistDraft, type Draft, type PersistenceStatus } from "./draft";

/** Идентификатор вкладки: переживает перезагрузку вкладки (sessionStorage), у соседней вкладки — свой. */
function tabId(): string {
  const fresh = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  try {
    const known = sessionStorage.getItem("tyaga-tab-id");
    if (known) return known;
    const id = fresh();
    sessionStorage.setItem("tyaga-tab-id", id);
    return id;
  } catch {
    return fresh();
  }
}

type Options = {
  draft: Draft | null;
  setDraft: (draft: Draft | null) => void;
  draftKey: string;
  accountId: string;
  /** Короткое сообщение человеку (тост). */
  notify: (text: string) => void;
  /** Тренировку закончили или отменили в другом окне: вкладка убрала свой черновик. */
  onClosed: () => void;
  /** Вкладка с тренировкой сейчас на экране тренировки: нажатие внутри неё делает её основной. */
  claimOnTouch: boolean;
};

/**
 * Черновик тренировки в нескольких вкладках одного браузера (R11-REQ02). Правила — в `DraftTabs`; здесь только проводка:
 * события `storage` и возвращение на вкладку сверяют её черновик с общим ключом, запись идёт только у основной вкладки.
 * «Есть ли другое живое окно» вкладка, загрузившаяся с чужим черновиком, спрашивает по BroadcastChannel (без него остаётся ведомой).
 */
export function useDraftTabs(options: Options) {
  const { draft, setDraft, draftKey, accountId } = options;
  const tab = useRef(tabId()).current;
  const [role, setRole] = useState<TabRole>(() => {
    const stored = draft ? parseDraft(readRaw(draftKey)) : null;
    return DraftTabs.initialRole(stored, tab, false) === "owner" ? "owner" : "follower";
  });
  const [persistence, setPersistence] = useState<PersistenceStatus>("pending");
  const roleRef = useRef(role);
  roleRef.current = role;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const opts = useRef(options);
  opts.current = options;
  /** Тренировка, которую эта вкладка видела в общем ключе последней (записала сама или приняла от другой). */
  const ownId = useRef<string | null>(draft?.workout.id ?? null);
  const claim = useRef(0);
  /** Черновик, только что принятый от другой вкладки: обратно в ключ не пишется. */
  const adopted = useRef<Draft | null>(null);

  const becomeOwner = useCallback(() => {
    roleRef.current = "owner";
    setRole("owner");
  }, []);

  const apply = useCallback(
    (action: TabAction) => {
      if (action.kind === "none") return;
      if (action.kind === "adopt") {
        adopted.current = action.draft;
        ownId.current = action.draft.workout.id;
        roleRef.current = "follower";
        setRole("follower");
        setDraft(action.draft);
        if (action.note === "other") opts.current.notify(DraftTabs.OTHER_NOTE);
        return;
      }
      if (action.kind === "close") {
        adopted.current = null;
        ownId.current = null;
        claim.current = 0;
        becomeOwner();
        setDraft(null);
        opts.current.notify(DraftTabs.CLOSED_NOTE);
        opts.current.onClosed();
        return;
      }
      // reassert: наша запись новее, чем то, что попало в ключ, — перепишем (эффект записи следит за draft)
      const mine = draftRef.current;
      if (mine) write(mine);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setDraft, becomeOwner],
  );

  function write(mine: Draft): PersistenceStatus {
    try {
      const status = persistDraft(localStorage, DraftTabs.stamp(mine, tab, claim.current), draftKey);
      if (status === "saved") ownId.current = mine.workout.id;
      return status;
    } catch {
      return "failed";
    }
  }

  const context = () => ({ mine: draftRef.current, ownId: ownId.current, tab, claim: claim.current });

  // Запись черновика: только основная вкладка, и только если в ключе нет более новой чужой записи или закрытия.
  useEffect(() => {
    if (!draft) {
      // Убрать из ключа можно только свою тренировку (R09-QA-08); без записи с нашей стороны ключ не трогаем.
      if (ownId.current) persistDraft(localStorage, null, draftKey, ownId.current);
      ownId.current = null;
      claim.current = 0;
      adopted.current = null;
      if (roleRef.current !== "owner") becomeOwner();
      return;
    }
    if (adopted.current === draft) return; // только что принят от другой вкладки: не эхо
    if (roleRef.current !== "owner") return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(draftKey);
    } catch {
      /* хранилище недоступно: запись ниже сообщит «не сохранено» */
    }
    const verdict = DraftTabs.beforeWrite({ ...context(), mine: draft }, raw);
    if (verdict !== "write") {
      apply(verdict);
      return;
    }
    if (claim.current === 0) claim.current = DraftTabs.nextClaim(parseDraft(raw));
    setPersistence(write(draft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, role, draftKey]);

  // Другие вкладки меняют общий ключ; вкладка, к которой вернулись, сверяется с ним сама (события в фоне могли не дойти).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== draftKey || e.storageArea !== localStorage) return;
      apply(DraftTabs.onKey(context(), e.newValue, e.oldValue));
    };
    const recheck = () => {
      if (document.visibilityState === "hidden") return;
      try {
        apply(DraftTabs.onKey(context(), localStorage.getItem(draftKey)));
      } catch {
        /* хранилище недоступно */
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", recheck);
    window.addEventListener("pageshow", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("pageshow", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, apply]);

  /** Сделать эту вкладку основной: подтянуть актуальный черновик из ключа и писать дальше с него. */
  const claimHere = useCallback(() => {
    if (roleRef.current === "owner") return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(draftKey);
    } catch {
      /* ниже вкладка просто станет основной с тем, что есть */
    }
    const stored = parseDraft(raw);
    const mine = draftRef.current;
    if (!mine) return;
    if (raw === null && ownId.current === mine.workout.id) {
      apply({ kind: "close", id: mine.workout.id });
      return;
    }
    claim.current = DraftTabs.nextClaim(stored);
    adopted.current = null;
    roleRef.current = "owner";
    setRole("owner");
    // Актуальные подходы — из ключа (их писала прежняя основная вкладка); без него — то, что на экране.
    setDraft(stored && stored.workout.id === mine.workout.id ? stored : mine);
  }, [draftKey, apply, setDraft]);

  // Нажатие или ввод в вкладке с тренировкой делает её основной: пишет то окно, где человек сейчас работает.
  useEffect(() => {
    if (role !== "follower" || !draft || !options.claimOnTouch) return;
    const touch = (e: Event) => {
      const target = e.target as Element | null;
      if (target && target.closest && target.closest("main")) claimHere();
    };
    // Нажатие, фокус в поле и ввод (в том числе вставка и голосовой ввод, где клавиши нет).
    const events = ["pointerdown", "keydown", "focusin", "input"];
    for (const name of events) document.addEventListener(name, touch, true);
    return () => {
      for (const name of events) document.removeEventListener(name, touch, true);
    };
  }, [role, draft, options.claimOnTouch, claimHere]);

  // Живое окно с черновиком отвечает на вопрос «кто здесь»; вкладка, загрузившаяся с чужим черновиком, спрашивает и,
  // если ответа нет (окно с ним закрыто), продолжает здесь. Без BroadcastChannel вкладка остаётся ведомой: молчаливой потери нет.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`tyaga-draft-presence:${accountId}`);
    let alive = false;
    channel.onmessage = (e) => {
      if (!e.data || e.data.from === tab) return;
      if (e.data.t === "alive") alive = true;
      if (e.data.t === "who" && draftRef.current) channel.postMessage({ t: "alive", from: tab });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (roleRef.current === "follower" && draftRef.current) {
      channel.postMessage({ t: "who", from: tab });
      timer = setTimeout(() => {
        if (!alive && roleRef.current === "follower" && draftRef.current) claimHere();
      }, 400);
    }
    return () => {
      if (timer) clearTimeout(timer);
      channel.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  /** «Начать» при черновике, начатом в другом окне, но ещё не дошедшем до этой вкладки: взять его, а не создавать второй. */
  const takeStored = useCallback((): boolean => {
    if (draftRef.current) return false;
    try {
      const stored = parseDraft(localStorage.getItem(draftKey));
      if (!stored) return false;
      apply({ kind: "adopt", draft: stored, note: null });
      return true;
    } catch {
      return false;
    }
  }, [draftKey, apply]);

  return { role, persistence, claim: claimHere, takeStored, tab };
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
