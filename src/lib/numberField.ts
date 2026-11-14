import type { FocusEvent, MouseEvent } from "react";

/** Поля, которые только что получили фокус от касания: отпускание пальца не должно снимать выделение. */
const justFocused = new WeakSet<HTMLInputElement>();

/**
 * Касание числового поля выделяет всё содержимое: набранное заменяет значение,
 * а не дописывается к нему («0» + «100» не даёт «0100»).
 */
export const selectOnFocus = {
  onFocus(event: FocusEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    justFocused.add(input);
    input.select();
  },
  // Safari и Chromium иначе ставят курсор при отпускании мыши и сбрасывают выделение.
  onMouseUp(event: MouseEvent<HTMLInputElement>) {
    if (justFocused.delete(event.currentTarget)) event.preventDefault();
  },
  onBlur(event: FocusEvent<HTMLInputElement>) {
    justFocused.delete(event.currentTarget);
  },
};

/** Убирает ведущие нули, оставшиеся после правки посреди числа: «0100» → «100», «0.5» не трогает. */
export function trimLeadingZeros(input: HTMLInputElement): string {
  if (/^0\d/.test(input.value)) input.value = input.value.replace(/^0+(?=\d)/, "");
  return input.value;
}
