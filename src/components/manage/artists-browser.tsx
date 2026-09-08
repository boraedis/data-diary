"use client";

import { useState } from "react";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import type { SearchItem } from "@/components/entry-forms/search-panel";
import type { ArtistItem } from "@/lib/catalog-admin";

type ArtistWithGenres = ArtistItem & { genres: string[] };

function toSearchItem(artist: ArtistWithGenres): SearchItem {
  return {
    id: artist.id,
    primary: artist.name,
    secondary: artist.genres.slice(0, 3).join(", ") || undefined,
    searchTerms: artist.aliases,
  };
}

// Mirrors GenreCatalogPanel's "show unassigned only" toggle — lets a user
// jump straight to the artists the Spotify import pipeline never resolved a
// genre for (#248), instead of scrolling an alphabetical list of hundreds of
// artists looking for the blank ones.
export function ArtistsBrowser({ artists }: { artists: ArtistWithGenres[] }) {
  const [showAll, setShowAll] = useState(true);
  const missingGenre = artists.filter((a) => a.genres.length === 0);
  const visible = showAll ? artists : missingGenre;

  return (
    <div id="artist-list" className="flex flex-col gap-2 scroll-mt-4">
      {missingGenre.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{showAll ? "Showing all artists" : `Showing artists without a genre (${missingGenre.length})`}</span>
          <button type="button" className="underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show missing genres only" : "Show all"}
          </button>
        </div>
      )}
      <CatalogBrowser
        items={visible.map(toSearchItem)}
        basePath="/manage/entertainment/music/artists"
        placeholder="Search artists…"
        emptyMessage={showAll ? "No artists yet — import some listens first." : "Every artist has a genre."}
      />
    </div>
  );
}
