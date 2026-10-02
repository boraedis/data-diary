"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import { cn } from "@/lib/utils";

/**
 * Single-value picker built on SearchPanel — a searchable replacement for a
 * plain `<select>`, for fields that pick ONE catalog item (an exercise, a
 * workout location, an entertainment title) rather than filling a fixed set
 * of slots (see PeopleEntryForm/PlacesEntryForm for that pattern instead).
 * Click the trigger to open a small search panel below it; click a result
 * to select and close.
 *
 * The dropdown is rendered through a portal into document.body rather than
 * as a normal absolutely-positioned child: every trigger of this component
 * lives inside a `Card`, which clips overflow, so an in-flow `absolute`
 * dropdown gets visually cut off instead of floating above the card. The
 * portal escapes that clipping; we position it ourselves (fixed, computed
 * from the trigger's own bounding rect) since it's no longer in the normal
 * flow under the trigger. We don't bother live-tracking the trigger's
 * position while open — a scroll or resize just closes the dropdown instead,
 * which is simple and matches how most comboboxes behave anyway.
 *
 * Width (#563): the trigger fills its container (`w-full`) with a floor of
 * `MIN_TRIGGER_WIDTH`, and the dropdown is at least `MIN_DROPDOWN_WIDTH`
 * even when the trigger is narrower. Both matter because the trigger sits
 * in flex rows beside a "+ New" button: with no explicit width it used to
 * collapse to its placeholder's width until something was selected, which
 * made the list too narrow to read and the exercise/location pickers hard
 * to use. The dropdown is clamped to the viewport so a wide panel opened
 * from a trigger near the right edge shifts left instead of running off it.
 */
const MIN_TRIGGER_WIDTH = 160;
const MIN_DROPDOWN_WIDTH = 288;
const VIEWPORT_MARGIN = 8;

/** Where the dropdown goes under `rect`: at least `MIN_DROPDOWN_WIDTH` wide
 * (or the trigger's width, if larger), never wider than the viewport, and
 * shifted left rather than clipped when it would overflow the right edge. */
export function dropdownPosition(
  rect: { left: number; bottom: number; width: number },
  viewportWidth: number
): { top: number; left: number; width: number } {
  const maxWidth = Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2);
  const width = Math.min(Math.max(rect.width, MIN_DROPDOWN_WIDTH), maxWidth);
  const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, viewportWidth - VIEWPORT_MARGIN - width));
  return { top: rect.bottom + 4, left, width };
}

export function SearchCombobox({
  id,
  items,
  valueId,
  onChange,
  placeholder,
  emptyLabel = "—",
}: {
  id: string;
  items: SearchItem[];
  valueId: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selected = items.find((item) => item.id === valueId) ?? null;

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent | TouchEvent) {
      // Use composedPath for better compatibility with portals and Safari
      const path =
        "composedPath" in event ? event.composedPath() : [(event as MouseEvent).target as Node];

      // Check if any element in the path is our trigger or dropdown.
      // Filter to only actual Node instances since composedPath can include non-Node objects (Window, etc).
      const isInsideTrigger = path.some((el) => el instanceof Node && triggerRef.current?.contains(el));
      const isInsideDropdown = path.some((el) => el instanceof Node && dropdownRef.current?.contains(el));

      if (!isInsideTrigger && !isInsideDropdown) {
        setOpen(false);
      }
    }
    function handleScrollOrResize(event: Event) {
      // A scroll inside the dropdown's own results list shouldn't close it.
      if (dropdownRef.current && event.target instanceof Node && dropdownRef.current.contains(event.target)) {
        return;
      }
      // On mobile, focusing the search input opens the on-screen keyboard,
      // which fires a `resize` (and sometimes `scroll`) event on `window` —
      // whose `event.target` is `window` itself, not a Node, so the check
      // above never catches it. That was closing the dropdown the instant
      // you tapped into the search box. Guard against that specifically: if
      // focus is currently inside the dropdown, treat the resize/scroll as
      // keyboard-driven noise rather than "user scrolled/resized away".
      if (dropdownRef.current && document.activeElement && dropdownRef.current.contains(document.activeElement)) {
        return;
      }
      setOpen(false);
    }

    // Use capture phase to ensure we catch events early, and check specifically
    // for clicks/touches inside the dropdown
    document.addEventListener("mousedown", handleClickOutside as EventListener, true);
    document.addEventListener("touchstart", handleClickOutside as EventListener, true);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside as EventListener, true);
      document.removeEventListener("touchstart", handleClickOutside as EventListener, true);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  // Closing via a pick, Clear or Escape returns focus to the trigger, so the
  // form can be tabbed on from where the picker was.
  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function toggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      if (next && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPosition(dropdownPosition(rect, window.innerWidth));
      }
      return next;
    });
  }

  return (
    <div className="relative w-full" style={{ minWidth: MIN_TRIGGER_WIDTH }}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        onClick={toggleOpen}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3.5 text-base outline-none transition-colors",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.primary : emptyLabel}
        </span>
        <span className="ml-2 shrink-0 text-muted-foreground">▾</span>
      </button>
      {selected?.secondary ? (
        <p className="mt-1 text-sm text-muted-foreground">{selected.secondary}</p>
      ) : null}

      {open && position
        ? createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-50 rounded-lg border border-border bg-background p-2 shadow-lg"
              style={{ top: position.top, left: position.left, width: position.width }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
              }}
            >
              <SearchPanel
                items={items}
                refocusOnSelect={false}
                onSelect={(id) => {
                  onChange(id);
                  close();
                }}
                placeholder={placeholder}
                autoFocus={true}
              />
              {valueId !== null ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="mt-2 w-full"
                  onClick={() => {
                    onChange(null);
                    close();
                  }}
                >
                  Clear selection
                </Button>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
