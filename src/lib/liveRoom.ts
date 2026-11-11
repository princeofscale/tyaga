/** Типы комнат «Вместе»: одни и те же для сервера и интерфейса. */

/** Что человек делает прямо сейчас, пока тренируется вместе с другими. */
export type LivePhase = "idle" | "lifting" | "resting" | "done";

/** Снимок для комнаты: без заметок, истории и чужих упражнений. */
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

export type LiveMember = {
  /** Номер строки в комнате: список остаётся стабильным, а учётная запись не раскрывается. */
  id: number;
  displayName: string;
  isMe: boolean;
  state: LiveState | null;
  /** Когда человек вошёл или последний раз выложил состояние. */
  updatedAt: string;
};

export type LiveRoom = { code: string; members: LiveMember[] };

export const MAX_ROOM_MEMBERS = 6;
/** Самое длинное название упражнения, которое принимает комната; снимок тренировки обрезает длиннее. */
export const LIVE_EXERCISE_MAX = 80;
/** Сколько часов тишины терпит комната, прежде чем участник из неё выпадает. */
export const ROOM_IDLE_HOURS = 12;
