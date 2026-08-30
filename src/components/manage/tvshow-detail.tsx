"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { TvShowCatalogItem, TvShowUsage } from "@/lib/days";

// Same convention as MovieDetail's local POSTER_BASE — see that file's
// comment for why this isn't imported from src/lib/tmdb.ts.
const POSTER_BASE = "https://image.tmdb.org/t/p/w185";

// Unlike MovieDetail (fully read-only), a TV show has two things you can
// actually do here beyond delete: toggle whether you're still tracking it,
// and pull fresh status/next-episode info from TMDB — see the comment above
// TV_SHOW_COLUMNS in src/lib/days.ts for why shows need this and movies
// don't.
export function TvShowDetail({ show: initial, usage }: { show: TvShowCatalogItem; usage: TvShowUsage }) {
  const [show, setShow] = useState(initial);
  const [togglingInterested, setTogglingInterested] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleInterested() {
    setTogglingInterested(true);
    setError(null);
    try {
      const res = await fetch(`/api/tvshows/${show.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interested: !show.interested }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setShow(await res.json());
    } catch {
      setError("Failed to update");
    } finally {
      setTogglingInterested(false);
    }
  }

  async function refreshFromTmdb() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/tvshows/${show.id}/refresh`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to refresh");
      setShow(await res.json());
    } catch {
      setError("Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <Link href="/manage/entertainment/tvshows" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; TV shows
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{show.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-4">
            {show.posterPath ? (
              // eslint-disable-next-line @next/next/no-img-element -- external TMDB CDN image, not worth next/image's config for a personal app
              <img
                src={`${POSTER_BASE}${show.posterPath}`}
                alt=""
                className="h-36 w-24 shrink-0 rounded object-cover"
              />
            ) : null}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd>{show.status ?? "—"}</dd>
              <dt className="text-muted-foreground">Genres</dt>
              <dd>{show.genres.length > 0 ? show.genres.join(", ") : "—"}</dd>
              <dt className="text-muted-foreground">Next episode</dt>
              <dd>
                {show.nextEpisodeDate
                  ? `${show.nextEpisodeDate}${
                      show.nextEpisodeSeason !== null && show.nextEpisodeNumber !== null
                        ? ` (S${show.nextEpisodeSeason}E${show.nextEpisodeNumber})`
                        : ""
                    }`
                  : "—"}
              </dd>
              <dt className="text-muted-foreground">Interested</dt>
              <dd>
                {show.interested ? "Yes" : `No${show.uninterestedDate ? ` (since ${show.uninterestedDate})` : ""}`}
              </dd>
              <dt className="text-muted-foreground">Last refreshed</dt>
              <dd>{show.lastRefreshed ?? "—"}</dd>
            </dl>
          </div>

          {error ? <span className="text-sm text-destructive">{error}</span> : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={toggleInterested} disabled={togglingInterested}>
              {togglingInterested ? "Saving…" : show.interested ? "Mark not interested" : "Mark interested"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={refreshFromTmdb} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh from TMDB"}
            </Button>
          </div>

          <DeleteCatalogItem
            itemLabel={show.title}
            isBlocked={usage.watchCount > 0}
            afterDeleteHref="/manage/entertainment/tvshows"
            onDelete={async () => {
              const res = await fetch(`/api/tvshows/${show.id}`, { method: "DELETE" });
              if (!res.ok) throw new Error("Failed to delete");
            }}
            blockedContent={<p>This show has watched episodes and can&rsquo;t be deleted.</p>}
          />
        </CardContent>
      </Card>
    </>
  );
}
