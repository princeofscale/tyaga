import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string };
// Old WebViews without the Popover API keep the native picker.
const supported = typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;

/**
 * In-app dropdown: the system picker looks foreign on Android. The list lives in
 * the top layer, so dialogs and scroll boxes never clip it. Put it inside a
 * <label> or pass aria-label, like a native <select>.
 */
export default function Select({
  value,
  options,
  onChange,
  disabled,
  ...aria
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const place = () => {
    const box = trigger.current!.getBoundingClientRect();
    const pop = list.current!;
    const width = Math.max(box.width, 200);
    const below = innerHeight - box.bottom - 12;
    const above = box.top - 12;
    // Before the list is shown it has no height yet: estimate from the rows.
    const height = Math.min(pop.scrollHeight || options.length * 46 + 14, 320);
    const up = below < height && above > below;
    pop.style.width = `${Math.min(width, innerWidth - 16)}px`;
    pop.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
    pop.style.maxHeight = `${Math.min(320, up ? above : below)}px`;
    pop.style.top = up ? "" : `${box.bottom + 6}px`;
    pop.style.bottom = up ? `${innerHeight - box.top + 6}px` : "";
  };
  useEffect(() => {
    if (!open) return;
    // Follow the field while the page scrolls under the open list.
    const follow = () => place();
    addEventListener("scroll", follow, true);
    addEventListener("resize", follow);
    return () => {
      removeEventListener("scroll", follow, true);
      removeEventListener("resize", follow);
    };
  }, [open]);
  if (!supported)
    return (
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} {...aria}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  const choose = (next: string) => {
    list.current!.hidePopover();
    trigger.current!.focus();
    if (next !== value) onChange(next);
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...list.current!.querySelectorAll<HTMLButtonElement>("[role=option]")];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="select-trigger"
        popoverTarget={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        data-value={value}
        disabled={disabled}
        {...aria}
      >
        <span>{options.find((o) => o.value === value)?.label ?? "—"}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <div
        ref={list}
        id={id}
        popover="auto"
        role="listbox"
        className="select-list"
        onKeyDown={move}
        onBlur={(e) => {
          if (open && !list.current!.contains(e.relatedTarget as Node)) list.current!.hidePopover();
        }}
        // beforetoggle runs before the first paint, so the list never flashes
        // in the corner; toggle (async) refines with the real height.
        onBeforeToggle={(e) => {
          if (e.newState === "open") place();
        }}
        onToggle={(e) => {
          const opened = e.newState === "open";
          setOpen(opened);
          if (!opened) return;
          place();
          list.current!.querySelector<HTMLButtonElement>("[aria-selected=true], [role=option]")?.focus();
        }}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={o.value === value}
            onClick={() => choose(o.value)}
          >
            <span>{o.label}</span>
            {o.value === value ? <Check size={16} aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
    </>
  );
}
