import { RoomLink } from "../domain/LiveSession";

let pending: string | null = null;

/**
 * Ссылка в комнату (`?r=КОД`) читается один раз при загрузке: человек мог прийти по ней ещё
 * разлогиненным, а после входа в аккаунт приложение открывается заново. Код убираем из адреса сразу,
 * чтобы перезагрузка страницы не предлагала войти снова. Адрес трогаем, только если ссылку поняли;
 * приглашение дружить (`?friend=`) живёт отдельно и здесь не затрагивается.
 */
function capture() {
  if (typeof window === "undefined") return;
  const { search, pathname, hash } = window.location;
  const code = RoomLink.parse(search);
  if (!code) return;
  pending = code;
  window.history.replaceState(window.history.state, "", pathname + RoomLink.strip(search) + hash);
}
capture();

/** Код комнаты из ссылки. Отдаётся ровно один раз. */
export function takeRoomInvite(): string | null {
  const code = pending;
  pending = null;
  return code;
}
