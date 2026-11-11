import { InviteLink } from "../domain/LiveSession";

/** Ссылка-приглашение: подписаться на атлета (`?p=тег`) или войти в комнату (`?r=КОД`). */
export type Invite = { tag?: string; room?: string };

let pending: Invite | null = null;

/**
 * Читаем приглашение один раз при загрузке: после входа в аккаунт адресную строку очищают,
 * а человек мог прийти по ссылке ещё разлогиненным. Параметры убираем сразу, чтобы
 * перезагрузка страницы не повторяла вход.
 */
function capture() {
  if (typeof window === "undefined") return;
  const { search, pathname, hash } = window.location;
  const tag = InviteLink.parse(search);
  const room = InviteLink.parseRoom(search);
  if (tag || room) pending = { ...(tag ? { tag } : {}), ...(room ? { room } : {}) };
  const clean = InviteLink.strip(search);
  if (clean !== search) window.history.replaceState(window.history.state, "", pathname + clean + hash);
}
capture();

/** Отдаёт приглашение ровно один раз. */
export function takeInvite(): Invite | null {
  const invite = pending;
  pending = null;
  return invite;
}
