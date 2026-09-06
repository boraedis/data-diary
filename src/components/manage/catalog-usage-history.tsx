"use client";

import Link from "next/link";

export type CatalogUsageHistoryEntry = {
  date: string;
  label: string | null;
  secondary?: string | null;
};

// Generic bordered-row history list for flat "type/category" catalog
// detail pages (device types, categories, focuses, location types, ...) —
// same row shape as MovieDetail's Watch history card and
// SportsWatchHistoryList, generalized here since these catalog values
// don't each need their own bespoke component (#196). Renaming or
// deleting a catalog value never touches rows that already carry its old
// name (every one of these is a free-text soft reference, not an FK) —
// this is the fallback for going to fix those by hand when bulk editing
// isn't possible.
export function CatalogUsageHistory({
  history,
  daySegment,
  emptyText = "Nothing logged yet.",
}: {
  history: CatalogUsageHistoryEntry[];
  daySegment: string;
  emptyText?: string;
}) {
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <>
      {history.map((entry, i) => {
        const detail = [entry.label, entry.secondary].filter(Boolean).join(" · ");
        return (
          <Link
            key={i}
            href={`/day/${entry.date}/${daySegment}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            <span>{entry.date}</span>
            {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
          </Link>
        );
      })}
    </>
  );
}
