import { parseDraft, storedDraftId, type Draft } from "./draft";

/**
 * R11-REQ02: одна идущая тренировка на аккаунт в браузере, несколько вкладок (окон) видят её общее состояние.
 *
 * Черновик лежит в одном ключе localStorage; запись несёт `owner` (вкладка, которая пишет) и `claim` (момент, когда она стала основной).
 * Основной становится вкладка, где человек начал тренировку или нажал/печатает; остальные «ведомые»: показывают то, что пишет основная,
 * свой черновик в ключ не пишут и говорят об этом. Из чистой логики — решения «что делать с этим событием» и «можно ли писать».
 * Всё общее состояние — этот ключ; новых ключей нет (выход из аккаунта стирает его вместе с остальными `tyaga-draft-account:`).
 */
export type TabRole = "owner" | "follower";

/** Что вкладке делать с тем, что она увидела в общем ключе. */
export type TabAction =
  | { kind: "none" }
  /** Принять чужой черновик целиком и стать ведомой. `note` — что сказать человеку (или ничего). */
  | { kind: "adopt"; draft: Draft; note: "other" | null }
  /** Тренировку закончили или отменили в другом окне: убрать свой черновик, не записывать его обратно. */
  | { kind: "close"; id: string }
  /** Основная вкладка получила чужую устаревшую запись: переписать своё состояние. */
  | { kind: "reassert" };

export type TabContext = {
  /** Черновик этой вкладки в памяти. */
  mine: Draft | null;
  /** Тренировка, которую эта вкладка успешно записала в общий ключ последней (убирать из ключа и считать «закрытой» можно только её). */
  ownId: string | null;
  tab: string;
  /** Момент, когда эта вкладка стала основной (0 — не становилась). */
  claim: number;
};

export class DraftTabs {
  static readonly CLOSED_NOTE = "Тренировка закончена или отменена в другом окне";
  static readonly OTHER_NOTE = "В другом окне уже идёт тренировка — открыта она";
  static readonly FOLLOWER_NOTE = "Эта тренировка открыта в другом окне — тут изменения не сохраняются";

  /** Запись для ключа: черновик с пометкой «пишет эта вкладка». */
  static stamp(draft: Draft, tab: string, claim: number): Draft {
    return { ...draft, owner: tab, claim };
  }

  /** Новый момент «стала основной»: строго позже того, что уже записано в ключе. */
  static nextClaim(stored: Draft | null, now = Date.now()): number {
    return Math.max(now, (stored?.claim ?? 0) + 1);
  }

  /**
   * Событие `storage` или чтение ключа при возвращении на вкладку.
   * `raw` — что в ключе сейчас; `oldRaw` — что было до изменения (только у события): по нему видно, чей черновик убрали.
   * Без `oldRaw` (чтение при возвращении) пропажу ключа считаем закрытием, только если эту тренировку записывала сама вкладка.
   */
  static onKey(ctx: TabContext, raw: string | null, oldRaw?: string | null): TabAction {
    const stored = parseDraft(raw);
    if (raw === null) {
      if (!ctx.mine) return { kind: "none" };
      if (oldRaw !== undefined) return storedDraftId(oldRaw) === ctx.mine.workout.id ? { kind: "close", id: ctx.mine.workout.id } : { kind: "none" };
      return ctx.ownId === ctx.mine.workout.id ? { kind: "close", id: ctx.mine.workout.id } : { kind: "none" };
    }
    if (!stored) return { kind: "none" };
    if (!ctx.mine) return { kind: "adopt", draft: stored, note: null };
    if (stored.workout.id !== ctx.mine.workout.id) return { kind: "adopt", draft: stored, note: "other" };
    if (stored.owner === undefined || stored.owner === ctx.tab) return { kind: "none" };
    // Тот же черновик пишет другая вкладка. Если она стала основной позже нас — идём за ней, иначе наша запись новее: подтверждаем её.
    return (stored.claim ?? 0) >= ctx.claim ? { kind: "adopt", draft: stored, note: null } : { kind: "reassert" };
  }

  /** Перед записью своего черновика: «write» — писать, иначе действие вместо записи (чужая запись новее, тренировку уже закрыли). */
  static beforeWrite(ctx: TabContext & { mine: Draft }, raw: string | null): "write" | TabAction {
    if (raw === null) return ctx.ownId === ctx.mine.workout.id ? { kind: "close", id: ctx.mine.workout.id } : "write";
    const stored = parseDraft(raw);
    if (!stored) return "write";
    // В ключе прежняя тренировка этой же вкладки, а в памяти уже другая (например, «Сохранить мою отдельной тренировкой»): это не чужая запись.
    if (stored.workout.id !== ctx.mine.workout.id) {
      if (stored.owner === ctx.tab) return "write";
      return ctx.ownId === ctx.mine.workout.id || stored.owner !== undefined ? { kind: "adopt", draft: stored, note: "other" } : "write";
    }
    if (stored.owner === undefined || stored.owner === ctx.tab || ctx.claim > (stored.claim ?? 0)) return "write";
    return { kind: "adopt", draft: stored, note: null };
  }

  /** Роль вкладки, загрузившейся с готовым черновиком: основная, если он её, не чей-то, или если других живых окон нет. */
  static initialRole(stored: Draft | null, tab: string, otherAlive: boolean): TabRole {
    if (!stored || stored.owner === undefined || stored.owner === tab) return "owner";
    return otherAlive ? "follower" : "owner";
  }
}
