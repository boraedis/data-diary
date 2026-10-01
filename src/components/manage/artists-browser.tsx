"use client";

import { useState } from "react";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import type { SearchItem } from "@/components/entry-forms/search-panel";
import type { ArtistListItem } from "@/lib/catalog-admin";
import { filterArtists, type ArtistFilter } from "@/lib/artist-filters";
import { formatHoursTotal } from "@/lib/viz/format";

function toSearchItem(artist: ArtistListItem): SearchItem {
  return {
    id: artist.id,
    primary: artist.name,
    secondary: artist.genres.slice(0, 3).join(", ") || undefined,
    caption: artist.hours > 0 ? `${formatHoursTotal(artist.hours)} listened` : undefined,
    searchTerms: artist.aliases,
  };
}

// The list arrives most-listened first (#540), so the artists that would
// move the Music Trend's "No group" band the most are at the top of every
// view. The two filters (#248, #540) jump straight to the gaps instead of
// scrolling hundreds of artists for the blank ones: "no genre" is the
// artists Spotify never resolved a genre for; "no genre group" is a
// superset that also includes artists whose genres exist but haven't been
// sorted into a group yet — everything that lands in "No group" on the chart.
export function ArtistsBrowser({ artists }: { artists: ArtistListItem[] }) {
  const [filter, setFilter] = useState<ArtistFilter>("all");
  const missingGenre = filterArtists(artists, "no-genre");
  const missingGroup = filterArtists(artists, "no-group");
  const visible = filterArtists(artists, filter);

  const summary =
    filter === "all"
      ? "Showing all artists, most listened first"
      : filter === "no-genre"
        ? `Showing artists without a genre (${missingGenre.length}), most listened first`
        : `Showing artists without a genre group (${missingGroup.length}), most listened first`;

  return (
    <div id="artist-list" className="flex flex-col gap-2 scroll-mt-4">
      {missingGroup.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
          <span>{summary}</span>
          <span className="flex gap-3">
            {(
              [
                ["all", "All"],
                ["no-genre", "No genre"],
                ["no-group", "No group"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={filter === id ? "font-medium text-foreground underline" : "underline"}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
      )}
      <CatalogBrowser
        items={visible.map(toSearchItem)}
        basePath="/manage/entertainment/music/artists"
        placeholder="Search artists…"
        emptyMessage={
          filter === "all"
            ? "No artists yet — import some listens first."
            : filter === "no-genre"
              ? "Every artist has a genre."
              : "Every artist has a genre group."
        }
      />
    </div>
  );
}
