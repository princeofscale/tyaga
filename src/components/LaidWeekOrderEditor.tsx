import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowDown, ArrowUp, GripVertical, Moon, RotateCcw } from "lucide-react";
import { LaidDupPlan, type LaidDay, type LaidVersion, type LaidWeekSlot } from "../domain/LaidDupPlan";
import { DAY_NAMES } from "../domain/TrainingProgram";
import type { Routine } from "../lib/types";

type Props = {
  slots: LaidWeekSlot[];
  onChange: (next: LaidWeekSlot[]) => void;
  summaries?: Partial<Record<LaidDay, string>>;
  counts?: Partial<Record<LaidDay, string>>;
  showPresets?: boolean;
  initialSlots?: LaidWeekSlot[];
  otherRoutines?: readonly Routine[];
  version?: LaidVersion;
  disabled?: boolean;
};

type DragState = {
  pointerId: number;
  fromIndex: number;
  dropIndex: number;
  startY: number;
  lastY: number;
  itemEl: HTMLLIElement;
  handleEl: HTMLButtonElement;
  scrollEl: HTMLElement | null;
  startScrollTop: number;
  rafId: number;
  lastFrame: number;
  itemHeight: number;
};

const slotKeyAt = (slots: readonly LaidWeekSlot[], index: number) => {
  const slot = slots[index];
  if (slot !== null) return slot;
  let restIdx = 0;
  for (let i = 0; i < index; i++) {
    if (slots[i] === null) restIdx++;
  }
  return `rest-${restIdx}`;
};
const slotName = (slot: LaidWeekSlot, version?: LaidVersion) =>
  slot ? LaidDupPlan.dayShort(slot, version) : "День отдыха";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2) return node;
    node = node.parentElement;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

/**
 * Интерактивный редактор раскладки 7 дней недели (Пн–Вс) для цикла Дэвида Лейда:
 * перетаскивание за ручку (pointer events + layout midpoints + drop marker + FLIP),
 * клавиатурный режим (Space/Enter + ↑/↓ + Esc) и кнопки ↑/↓ для быстрого сдвига на телефоне.
 */
export default function LaidWeekOrderEditor({
  slots,
  onChange,
  summaries,
  counts,
  showPresets = true,
  initialSlots,
  otherRoutines,
  version,
  disabled = false,
}: Props) {
  const listId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const dragRef = useRef<DragState | null>(null);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [grabbedKey, setGrabbedKey] = useState<string | null>(null);
  const preGrabSlotsRef = useRef<LaidWeekSlot[] | null>(null);
  const movingFocusRef = useRef(false);
  const announceTimerRef = useRef<number | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");

  const trainingDaysCount = useMemo(() => slots.filter((s) => s !== null).length, [slots]);
  const activePreset = useMemo(() => LaidDupPlan.matchingRhythm(slots), [slots]);
  const isV3Default = useMemo(() => {
    if (trainingDaysCount !== 5) return false;
    const def = LaidDupPlan.slotsForV3();
    return def.every((s, i) => s === slots[i]);
  }, [slots, trainingDaysCount]);
  const recoveryNotes = useMemo(() => LaidDupPlan.backToBackNotice(slots, DAY_NAMES), [slots]);
  const overlapNotes = useMemo(() => {
    if (!otherRoutines?.length) return [] as string[];
    const out: string[] = [];
    slots.forEach((slot, weekday) => {
      if (!slot) return;
      const names = otherRoutines.filter((r) => r.days.includes(weekday)).map((r) => `«${r.name}»`);
      if (names.length) out.push(`${DAY_NAMES[weekday]} (${LaidDupPlan.dayShort(slot, version)}) совпадает с ${names.join(", ")}.`);
    });
    return out;
  }, [otherRoutines, slots, version]);
  const isDirty = useMemo(
    () => !!initialSlots && initialSlots.some((s, i) => s !== slots[i]),
    [initialSlots, slots],
  );

  const announce = useCallback((message: string, delay = 120) => {
    window.clearTimeout(announceTimerRef.current);
    setAnnouncement("");
    announceTimerRef.current = window.setTimeout(() => {
      setAnnouncement(message);
    }, delay);
  }, []);

  useEffect(() => () => window.clearTimeout(announceTimerRef.current), []);

  const clearDropMarker = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    list.removeAttribute("data-drop");
    list.style.removeProperty("--drop-x");
    list.style.removeProperty("--drop-y");
    list.style.removeProperty("--drop-w");
    list.style.removeProperty("--drop-h");
  }, []);

  /** FLIP-анимация всех сместившихся элементов списка (уважает prefers-reduced-motion). */
  const applyOrderWithFlip = useCallback(
    (next: LaidWeekSlot[], releasedKey?: string, releasedRect?: DOMRect) => {
      const reduced = prefersReducedMotion();
      const before = new Map<string, DOMRect>();
      if (!reduced) {
        for (const [key, el] of itemRefs.current) {
          el.getAnimations().forEach((anim) => anim.finish());
          before.set(key, key === releasedKey && releasedRect ? releasedRect : el.getBoundingClientRect());
        }
      }
      flushSync(() => {
        onChange(next);
      });
      if (reduced) return;
      for (const [key, el] of itemRefs.current) {
        const prev = before.get(key);
        if (!prev) continue;
        const after = el.getBoundingClientRect();
        const dx = prev.left - after.left;
        const dy = prev.top - after.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        el.animate(
          [{ translate: `${dx}px ${dy}px` }, { translate: "0px 0px" }],
          { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      }
    },
    [onChange],
  );

  /** Плавный переход пресетов через document.startViewTransition с мгновенным фоллбэком. */
  const applyPreset = useCallback(
    (next: LaidWeekSlot[], label: string) => {
      if (disabled) return;
      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => { finished: Promise<void> };
      };
      if (!prefersReducedMotion() && typeof doc.startViewTransition === "function") {
        document.documentElement.classList.add("laid-vt-active");
        const vt = doc.startViewTransition(() => {
          flushSync(() => {
            onChange(next);
          });
        });
        vt.finished.finally(() => {
          document.documentElement.classList.remove("laid-vt-active");
        });
      } else {
        onChange(next);
      }
      announce(label, 80);
    },
    [announce, disabled, onChange],
  );

  const updateDropSpot = useCallback((state: DragState) => {
    const list = listRef.current;
    if (!list) return;
    const listRect = list.getBoundingClientRect();
    const clampedY = Math.max(listRect.top, Math.min(listRect.bottom, state.lastY));
    const pointerInList = clampedY - listRect.top - list.clientTop + list.scrollTop;

    const children = Array.from(list.children) as HTMLLIElement[];
    let rawSpot = children.length;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const midpoint = child.offsetTop + child.offsetHeight / 2;
      if (pointerInList < midpoint) {
        rawSpot = i;
        break;
      }
    }

    // Пропускаем no-op позиции (собственный слот перетаскиваемого элемента).
    if (rawSpot === state.fromIndex || rawSpot === state.fromIndex + 1) {
      state.dropIndex = state.fromIndex;
      clearDropMarker();
      return;
    }

    state.dropIndex = rawSpot > state.fromIndex ? rawSpot - 1 : rawSpot;

    const prevEl = children[rawSpot - 1];
    const nextEl = children[rawSpot];
    const markerY =
      prevEl && nextEl
        ? (prevEl.getBoundingClientRect().bottom + nextEl.getBoundingClientRect().top) / 2
        : nextEl
          ? nextEl.getBoundingClientRect().top - 3
          : prevEl
            ? prevEl.getBoundingClientRect().bottom + 3
            : listRect.top;

    list.setAttribute("data-drop", "active");
    list.style.setProperty("--drop-x", `${listRect.left}px`);
    list.style.setProperty("--drop-y", `${markerY}px`);
    list.style.setProperty("--drop-w", `${listRect.width}px`);
    list.style.setProperty("--drop-h", "2px");
  }, [clearDropMarker]);

  const finishDrag = useCallback(
    (commit: boolean) => {
      const state = dragRef.current;
      if (!state) return;
      dragRef.current = null;
      window.cancelAnimationFrame(state.rafId);
      document.documentElement.classList.remove("laid-dragging");
      clearDropMarker();

      const releasedRect = state.itemEl.getBoundingClientRect();
      state.itemEl.style.removeProperty("translate");
      setDraggingKey(null);

      try {
        if (state.handleEl.hasPointerCapture(state.pointerId)) {
          state.handleEl.releasePointerCapture(state.pointerId);
        }
      } catch {
        // Ignore if capture was already released.
      }

      const currentSlots = slotsRef.current;
      const movedSlot = currentSlots[state.fromIndex];
      const key = slotKeyAt(currentSlots, state.fromIndex);

      if (commit && state.dropIndex !== state.fromIndex) {
        const next = LaidDupPlan.moveSlot(currentSlots, state.fromIndex, state.dropIndex);
        const nextKey = slotKeyAt(next, state.dropIndex);
        applyOrderWithFlip(next, key, releasedRect);
        const movedEl = itemRefs.current.get(nextKey);
        movedEl?.scrollIntoView({ block: "nearest", inline: "nearest" });
        announce(`${slotName(movedSlot, version)} — теперь ${DAY_NAMES[state.dropIndex]}`);
      } else if (!prefersReducedMotion()) {
        // Плавный возврат на место при отмене или drop без сдвига.
        const finalRect = state.itemEl.getBoundingClientRect();
        const dy = releasedRect.top - finalRect.top;
        if (Math.abs(dy) > 1) {
          state.itemEl.animate(
            [{ translate: `0px ${dy}px` }, { translate: "0px 0px" }],
            { duration: 190, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          );
        }
        if (!commit) announce("Перемещение отменено");
      } else if (!commit) {
        announce("Перемещение отменено");
      }
    },
    [announce, applyOrderWithFlip, clearDropMarker, version],
  );

  // Глобальные слушатели pointer / Escape на время перетаскивания (не дают закрыть <dialog> по Esc).
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const state = dragRef.current;
      if (!state || e.pointerId !== state.pointerId) return;
      state.lastY = e.clientY;
      const scrollDelta = state.scrollEl ? state.scrollEl.scrollTop - state.startScrollTop : 0;
      state.itemEl.style.translate = `0px ${e.clientY - state.startY + scrollDelta}px`;
      updateDropSpot(state);
    };
    const onPointerUp = (e: PointerEvent) => {
      const state = dragRef.current;
      if (!state || e.pointerId !== state.pointerId) return;
      finishDrag(true);
    };
    const onPointerCancel = (e: PointerEvent) => {
      const state = dragRef.current;
      if (!state || e.pointerId !== state.pointerId) return;
      finishDrag(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dragRef.current) {
        e.preventDefault();
        e.stopPropagation();
        finishDrag(false);
        return;
      }
      if (grabbedKey !== null) {
        e.preventDefault();
        e.stopPropagation();
        const prev = preGrabSlotsRef.current;
        preGrabSlotsRef.current = null;
        setGrabbedKey(null);
        if (prev) applyOrderWithFlip(prev);
        announce("Перемещение отменено");
      }
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [announce, applyOrderWithFlip, finishDrag, grabbedKey, updateDropSpot]);

  useEffect(() => () => {
    if (dragRef.current) {
      window.cancelAnimationFrame(dragRef.current.rafId);
      document.documentElement.classList.remove("laid-dragging");
      dragRef.current = null;
    }
  }, []);

  const startPointerDrag = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (disabled || dragRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const key = slotKeyAt(slots, index);
    const itemEl = itemRefs.current.get(key);
    const handleEl = e.currentTarget;
    if (!itemEl) return;

    e.preventDefault();
    if (grabbedKey !== null) {
      setGrabbedKey(null);
      preGrabSlotsRef.current = null;
    }

    itemEl.getAnimations().forEach((anim) => anim.finish());
    const scrollEl = findScrollParent(listRef.current);
    const state: DragState = {
      pointerId: e.pointerId,
      fromIndex: index,
      dropIndex: index,
      startY: e.clientY,
      lastY: e.clientY,
      itemEl,
      handleEl,
      scrollEl,
      startScrollTop: scrollEl?.scrollTop ?? 0,
      rafId: 0,
      lastFrame: performance.now(),
      itemHeight: itemEl.getBoundingClientRect().height,
    };

    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch {
      // Some synthetic environments don't support setPointerCapture.
    }

    dragRef.current = state;
    setDraggingKey(key);
    document.documentElement.classList.add("laid-dragging");

    const tick = (now: number) => {
      const current = dragRef.current;
      if (!current) return;
      const dt = Math.min(48, Math.max(0, now - current.lastFrame));
      current.lastFrame = now;
      if (current.scrollEl) {
        const rect = current.scrollEl.getBoundingClientRect();
        const zone = Math.min(current.itemHeight, rect.height / 3);
        let velocity = 0;
        if (current.lastY < rect.top + zone) {
          const depth = Math.min(1.8, (rect.top + zone - current.lastY) / Math.max(1, zone));
          velocity = -depth * 0.45;
        } else if (current.lastY > rect.bottom - zone) {
          const depth = Math.min(1.8, (current.lastY - (rect.bottom - zone)) / Math.max(1, zone));
          velocity = depth * 0.45;
        }
        if (velocity !== 0) {
          const before = current.scrollEl.scrollTop;
          current.scrollEl.scrollTop += velocity * dt;
          if (current.scrollEl.scrollTop !== before) {
            const scrollDelta = current.scrollEl.scrollTop - current.startScrollTop;
            current.itemEl.style.translate = `0px ${current.lastY - current.startY + scrollDelta}px`;
            updateDropSpot(current);
          }
        }
      }
      current.rafId = window.requestAnimationFrame(tick);
    };
    state.rafId = window.requestAnimationFrame(tick);
  };

  const stepSlot = (index: number, delta: -1 | 1, source: "handle" | "up" | "down") => {
    if (disabled) return;
    const target = index + delta;
    if (target < 0 || target >= slots.length) return;
    const moved = slots[index];
    const next = LaidDupPlan.moveSlot(slots, index, target);
    const nextKey = slotKeyAt(next, target);

    movingFocusRef.current = true;
    applyOrderWithFlip(next);

    const movedEl = itemRefs.current.get(nextKey);
    movedEl?.scrollIntoView({ block: "nearest", inline: "nearest" });

    if (movedEl) {
      if (source === "handle") {
        movedEl.querySelector<HTMLButtonElement>(".laid-drag-handle")?.focus({ preventScroll: true });
      } else if (source === "up") {
        // Если кнопка «вверх» стала недоступна на Пн, переводим фокус на «вниз» этой же строки.
        const selector = target === 0 ? ".laid-move-down" : ".laid-move-up";
        movedEl.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
      } else {
        const selector = target === next.length - 1 ? ".laid-move-up" : ".laid-move-down";
        movedEl.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
      }
    }
    movingFocusRef.current = false;
    announce(`${slotName(moved, version)} — теперь ${DAY_NAMES[target]}`, 240);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;
    const key = slotKeyAt(slots, index);
    const isGrabbed = grabbedKey === key;

    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (isGrabbed) {
        setGrabbedKey(null);
        preGrabSlotsRef.current = null;
        announce(`${slotName(slots[index], version)} закреплён на ${DAY_NAMES[index]}`);
      } else {
        preGrabSlotsRef.current = [...slots];
        setGrabbedKey(key);
        announce(`${slotName(slots[index], version)} выбран (${DAY_NAMES[index]}). Стрелки вверх и вниз — перенести, Пробел — поставить, Escape — отмена.`);
      }
      return;
    }
    if (!isGrabbed) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const target = index - 1;
      if (target >= 0) setGrabbedKey(slotKeyAt(LaidDupPlan.moveSlot(slots, index, target), target));
      stepSlot(index, -1, "handle");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const target = index + 1;
      if (target < slots.length) setGrabbedKey(slotKeyAt(LaidDupPlan.moveSlot(slots, index, target), target));
      stepSlot(index, 1, "handle");
    }
  };

  return (
    <div className="laid-week-editor">
      {showPresets ? (
        <div className="laid-week-presets" role="group" aria-label="Готовые раскладки">
          {trainingDaysCount === 6 ? (
            <>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={activePreset === "6x1"}
                className={`laid-preset-btn${activePreset === "6x1" ? " active" : ""}`}
                onClick={() => applyPreset(LaidDupPlan.slotsForRhythm("6x1"), "Выбрана классика: Пн–Сб, выходной Вс")}
              >
                Пн–Сб · отдых Вс
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={activePreset === "3x1x3"}
                className={`laid-preset-btn${activePreset === "3x1x3" ? " active" : ""}`}
                onClick={() => applyPreset(LaidDupPlan.slotsForRhythm("3x1x3"), "Выбран ритм 3 + 1 + 3: отдых Чт")}
              >
                3 + 1 + 3 · отдых Чт
              </button>
            </>
          ) : trainingDaysCount === 5 ? (
            <button
              type="button"
              disabled={disabled}
              aria-pressed={isV3Default}
              className={`laid-preset-btn${isV3Default ? " active" : ""}`}
              onClick={() => applyPreset(LaidDupPlan.slotsForV3(), "Выбран стандарт DUP v3: Пн–Ср и Пт–Сб, отдых Чт и Вс")}
            >
              5 дн. DUP v3 · отдых Чт и Вс
            </button>
          ) : null}
          {isDirty && initialSlots ? (
            <button
              type="button"
              disabled={disabled}
              className="laid-preset-btn laid-preset-reset"
              onClick={() => applyPreset(initialSlots, "Возвращена исходная раскладка недели")}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Сбросить
            </button>
          ) : null}
        </div>
      ) : null}

      <ol
        id={listId}
        ref={listRef}
        className="laid-week-editor-list"
        aria-label="Порядок тренировок по дням недели"
        onFocus={(e) => {
          const item = (e.target as HTMLElement).closest<HTMLLIElement>(".laid-week-slot");
          if (item && item.matches(":has(:focus-visible)") && item.getAnimations().length === 0) {
            item.scrollIntoView({ block: "nearest", inline: "nearest" });
          }
        }}
      >
        {slots.map((slot, index) => {
          const key = slotKeyAt(slots, index);
          const isRest = slot === null;
          const isDragging = draggingKey === key;
          const isGrabbed = grabbedKey === key;
          const title = slotName(slot, version);
          const subtitle = slot
            ? [counts?.[slot], summaries?.[slot]].filter(Boolean).join(" · ") || LaidDupPlan.ORIGINAL[slot]
            : "Восстановление без тренировки";
          return (
            <li
              key={key}
              ref={(el) => {
                if (el) itemRefs.current.set(key, el);
                else itemRefs.current.delete(key);
              }}
              className={`laid-week-slot${isRest ? " is-rest" : ""}${isDragging ? " is-dragging" : ""}${isGrabbed ? " is-grabbed" : ""}`}
              style={{ ["--laid-vt-name" as string]: `laid-slot-${key}` }}
              data-weekday={index}
              data-slot={slot ?? "rest"}
            >
              <button
                type="button"
                className="laid-drag-handle"
                disabled={disabled}
                aria-label={`Переместить ${title}, сейчас ${DAY_NAMES[index]}`}
                aria-pressed={isGrabbed}
                onPointerDown={(e) => startPointerDrag(e, index)}
                onLostPointerCapture={() => {
                  if (dragRef.current && dragRef.current.fromIndex === index) finishDrag(false);
                }}
                onKeyDown={(e) => handleKeyDown(e, index)}
                onBlur={() => {
                  if (isGrabbed && !movingFocusRef.current) {
                    setGrabbedKey(null);
                    preGrabSlotsRef.current = null;
                  }
                }}
              >
                <GripVertical size={18} aria-hidden="true" />
              </button>

              <span className="laid-slot-day" aria-hidden="true">
                {DAY_NAMES[index]}
              </span>

              <div className="laid-slot-body">
                <span className="laid-slot-title">
                  {isRest ? <Moon size={14} aria-hidden="true" /> : null}
                  <b>{title}</b>
                </span>
                <small className="laid-slot-sub">{subtitle}</small>
                <span className="laid-slot-key-hint" aria-hidden="true">
                  {isGrabbed ? "↑↓ — сдвиг · Space — поставить · Esc — отмена" : "Space — двигать"}
                </span>
              </div>

              <div className="laid-slot-controls">
                <button
                  type="button"
                  className="laid-move-btn laid-move-up"
                  disabled={disabled || index === 0}
                  aria-label={`Перенести ${title} на ${index > 0 ? DAY_NAMES[index - 1] : "день раньше"}`}
                  onClick={() => stepSlot(index, -1, "up")}
                >
                  <ArrowUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="laid-move-btn laid-move-down"
                  disabled={disabled || index === slots.length - 1}
                  aria-label={`Перенести ${title} на ${index < slots.length - 1 ? DAY_NAMES[index + 1] : "день позже"}`}
                  onClick={() => stepSlot(index, 1, "down")}
                >
                  <ArrowDown size={16} aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {recoveryNotes.length ? (
        <ul className="laid-week-hints" aria-label="Заметки по восстановлению">
          {recoveryNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      {overlapNotes.length ? (
        <ul className="laid-taken" aria-label="Совпадения с другими программами">
          {overlapNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}
