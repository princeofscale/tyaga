import { draftRecord, matchesDraft, matchesDraftRecord, parseDraft, type Draft, type DraftRecord } from "./draft";

/** Один общий черновик на аккаунт. Только владелец записи может менять его или закрывать. */
export type TabRole = "owner" | "follower";
export type TabAction =
  | { kind: "none" }
  | { kind: "adopt"; draft: Draft; note: "other" | null }
  | { kind: "close"; id: string };

export type TabContext = {
  mine: Draft | null;
  /** Последняя запись, которую эта вкладка прочитала или успешно сохранила. */
  observed: DraftRecord | null;
  tab: string;
};

export class DraftTabs {
  static readonly CLOSED_NOTE = "Тренировка закончена или отменена в другом окне";
  static readonly OTHER_NOTE = "В другом окне уже идёт тренировка — открыта она";
  static readonly FOLLOWER_NOTE = "Эта тренировка открыта в другом окне — тут изменения не сохраняются";

  static stamp(draft: Draft, tab: string, claim: number): Draft {
    return { ...draft, owner: tab, claim };
  }

  static nextClaim(stored: Draft | null, now = Date.now()): number {
    return Math.max(now, (stored?.claim ?? 0) + 1);
  }

  static sameDraft(a: Draft, b: Draft): boolean {
    return matchesDraft(a, draftRecord(b));
  }

  private static owns(ctx: TabContext, stored: Draft): boolean {
    return ctx.observed !== null && stored.owner === ctx.tab && matchesDraftRecord(stored, ctx.observed);
  }

  /** Смотрим актуальный ключ; старое значение берём только из события удаления. */
  static onKey(ctx: TabContext, raw: string | null, removedRaw?: string | null): TabAction {
    if (raw === null) {
      const removed = removedRaw === undefined ? ctx.observed : parseDraft(removedRaw);
      const record = removed && ("workout" in removed ? draftRecord(removed) : removed);
      return ctx.mine && record && matchesDraft(ctx.mine, record)
        ? { kind: "close", id: record.id }
        : { kind: "none" };
    }
    const stored = parseDraft(raw, "handoff");
    if (!stored) return { kind: "none" };
    if (!ctx.mine) return { kind: "adopt", draft: stored, note: null };
    const same = DraftTabs.sameDraft(stored, ctx.mine);
    if (DraftTabs.owns(ctx, stored) || (same && !stored.owner && ctx.observed?.owner === undefined)) return { kind: "none" };
    return { kind: "adopt", draft: stored, note: same ? null : "other" };
  }

  /** Сверка перед действием ничего не пишет и не передаёт управление. */
  static beforeEdit(ctx: TabContext & { mine: Draft }, raw: string | null): TabAction {
    return DraftTabs.onKey(ctx, raw);
  }

  static beforeWrite(ctx: TabContext & { mine: Draft }, raw: string | null): "write" | TabAction {
    if (raw === null) {
      if (!ctx.observed) return "write";
      return { kind: "close", id: ctx.mine.workout.id };
    }
    const stored = parseDraft(raw, "handoff");
    if (!stored) return "write";
    // Конфликт сохранения может заменить старый черновик этой вкладки новым (в т.ч. с тем же id).
    if (DraftTabs.owns(ctx, stored)) return "write";
    const same = DraftTabs.sameDraft(stored, ctx.mine);
    if (same && !stored.owner && ctx.observed?.owner === undefined) return "write";
    return { kind: "adopt", draft: stored, note: same ? null : "other" };
  }

  static initialRole(stored: Draft | null, tab: string, otherAlive: boolean): TabRole {
    if (!stored || stored.owner === undefined || stored.owner === tab) return "owner";
    return otherAlive ? "follower" : "owner";
  }
}
