"use client";

import Link from "next/link";
import type { SportsWatchHistoryEntry } from "@/lib/days";

/**
 * Shared watch-history list for the sports league/team detail pages —
 * same bordered-row-link pattern as MovieDetail's Watch history card.
 * Previously lived inline (and height-capped at max-h-48) inside
 * sport-detail.tsx's LeagueRow/TeamRow; now that leagues/teams get their
 * own full detail page (see #9), this is a full-height card section
 * instead of a cramped inline toggle.
 *
 * `perspectiveTeamName` lets a team's own page omit itself from the "vs."
 * line and show just the opponent; the league page omits it and shows the
 * full matchup.
 */
export function SportsWatchHistoryList({
  watches,
  perspectiveTeamName,
}: {
  watches: SportsWatchHistoryEntry[];
  perspectiveTeamName?: string;
}) {
  if (watches.length === 0) {
    return <p className="text-sm text-muted-foreground">No watches logged.</p>;
  }
  return (
    <>
      {watches.map((w, i) => {
        let matchup: string | null;
        if (perspectiveTeamName !== undefined) {
          const isHome = w.homeTeamName === perspectiveTeamName;
          const opponent = isHome ? w.awayTeamName : w.homeTeamName;
          matchup = opponent ? `${isHome ? "vs" : "@"} ${opponent}` : null;
        } else {
          matchup = w.homeTeamName && w.awayTeamName ? `${w.homeTeamName} vs ${w.awayTeamName}` : null;
        }
        return (
          <Link
            key={i}
            href={`/day/${w.date}/entertainment`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            <span>{w.date}</span>
            <span className="text-xs text-muted-foreground">
              {[matchup, w.season, w.gameType, w.watchedLive ? "live" : null, w.locationType]
                .filter(Boolean)
                .join(" · ") || "—"}
            </span>
          </Link>
        );
      })}
    </>
  );
}
