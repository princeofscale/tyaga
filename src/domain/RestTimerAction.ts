import type { Draft } from "../lib/draft";
import type { RestAction } from "../services/RestTimerService";
export class RestTimerAction {
  static apply(
    draft: Draft | null,
    accountId: string,
    action: RestAction,
  ): Draft | null {
    if (
      !draft ||
      action.accountId !== accountId ||
      action.workoutId !== draft.workout.id ||
      draft.pausedRest !== null ||
      !Number.isFinite(action.until)
    )
      return draft;
    return {
      ...draft,
      restUntil: action.until,
      pausedRest: null,
      restFocus:
        action.exerciseId && action.setId
          ? { exerciseId: action.exerciseId, setId: action.setId }
          : draft.restFocus,
    };
  }
}
