import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  CalendarDays,
  Check,
  CheckCheck,
  Copy,
  Download,
  Dumbbell,
  Play,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  FriendsService,
  type Athlete,
  type FriendsData,
} from "../domain/FriendsService";
import { LaidDupPlan } from "../domain/LaidDupPlan";
import {
  SHARED_TEMPLATES,
  SharedProgramBuilder,
  type SharedProgram,
} from "../domain/SharedProgram";
import { friendsApi } from "../services/FriendsApi";
import { CLOUD_URL, cloudState } from "../device/cloudSync";
import { localDate } from "../lib/calendar";
import type { Routine, Workout } from "../lib/types";
import { useLiveRoom } from "../lib/liveRoomContext";
import Modal from "./Modal";
import RoomInvite from "./RoomInvite";
import TogetherCard from "./TogetherCard";
import "../styles/friends.css";

type FriendsTab = "friends" | "together" | "programs";
type CreateMode = "template" | "mine";

const initialCode = () =>
  new URLSearchParams(location.search).get("friend") ?? "";

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();

function Avatar({
  athlete,
  small = false,
}: {
  athlete: Pick<Athlete, "displayName">;
  small?: boolean;
}) {
  return (
    <span
      className={`friend-avatar ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      {initials(athlete.displayName)}
    </span>
  );
}

export default function FriendsScreen({
  onProfile,
  workouts = [],
  routines = [],
  timeZone,
  roomInvite = null,
  onRoomInviteHandled = () => {},
  onToast = () => {},
  workoutActive = false,
  onWorkout = () => {},
  onSaveRoutine,
  onStartRoutine,
  onOpenPrograms,
}: {
  onProfile: () => void;
  workouts?: Workout[];
  routines?: Routine[];
  timeZone?: string;
  roomInvite?: string | null;
  onRoomInviteHandled?: () => void;
  onToast?: (text: string) => void;
  workoutActive?: boolean;
  onWorkout?: () => void;
  onSaveRoutine?: (routine: Routine) => Promise<Routine>;
  onStartRoutine?: (routine: Routine) => void;
  onOpenPrograms?: () => void;
}) {
  const { room, create: createRoom } = useLiveRoom();
  const [tab, setTab] = useState<FriendsTab>(() =>
    roomInvite || room ? "together" : "friends",
  );
  const [data, setData] = useState<FriendsData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [code, setCode] = useState(initialCode);
  const [removing, setRemoving] = useState<Athlete | null>(null);

  // Модалка «Поделиться / Создать общую программу»
  const [programModal, setProgramModal] = useState<CreateMode | null>(null);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState<"laid_dup" | "upper_lower" | "ppl" | "fullbody">("laid_dup");
  const [selectedRoutineId, setSelectedRoutineId] = useState<string>("");
  const [customTitle, setCustomTitle] = useState("");
  const [adoptImmediately, setAdoptImmediately] = useState(true);

  const [cloudToken, setCloudToken] = useState(() =>
    import.meta.env.MODE === "device" ? (cloudState()?.token ?? null) : null,
  );
  const generation = useRef(0);
  const mounted = useRef(true);
  const mutating = useRef(false);
  const reduced = useReducedMotion();
  const connected =
    import.meta.env.MODE !== "device" || !!(CLOUD_URL && cloudToken);
  const today = useMemo(() => localDate(new Date(), timeZone), [timeZone]);

  useEffect(() => {
    if (roomInvite) setTab("together");
  }, [roomInvite]);

  useEffect(() => {
    if (import.meta.env.MODE !== "device") return;
    const changed = () => setCloudToken(cloudState()?.token ?? null);
    window.addEventListener("tyaga:cloud", changed);
    return () => window.removeEventListener("tyaga:cloud", changed);
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = ++generation.current;
    const next = await friendsApi.request<FriendsData>(
      "/api/friends",
      "GET",
      undefined,
      signal,
    );
    if (!mounted.current || signal?.aborted || version !== generation.current)
      return;
    setData(next);
    setError("");
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    setData(null);
    if (!connected) return;
    const controller = new AbortController();
    const load = () => {
      if (document.visibilityState !== "visible" || mutating.current) return;
      void refresh(controller.signal).catch((e) => {
        if (!controller.signal.aborted && mounted.current)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить друзей",
          );
      });
    };
    load();
    const interval = window.setInterval(load, 20000);
    document.addEventListener("visibilitychange", load);
    window.addEventListener("online", load);
    return () => {
      mounted.current = false;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener("online", load);
    };
  }, [refresh, connected, cloudToken]);

  async function perform(
    path: string,
    method: string,
    body: unknown,
    message: string,
    after?: () => void,
  ) {
    if (mutating.current) return false;
    mutating.current = true;
    ++generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await friendsApi.request(path, method, body);
      if (!mounted.current) return false;
      after?.();
      if (message) setNotice(message);
      try {
        await refresh();
      } catch {
        if (mounted.current) setError("Сохранено, но список не обновился.");
      }
      return true;
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Не удалось выполнить действие",
        );
      return false;
    } finally {
      mutating.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function clearInviteQuery() {
    const url = new URL(location.href);
    if (!url.searchParams.has("friend")) return;
    url.searchParams.delete("friend");
    history.replaceState(
      history.state,
      "",
      url.pathname + url.search + url.hash,
    );
  }

  async function copyMyCode() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.me.inviteCode);
      setNotice("Код скопирован");
    } catch {
      setError("Не удалось скопировать код");
    }
  }

  async function shareInvite() {
    if (!data) return;
    const url = new URL(
      import.meta.env.MODE === "device" ? CLOUD_URL : location.origin,
    );
    url.searchParams.set("friend", data.me.inviteCode);
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Тяга · друзья",
          text: `Добавляйся в друзья в Тяге. Код: ${data.me.inviteCode}`,
          url: url.href,
        });
      } else {
        await navigator.clipboard.writeText(url.href);
        setNotice("Ссылка скопирована");
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError("Не удалось поделиться ссылкой");
    }
  }

  const sendFriendRequest = (e: FormEvent) => {
    e.preventDefault();
    const value = FriendsService.inviteCode(code);
    if (!value) {
      setError("Введи 12-значный код или ссылку друга");
      return;
    }
    void perform(
      "/api/friends/requests",
      "POST",
      { code: value },
      "Заявка отправлена",
      () => {
        clearInviteQuery();
        setCode("");
      },
    );
  };

  // Группируем свои программы: если есть цикл Дэвида Лейда — показываем его одной строкой + обычные рутины
  const shareableMine = useMemo(() => {
    const laidCycles = LaidDupPlan.cycles(routines);
    const nonLaid = routines.filter((r) => !LaidDupPlan.periodizationOf(r));
    const items: Array<{ id: string; title: string; meta: string; kind: "laid_dup" | "routine"; routine?: Routine }> = [];
    if (laidCycles.length > 0) {
      items.push({
        id: "__laid_dup__",
        title: "Дэвид Лейд · DUP",
        meta: "9 недель · 6 дней · мой цикл",
        kind: "laid_dup",
      });
    }
    for (const r of nonLaid) {
      items.push({
        id: r.id,
        title: r.name,
        meta: `${r.exercises.length} упр.`,
        kind: "routine",
        routine: r,
      });
    }
    return items;
  }, [routines]);

  function openProgramModal(mode: CreateMode, preselectedFriendId?: string) {
    setProgramModal(mode);
    setCustomTitle("");
    setAdoptImmediately(mode === "template");
    if (preselectedFriendId) {
      setSelectedFriends([preselectedFriendId]);
    } else if (data?.friends.length) {
      setSelectedFriends(data.friends.map((f) => f.id));
    } else {
      setSelectedFriends([]);
    }
    if (mode === "mine" && shareableMine.length > 0) {
      setSelectedRoutineId(shareableMine[0].id);
    }
  }

  async function saveMaterializedProgram(program: Pick<SharedProgram, "title" | "kind" | "payload">) {
    if (!onSaveRoutine) return;
    const est = LaidDupPlan.estimates(workouts, today);
    const maxes = {
      squat: est.squat ?? 100,
      bench: est.bench ?? 80,
      deadlift: est.deadlift ?? 120,
      ohp: est.ohp ?? 55,
    };
    const nextRoutines = SharedProgramBuilder.materialize(program, today, maxes);
    for (const routine of nextRoutines) {
      await onSaveRoutine(routine);
    }
  }

  async function handleCreateSharedProgram(e: FormEvent) {
    e.preventDefault();
    if (!programModal) return;

    let title: string;
    let kind: SharedProgram["kind"] = "template";
    let payload: SharedProgram["payload"] = {};

    if (programModal === "template") {
      const tpl = SHARED_TEMPLATES.find((t) => t.id === templateId)!;
      title = customTitle.trim() || tpl.title;
      kind = tpl.kind;
      payload =
        tpl.id === "laid_dup"
          ? { templateId: "laid_dup", laidRhythm: "6x1", laidExtras: true }
          : { templateId: tpl.id, routines: tpl.routines };
    } else {
      const picked = shareableMine.find((x) => x.id === selectedRoutineId);
      if (!picked) {
        setError("Выбери программу");
        return;
      }
      title = customTitle.trim() || picked.title;
      if (picked.kind === "laid_dup") {
        kind = "laid_dup";
        payload = { templateId: "laid_dup", laidRhythm: "6x1", laidExtras: true };
      } else if (picked.routine) {
        kind = "routine";
        payload = { routines: [SharedProgramBuilder.fromRoutine(picked.routine)] };
      }
    }

    const ok = await perform(
      "/api/friends/programs",
      "POST",
      {
        title,
        kind,
        payload,
        friendIds: selectedFriends,
        ownerAdopted: programModal === "mine" ? true : adoptImmediately,
      },
      programModal === "mine" ? "Программа отправлена" : "Общая программа создана",
      () => {
        setProgramModal(null);
        setTab("programs");
      },
    );

    if (ok && programModal === "template" && adoptImmediately) {
      try {
        await saveMaterializedProgram({ title, kind, payload });
        onToast("Программа добавлена в «Программы»");
      } catch {
        setError("Общая программа создана, но не удалось добавить в локальный план");
      }
    }
  }

  async function handleAdoptProgram(program: SharedProgram) {
    try {
      await saveMaterializedProgram(program);
      await perform(
        `/api/friends/programs/${encodeURIComponent(program.id)}/adopt`,
        "POST",
        {},
        "Программа добавлена в «Программы»",
      );
      onToast("Добавлено в «Программы»");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить программу");
    }
  }

  function startSharedProgram(program: SharedProgram) {
    if (program.kind === "laid_dup" || program.payload.templateId === "laid_dup") {
      const laid = LaidDupPlan.cycles(routines)[0];
      if (laid?.length && onStartRoutine) {
        onStartRoutine(laid[0]);
        return;
      }
    }
    const specName = program.payload.routines?.[0]?.name ?? program.title;
    const match = routines.find(
      (r) => r.name === specName || r.notes?.includes(program.title),
    );
    if (match && onStartRoutine) {
      onStartRoutine(match);
      return;
    }
    onOpenPrograms?.();
  }

  const sharedPrograms = data?.sharedPrograms ?? [];

  return (
    <div className="friends-screen friends-v2">
      <header className="screen-head friends-heading">
        <h1>Друзья</h1>
        <div className="friends-heading-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Обновить"
            disabled={busy || refreshing || !connected}
            onClick={async () => {
              setRefreshing(true);
              try {
                await refresh();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Не удалось обновить",
                );
              } finally {
                setRefreshing(false);
              }
            }}
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div aria-live="polite">
        {notice && (
          <p className="friends-notice">
            <CheckCheck size={17} aria-hidden="true" />
            {notice}
          </p>
        )}
      </div>

      {error && (
        <p className="form-error friends-error" role="alert">
          {error}
        </p>
      )}

      {!connected ? (
        <section className="friends-empty">
          <Users size={30} aria-hidden="true" />
          <h2>Нужно облако</h2>
          <p>Подключи аккаунт в профиле, чтобы добавлять друзей и тренироваться вместе.</p>
          <button type="button" className="button primary" onClick={onProfile}>
            Открыть профиль
          </button>
        </section>
      ) : !data ? (
        <div className="friends-empty" role="status">
          {error ? "Нет связи" : "Загрузка…"}
        </div>
      ) : (
        <>
          <div className="friends-tabs" role="tablist" aria-label="Разделы друзей">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "friends"}
              onClick={() => setTab("friends")}
            >
              <span>Друзья</span>
              <b className="friends-tab-count">{data.friends.length}</b>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "together"}
              onClick={() => setTab("together")}
            >
              <span>Вместе</span>
              {room ? <i className="friends-tab-live-dot" aria-label="Активная комната" /> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "programs"}
              onClick={() => setTab("programs")}
            >
              <span>Программы</span>
              {sharedPrograms.length > 0 ? (
                <b className="friends-tab-count">{sharedPrograms.length}</b>
              ) : null}
            </button>
          </div>

          {data.requests.length > 0 && (
            <section className="friend-requests-v2" aria-label="Заявки в друзья">
              <div className="friends-block-head">
                <h2>Заявки</h2>
                <span className="friends-pill-count">{data.requests.length}</span>
              </div>
              <AnimatePresence initial={false}>
                {data.requests.map((item) => (
                  <m.div
                    key={item.id}
                    className="friend-request-row"
                    initial={reduced ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduced ? 0 : 0.16 }}
                  >
                    <Avatar athlete={item} small />
                    <div className="friend-row-info">
                      <b>{item.displayName}</b>
                      <span>
                        {item.direction === "incoming"
                          ? "Входящая заявка"
                          : "Заявка отправлена"}
                      </span>
                    </div>
                    <div className="friend-row-actions">
                      {item.direction === "incoming" && (
                        <button
                          type="button"
                          className="button primary"
                          disabled={busy}
                          onClick={() =>
                            void perform(
                              `/api/friends/connections/${item.id}`,
                              "PUT",
                              {},
                              "Добавлен в друзья",
                            )
                          }
                        >
                          <Check size={16} aria-hidden="true" />
                          Принять
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`${item.direction === "incoming" ? "Отклонить заявку" : "Отменить заявку"}: ${item.displayName}`}
                        disabled={busy}
                        onClick={() =>
                          void perform(
                            `/api/friends/connections/${item.id}`,
                            "DELETE",
                            {},
                            "Заявка удалена",
                          )
                        }
                      >
                        <X size={17} aria-hidden="true" />
                      </button>
                    </div>
                  </m.div>
                ))}
              </AnimatePresence>
            </section>
          )}

          {tab === "friends" && (
            <div className="friends-tab-body" role="tabpanel" aria-label="Друзья">
              <section className="friends-add-card" aria-label="Добавить друга">
                <form className="friends-add-form" onSubmit={sendFriendRequest}>
                  <label className="sr-only" htmlFor="friend-code-input">
                    Код или ссылка друга
                  </label>
                  <input
                    id="friend-code-input"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Код друга (12 символов) или ссылка"
                    autoCapitalize="characters"
                    autoComplete="off"
                  />
                  <button
                    type="submit"
                    className="button primary"
                    disabled={busy || !code.trim()}
                  >
                    <UserPlus size={16} aria-hidden="true" />
                    Отправить заявку
                  </button>
                </form>
                <div className="friends-my-code-row">
                  <span className="my-code-label">Мой код:</span>
                  <code className="my-code-value">
                    {data.me.inviteCode.match(/.{1,4}/g)?.join("–")}
                  </code>
                  <div className="my-code-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Скопировать мой код"
                      title="Скопировать код"
                      onClick={() => void copyMyCode()}
                    >
                      <Copy size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="button secondary my-code-share"
                      onClick={() => void shareInvite()}
                    >
                      <Share2 size={15} aria-hidden="true" />
                      Поделиться
                    </button>
                  </div>
                </div>
              </section>

              {!data.friends.length ? (
                <div className="friends-empty-clean">
                  <Users size={26} aria-hidden="true" />
                  <p>Пока нет друзей — отправь заявку по коду выше.</p>
                </div>
              ) : (
                <div className="friends-list-v2">
                  {[...data.friends]
                    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"))
                    .map((friend) => (
                      <article key={friend.id} className="friend-row-card">
                        <div className="friend-row-main">
                          <Avatar athlete={friend} />
                          <div className="friend-row-info">
                            <h3>{friend.displayName}</h3>
                            <span>
                              <Dumbbell size={13} aria-hidden="true" />
                              {friend.weekWorkouts} тр. за неделю
                            </span>
                          </div>
                        </div>
                        <div className="friend-card-actions">
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => {
                              setTab("together");
                              if (!room) void createRoom();
                            }}
                          >
                            <Play size={14} aria-hidden="true" />
                            Вместе
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => openProgramModal(shareableMine.length ? "mine" : "template", friend.id)}
                          >
                            <Share2 size={14} aria-hidden="true" />
                            Программа
                          </button>
                          <button
                            type="button"
                            className="icon-button friend-remove-btn"
                            aria-label={`Удалить друга: ${friend.displayName}`}
                            title="Удалить из друзей"
                            disabled={busy}
                            onClick={() => setRemoving(friend)}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    ))}
                </div>
              )}
            </div>
          )}

          {tab === "together" && (
            <div className="friends-tab-body" role="tabpanel" aria-label="Вместе">
              {roomInvite && (
                <RoomInvite
                  code={roomInvite}
                  onDone={onRoomInviteHandled}
                  onToast={onToast}
                />
              )}
              <TogetherCard
                workoutActive={workoutActive}
                onWorkout={onWorkout}
                onToast={onToast}
                quietErrors={!!roomInvite}
              />
            </div>
          )}

          {tab === "programs" && (
            <div className="friends-tab-body" role="tabpanel" aria-label="Общие программы">
              <div className="shared-programs-toolbar">
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={() => openProgramModal("template")}
                >
                  <Plus size={16} aria-hidden="true" />
                  Общая программа
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || !shareableMine.length}
                  onClick={() => openProgramModal("mine")}
                >
                  <Share2 size={15} aria-hidden="true" />
                  Поделиться своей
                </button>
              </div>

              {!sharedPrograms.length ? (
                <div className="friends-empty-clean">
                  <CalendarDays size={26} aria-hidden="true" />
                  <p>Создай общую программу (например, Дэвида Лейда) или поделись своей.</p>
                </div>
              ) : (
                <div className="shared-programs-list">
                  {sharedPrograms.map((program) => (
                    <article key={program.id} className="shared-program-card">
                      <div className="shared-program-head">
                        <div>
                          <div className="shared-program-title-row">
                            <h3>{program.title}</h3>
                            <span className="shared-program-badge">
                              {SharedProgramBuilder.summary(program)}
                            </span>
                          </div>
                          <span className="shared-program-owner">
                            {program.isOwner ? "Создана тобой" : `От ${program.ownerName}`}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="icon-button friend-remove-btn"
                          aria-label={program.isOwner ? `Удалить программу: ${program.title}` : `Выйти из программы: ${program.title}`}
                          title={program.isOwner ? "Удалить" : "Выйти"}
                          disabled={busy}
                          onClick={() =>
                            void perform(
                              `/api/friends/programs/${encodeURIComponent(program.id)}`,
                              "DELETE",
                              {},
                              program.isOwner ? "Программа удалена" : "Ты вышел из программы",
                            )
                          }
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>

                      <div className="shared-program-members">
                        {program.members.map((member) => (
                          <span
                            key={member.accountId}
                            className={`shared-member-pill${member.adopted ? " is-adopted" : ""}`}
                          >
                            {member.adopted ? <Check size={12} aria-hidden="true" /> : null}
                            <b>{member.accountId === data.me.id ? "Ты" : member.displayName}</b>
                            <small>{member.weekWorkouts} тр./нед</small>
                          </span>
                        ))}
                      </div>

                      <div className="shared-program-actions">
                        {!program.adoptedByMe ? (
                          <button
                            type="button"
                            className="button primary"
                            disabled={busy}
                            onClick={() => void handleAdoptProgram(program)}
                          >
                            <Download size={15} aria-hidden="true" />
                            Добавить себе и тренироваться
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="button primary"
                              onClick={() => startSharedProgram(program)}
                            >
                              <Play size={15} aria-hidden="true" />
                              Тренироваться
                            </button>
                            {onOpenPrograms ? (
                              <button
                                type="button"
                                className="button secondary"
                                onClick={onOpenPrograms}
                              >
                                В программы
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {programModal && (
        <Modal
          title={programModal === "mine" ? "Поделиться программой" : "Общая программа"}
          onClose={() => setProgramModal(null)}
        >
          <form className="shared-program-form" onSubmit={(e) => void handleCreateSharedProgram(e)}>
            <div className="shared-mode-switch" role="group" aria-label="Источник программы">
              <button
                type="button"
                aria-pressed={programModal === "template"}
                onClick={() => setProgramModal("template")}
              >
                Готовый шаблон
              </button>
              <button
                type="button"
                aria-pressed={programModal === "mine"}
                disabled={!shareableMine.length}
                onClick={() => {
                  setProgramModal("mine");
                  if (!selectedRoutineId && shareableMine[0]) {
                    setSelectedRoutineId(shareableMine[0].id);
                  }
                }}
              >
                Моя программа
              </button>
            </div>

            {programModal === "template" ? (
              <div className="template-picker-grid">
                {SHARED_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className={`template-pick-card${templateId === tpl.id ? " is-selected" : ""}`}
                    aria-pressed={templateId === tpl.id}
                    onClick={() => setTemplateId(tpl.id)}
                  >
                    <b>{tpl.title}</b>
                    <span>{tpl.meta}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="template-picker-grid">
                {shareableMine.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`template-pick-card${selectedRoutineId === item.id ? " is-selected" : ""}`}
                    aria-pressed={selectedRoutineId === item.id}
                    onClick={() => setSelectedRoutineId(item.id)}
                  >
                    <b>{item.title}</b>
                    <span>{item.meta}</span>
                  </button>
                ))}
              </div>
            )}

            <label className="shared-field">
              <span>Название (необязательно)</span>
              <input
                value={customTitle}
                maxLength={80}
                placeholder={
                  programModal === "template"
                    ? SHARED_TEMPLATES.find((t) => t.id === templateId)?.title
                    : shareableMine.find((x) => x.id === selectedRoutineId)?.title
                }
                onChange={(e) => setCustomTitle(e.target.value)}
              />
            </label>

            {data && data.friends.length > 0 && (
              <div className="shared-friends-picker">
                <span className="shared-field-label">С кем тренироваться</span>
                <div className="shared-friends-chips">
                  {data.friends.map((friend) => {
                    const active = selectedFriends.includes(friend.id);
                    return (
                      <button
                        key={friend.id}
                        type="button"
                        className={`shared-friend-chip${active ? " is-selected" : ""}`}
                        aria-pressed={active}
                        onClick={() =>
                          setSelectedFriends((prev) =>
                            active
                              ? prev.filter((id) => id !== friend.id)
                              : [...prev, friend.id],
                          )
                        }
                      >
                        {active ? <Check size={14} aria-hidden="true" /> : null}
                        <span>{friend.displayName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {programModal === "template" && (
              <label className="shared-checkbox">
                <input
                  type="checkbox"
                  checked={adoptImmediately}
                  onChange={(e) => setAdoptImmediately(e.target.checked)}
                />
                <span>Сразу добавить себе в «Программы»</span>
              </label>
            )}

            <button
              type="submit"
              className="button primary full-width"
              disabled={busy || (programModal === "mine" && !selectedRoutineId)}
            >
              {programModal === "mine" ? "Отправить друзьям" : "Создать общую программу"}
            </button>
          </form>
        </Modal>
      )}

      {removing && (
        <Modal title="Удалить из друзей?" onClose={() => setRemoving(null)}>
          <div className="friend-modal">
            <p>{removing.displayName} будет удалён из списка друзей.</p>
            <div className="friend-modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setRemoving(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void perform(
                    `/api/friends/connections/${removing.id}`,
                    "DELETE",
                    {},
                    "Удалён из друзей",
                    () => setRemoving(null),
                  )
                }
              >
                Удалить
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
