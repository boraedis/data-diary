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
 */
export function SearchCombobox({
  id,
  items,
  valueId,
  onChange,
  placeholder,
  emptyLabel = "—",
  autoFocus = false,
}: {
  id: string;
  items: SearchItem[];
  valueId: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  emptyLabel?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selected = items.find((item) => item.id === valueId) ?? null;

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    function handleScrollOrResize(event: Event) {
      // A scroll inside the dropdown's own results list shouldn't close it.
      if (dropdownRef.current && event.target instanceof Node && dropdownRef.current.contains(event.target)) {
        return;
      }
      setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  function toggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      if (next && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
      }
      return next;
    });
  }

  return (
    <div className="relative">
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
            >
              <SearchPanel
                items={items}
                onSelect={(id) => {
                  onChange(id);
                  setOpen(false);
                }}
                placeholder={placeholder}
                autoFocus={autoFocus}
              />
              {valueId !== null ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="mt-2 w-full"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
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
