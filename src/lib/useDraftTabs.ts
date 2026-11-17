import { useCallback, useEffect, useRef, useState } from "react";
import { DraftTabs, type TabAction, type TabRole } from "./draftTabs";
import { parseDraft, persistDraft, type Draft, type PersistenceStatus } from "./draft";

/**
 * Идентификатор окна — на загрузку документа, а не в `sessionStorage`: «Дублировать вкладку» и ссылка без noopener копируют
 * `sessionStorage`, и два окна с одним id считали бы себя одним и тем же владельцем (R11-QA-R11-02). Перезагрузка окна даёт новый id;
 * окно-владелец после неё возвращает себе черновик само (опрос «кто здесь»), пока опрос идёт — строка «открыта в другом окне» скрыта.
 */
const TAB_ID = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

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
  const tab = TAB_ID;
  const [role, setRole] = useState<TabRole>(() => {
    const stored = draft ? parseDraft(readRaw(draftKey)) : null;
    return DraftTabs.initialRole(stored, tab, false) === "owner" ? "owner" : "follower";
  });
  /** Окно загрузилось с черновиком, записанным другим окном (или собой до перезагрузки): спрашиваем «кто здесь», строку не показываем. */
  const [probing, setProbing] = useState(() => {
    const stored = draft ? parseDraft(readRaw(draftKey)) : null;
    return !!stored && stored.owner !== undefined && stored.owner !== TAB_ID;
  });
  const probingRef = useRef(probing);
  probingRef.current = probing;
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
      // Событие могло прийти позже следующей записи (своей или чужой): значение берём из ключа сейчас, а не из события.
      // Только при удалении нужен oldValue — по нему видно, чей черновик убрали.
      let raw: string | null = e.newValue;
      if (raw !== null) {
        try {
          raw = localStorage.getItem(draftKey);
        } catch {
          /* остаётся значение события */
        }
      }
      apply(DraftTabs.onKey(context(), raw, e.oldValue));
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
  const claimHere = useCallback((): "claimed" | "closed" | "none" => {
    if (probingRef.current) setProbing(false);
    if (roleRef.current === "owner") return "none";
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(draftKey);
    } catch {
      /* ниже вкладка просто станет основной с тем, что есть */
    }
    const stored = parseDraft(raw);
    const mine = draftRef.current;
    if (!mine) return "none";
    if (raw === null && ownId.current === mine.workout.id) {
      apply({ kind: "close", id: mine.workout.id });
      return "closed";
    }
    claim.current = DraftTabs.nextClaim(stored);
    adopted.current = null;
    roleRef.current = "owner";
    setRole("owner");
    // Актуальные подходы — из ключа (их писала прежняя основная вкладка); без него — то, что на экране.
    setDraft(stored && stored.workout.id === mine.workout.id ? stored : mine);
    return "claimed";
  }, [draftKey, apply, setDraft]);

  // Первое нажатие в «ведомом» окне только делает его основным и не выполняет действие под пальцем (R11-QA-R11-01):
  // строка «открыта в другом окне» уходит из потока, вёрстка съезжает, и `click` попал бы в соседнюю кнопку («+5» у веса уже отмеченного подхода).
  // Остаток жеста (touch/mouse/click) глушится в capture-фазе до React; следующее нажатие — обычное. Клавиатура и «Открыть здесь» не глушатся.
  const swallowUntil = useRef(0);
  useEffect(() => {
    const names = ["pointerup", "touchstart", "touchend", "mousedown", "mouseup", "click", "dblclick"];
    const stop = (e: Event) => {
      if (Date.now() > swallowUntil.current) return;
      if (e.type === "mousedown" || e.type === "click" || e.type === "dblclick") e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === "click" || e.type === "dblclick") swallowUntil.current = 0;
    };
    const down = (e: Event) => {
      swallowUntil.current = 0; // новый жест
      if (roleRef.current !== "follower" || !draftRef.current || !opts.current.claimOnTouch) return;
      const target = e.target as Element | null;
      if (!target || !target.closest || !target.closest("main") || target.closest(".draft-follower")) return;
      const silent = probingRef.current; // пока строки нет, вёрстка не двигается: нажатие можно не глушить
      const result = claimHere();
      if (result === "none" || silent) return;
      swallowUntil.current = Date.now() + 3000;
      e.stopImmediatePropagation();
      if (result === "claimed") opts.current.notify(DraftTabs.TOUCH_NOTE);
    };
    document.addEventListener("pointerdown", down, true);
    for (const name of names) document.addEventListener(name, stop, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", down, true);
      for (const name of names) document.removeEventListener(name, stop, { capture: true });
    };
  }, [claimHere]);

  // Нажатие или ввод в вкладке с тренировкой делает её основной: пишет то окно, где человек сейчас работает.
  useEffect(() => {
    if (role !== "follower" || !draft || !options.claimOnTouch) return;
    const touch = (e: Event) => {
      const target = e.target as Element | null;
      if (target && target.closest && target.closest("main")) claimHere();
    };
    // Клавиша, фокус в поле и ввод (в том числе вставка и голосовой ввод, где клавиши нет); касание — в обработчике выше.
    const events = ["keydown", "focusin", "input"];
    for (const name of events) document.addEventListener(name, touch, true);
    return () => {
      for (const name of events) document.removeEventListener(name, touch, true);
    };
  }, [role, draft, options.claimOnTouch, claimHere]);

  // Живое окно с черновиком отвечает на вопрос «кто здесь»; вкладка, загрузившаяся с чужим черновиком, спрашивает и,
  // если ответа нет (окно с ним закрыто), продолжает здесь. Без BroadcastChannel вкладка остаётся ведомой: молчаливой потери нет.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      setProbing(false); // спросить некого: окно остаётся ведомым до нажатия, молча ничего не теряется
      return;
    }
    const channel = new BroadcastChannel(`tyaga-draft-presence:${accountId}`);
    let alive = false;
    channel.onmessage = (e) => {
      if (!e.data || e.data.from === tab) return;
      if (e.data.t === "alive") {
        alive = true;
        setProbing(false);
      }
      if (e.data.t === "who" && draftRef.current) channel.postMessage({ t: "alive", from: tab });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (roleRef.current === "follower" && draftRef.current) {
      channel.postMessage({ t: "who", from: tab });
      timer = setTimeout(() => {
        if (!alive && roleRef.current === "follower" && draftRef.current) claimHere();
        setProbing(false);
      }, 400);
    } else setProbing(false);
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

  /** Строку «открыта в другом окне» показываем, когда окно точно ведомое: пока идёт опрос, её нет (без мигания и сдвига вёрстки). */
  const follower = role === "follower" && !probing;
  return { role, follower, persistence, claim: claimHere, takeStored, tab };
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
