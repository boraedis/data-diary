"use client";

import { useEffect, useRef, useState } from "react";
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
 */
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
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = items.find((item) => item.id === valueId) ?? null;

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        id={id}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.primary : emptyLabel}
        </span>
        <span className="ml-2 shrink-0 text-muted-foreground">▾</span>
      </button>
      {selected?.secondary ? (
        <p className="mt-1 text-xs text-muted-foreground">{selected.secondary}</p>
      ) : null}

      {open ? (
        <div className="absolute z-40 mt-1 w-full rounded-lg border border-border bg-background p-2 shadow-lg">
          <SearchPanel
            items={items}
            onSelect={(id) => {
              onChange(id);
              setOpen(false);
            }}
            placeholder={placeholder}
            autoFocus
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
        </div>
      ) : null}
    </div>
  );
}
