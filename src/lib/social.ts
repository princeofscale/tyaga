/** Типы раздела «Напарники»: одни и те же для сервера и интерфейса. */
export type AthleteProfile = { tag: string; bio: string; isPublic: boolean };

export type FeedWorkout = {
  id: string;
  date: string;
  title: string;
  sets: number;
  tonnageKg: number;
  duration: number;
  muscles: string[];
  kudos: number;
  kudosByMe: boolean;
  athlete: { tag: string; displayName: string };
};

export type FollowedAthlete = {
  tag: string;
  displayName: string;
  bio: string;
  lastDate: string | null;
  workoutsLast7Days: number;
  /** Он следит за мной в ответ. */
  mutual: boolean;
};

/** Следит за мной, а я за ним — пока нет. */
export type IncomingAthlete = { tag: string; displayName: string; bio: string };

export type SocialOverview = {
  profile: AthleteProfile | null;
  followers: number;
  following: FollowedAthlete[];
  incoming: IncomingAthlete[];
  /** Таблица недели: я и мои напарники по рабочему тоннажу. */
  standings: StandingRow[];
  feed: FeedWorkout[];
};

/** Что человек делает прямо сейчас, пока тренируется вместе с другими. */
export type LivePhase = "idle" | "lifting" | "resting" | "done";

/** Снимок для комнаты «Вместе»: без заметок, истории и чужих упражнений. */
export type LiveState = {
  phase: LivePhase;
  exercise: string | null;
  setsDone: number;
  setsTotal: number;
  tonnageKg: number;
  lastSet: { kg: number; reps: number } | null;
  /** ISO-время конца отдыха; null, если отдыха нет. */
  restEndsAt: string | null;
};

/** Итоги атлета за последние семь дней — вход для таблицы недели. */
export type WeeklyScore = {
  tag: string;
  displayName: string;
  isMe: boolean;
  sessions: number;
  sets: number;
  tonnageKg: number;
};

export type StandingRow = WeeklyScore & {
  rank: number;
  /** Доля тоннажа от лидера, 0…1. */
  share: number;
  leader: boolean;
};

export type LiveMember = {
  /** Номер строки в комнате: список остаётся стабильным, а учётная запись не раскрывается. */
  id: number;
  displayName: string;
  /** Публичный тег — только пока профиль открыт. */
  tag: string | null;
  isMe: boolean;
  state: LiveState | null;
  /** Когда человек вошёл или последний раз выложил состояние. */
  updatedAt: string;
};

export type LiveRoom = { code: string; members: LiveMember[] };

export const MAX_ROOM_MEMBERS = 6;
/** Сколько часов тишины терпит комната, прежде чем участник из неё выпадает. */
export const ROOM_IDLE_HOURS = 12;
export const MAX_FOLLOWING = 50;
export const TAG_PATTERN = /^[a-z0-9_]{3,20}$/;

/** «@Ivan_Power » → «ivan_power»; пустая строка остаётся пустой. */
export const normalizeTag = (value: string) => value.trim().replace(/^@+/, "").toLowerCase();
