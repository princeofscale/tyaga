import { useEffect, useState } from "react";
import { AnimatePresence, LayoutGroup, m } from "motion/react";
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  Dumbbell,
  History,
  House,
  Pill,
  Settings2,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import type { AccountProfile } from "../../lib/account";
import { elapsedMs, type Draft } from "../../lib/draft";
import { BackdatedWorkout } from "../../domain/BackdatedWorkout";

export type ProductView =
  | "overview"
  | "workout"
  | "history"
  | "library"
  | "progress"
  | "programs"
  | "friends"
  | "supplements";

const NAV = [
  { id: "overview", label: "Сегодня", icon: House },
  { id: "history", label: "История", icon: History },
  { id: "progress", label: "Прогресс", icon: BarChart3 },
  { id: "programs", label: "Программы", icon: CalendarDays },
  { id: "library", label: "Упражнения", icon: Dumbbell },
  { id: "friends", label: "Друзья", icon: Users },
] as const;

function ResumePillClock({ draft, timeZone }: { draft: Draft; timeZone?: string }) {
  const [now, setNow] = useState(() => Date.now());
  const manual = BackdatedWorkout.manualDuration(draft, timeZone);
  const running = !manual && draft.clock.runningSince !== null;
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [running]);
  if (manual) return <b>{draft.workout.duration} мин</b>;
  const totalSec = Math.floor(elapsedMs(draft, now) / 1000);
  const h = Math.floor(totalSec / 3600);
  const mVal = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return (
    <b>
      {h > 0
        ? `${h}:${String(mVal).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${String(mVal).padStart(2, "0")}:${String(s).padStart(2, "0")}`}
    </b>
  );
}

export function AppSidebar({
  view,
  reduceMotion,
  onNavigate,
  onOpenTools,
}: {
  view: ProductView;
  reduceMotion: boolean | null;
  onNavigate: (v: ProductView) => void;
  onOpenTools: () => void;
}) {
  return (
    <m.aside className="sidebar" layoutRoot layoutScroll>
      <a
        className="brand"
        href="#"
        onClick={(event) => {
          event.preventDefault();
          onNavigate("overview");
        }}
      >
        <span className="brand-mark">
          <Dumbbell size={20} aria-hidden="true" />
        </span>
        <span className="brand-type">Тяга</span>
      </a>
      <LayoutGroup id="journal-nav">
        <m.nav aria-label="Основная навигация" layoutScroll>
          {NAV.map((item) => (
            <button
              type="button"
              className={`nav-item ${view === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              {view === item.id && (
                <m.span
                  className="journal-tab-marker"
                  aria-hidden="true"
                  layoutId={reduceMotion ? undefined : "active-tab"}
                  initial={false}
                  transition={{
                    layout: { type: "spring", stiffness: 460, damping: 40, mass: 0.78 },
                  }}
                />
              )}
              <item.icon size={20} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
        </m.nav>
      </LayoutGroup>
      <div className="sidebar-bottom">
        <button
          type="button"
          className={`nav-item ${view === "supplements" ? "active" : ""}`}
          aria-current={view === "supplements" ? "page" : undefined}
          onClick={() => onNavigate("supplements")}
        >
          <Pill size={20} aria-hidden="true" />
          <span>Добавки</span>
        </button>
        <button type="button" className="nav-item" onClick={onOpenTools}>
          <Settings2 size={20} aria-hidden="true" />
          <span>Ещё</span>
        </button>
      </div>
    </m.aside>
  );
}

export function AppTopbar({
  account,
  view,
  onNavigate,
  onOpenTools,
  onOpenProfile,
}: {
  account: AccountProfile;
  view: ProductView;
  onNavigate: (v: ProductView) => void;
  onOpenTools: () => void;
  onOpenProfile: () => void;
}) {
  const avatar = account.displayName.slice(0, 1).toUpperCase();
  return (
    <header className="journal-topbar">
      <div className="journal-topbar-inner">
        <a
          className="brand mobile-brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            onNavigate("overview");
          }}
        >
          <span className="brand-mark">
            <Dumbbell size={20} aria-hidden="true" />
          </span>
          <span className="brand-type">Тяга</span>
        </a>
        <div className="journal-topbar-actions">
          <button
            type="button"
            className={`button secondary journal-supplements${view === "supplements" ? " active" : ""}`}
            aria-label="Добавки"
            onClick={() => onNavigate("supplements")}
          >
            <Pill size={15} aria-hidden="true" />
            <span>Добавки</span>
          </button>
          <button
            type="button"
            className="button secondary journal-more"
            aria-haspopup="dialog"
            onClick={onOpenTools}
          >
            Ещё
          </button>
          <button
            type="button"
            className="profile-button journal-profile"
            aria-label="Мой профиль"
            onClick={onOpenProfile}
          >
            <span className="profile-avatar" aria-hidden="true">
              {avatar}
            </span>
            <span className="journal-profile-name" aria-hidden="true">
              {account.displayName}
            </span>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}

export function AppOverlays({
  draft,
  view,
  timeZone,
  notice,
  onResume,
  onDismissToast,
}: {
  draft: Draft | null;
  view: ProductView;
  timeZone?: string;
  notice: { text: string; tone: "ok" | "warn" };
  onResume: () => void;
  onDismissToast: () => void;
}) {
  return (
    <>
      <AnimatePresence>
        {draft && view !== "workout" && view !== "overview" ? (
          <m.button
            key="resume"
            className="resume-pill"
            style={{ x: "-50%" }}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24, transition: { duration: 0.18 } }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            onClick={onResume}
          >
            <span className="resume-dot" aria-hidden="true" />
            Вернуться к тренировке
            <ResumePillClock draft={draft} timeZone={timeZone} />
          </m.button>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {notice.text ? (
          <m.div
            key="toast"
            className={`toast ${notice.tone === "warn" ? "toast-warn" : ""}`}
            role="status"
            style={{ x: "-50%" }}
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.16 } }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
          >
            {notice.tone === "warn" ? <TriangleAlert size={17} /> : <Check size={17} />}
            <span>{notice.text}</span>
            <button
              className="icon-button"
              aria-label="Скрыть уведомление"
              onClick={onDismissToast}
            >
              <X size={16} />
            </button>
          </m.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
