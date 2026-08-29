"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SearchItem = {
  id: number;
  /** Main label — what you're actually picking. */
  primary: string;
  /** Disambiguating subtext (tag, category, alias, kind, ...). Shown grey,
   * under the primary label, and included in the search match. */
  secondary?: string | null;
  /** Extra terms matched against but not necessarily displayed (nicknames,
   * aliases) — lets "typing a nickname finds the person" without cluttering
   * the row. */
  searchTerms?: string[];
  /** Optional per-item accent color (a tag's color, a category's color, …)
   * rendered as a left edge on the row — the same "colored border" language
   * as the manage hub's catalog cards. Omit (or null) for no edge. */
  accentColor?: string | null;
};

function matches(item: SearchItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (item.primary.toLowerCase().includes(q)) return true;
  if (item.secondary?.toLowerCase().includes(q)) return true;
  return (item.searchTerms ?? []).some((t) => t.toLowerCase().includes(q));
}

/**
 * Search box + scrollable result list — the legacy app's pattern (functions/
 * views/entry/people.js's `#search`/`#searchPanel`, and the same shape in
 * places.js/entertainment.js) for picking from a catalog that's too long
 * for a plain dropdown to be usable. Each row can carry a secondary line
 * for disambiguation (two people named "Alex", a movie and a book both
 * called "It") — both primary and secondary text are searchable.
 *
 * `secondaryAction` adds a small extra button on every row for a rare
 * alternate pick (e.g. "add as negative" next to the default "add as
 * positive") — tapping the row itself still runs `onSelect`.
 */
export function SearchPanel({
  items,
  onSelect,
  secondaryAction,
  placeholder = "Search…",
  emptyMessage = "No matches.",
  className,
  autoFocus,
  trailingAction,
}: {
  items: SearchItem[];
  onSelect: (id: number) => void;
  secondaryAction?: {
    ariaLabel: string;
    icon: ReactNode;
    onSelect: (id: number) => void;
  };
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
  autoFocus?: boolean;
  /** Rendered inline beside the search input, same row — e.g. a "+ New"
   * button that wants to read as part of the same search ribbon rather than
   * a separate control floating above or below it. */
  trailingAction?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => items.filter((item) => matches(item, query)), [items, query]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="flex-1"
        />
        {trailingAction}
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border md:max-h-96">
        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className="flex items-stretch border-b border-l-4 border-border last:border-b-0"
              style={{ borderLeftColor: item.accentColor ?? "transparent" }}
            >
              <button
                type="button"
                onClick={() => {
                  onSelect(item.id);
                  setQuery("");
                }}
                className="flex flex-1 flex-col items-start gap-0.5 px-3.5 py-2.5 text-left hover:bg-accent"
              >
                <span className="text-base">{item.primary}</span>
                {item.secondary ? (
                  <span className="text-sm text-muted-foreground">{item.secondary}</span>
                ) : null}
              </button>
              {secondaryAction ? (
                <button
                  type="button"
                  aria-label={secondaryAction.ariaLabel}
                  title={secondaryAction.ariaLabel}
                  onClick={() => {
                    secondaryAction.onSelect(item.id);
                    setQuery("");
                  }}
                  className="flex w-12 shrink-0 items-center justify-center border-l border-border text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  {secondaryAction.icon}
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
