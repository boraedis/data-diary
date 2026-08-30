"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { MovieCatalogItem, MovieUsage } from "@/lib/days";

// Same size TMDB serves the search-result thumbnails at (see POSTER_BASE in
// movie-entry-form.tsx / tmdb-tv-search-modal.tsx) — kept a local constant
// rather than imported from src/lib/tmdb.ts, which is server-only (holds
// the TMDB API key) and must never be pulled into a "use client" bundle.
const POSTER_BASE = "https://image.tmdb.org/t/p/w185";

// No edit mode here (unlike every other catalog) — every field is TMDB
// metadata, refreshed by re-adding rather than typed in. This is just a
// read-only detail view, the watch history, and delete.
export function MovieDetail({ movie, usage }: { movie: MovieCatalogItem; usage: MovieUsage }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <Link href="/manage/entertainment/movies" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Movies
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{movie.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-4">
            {movie.posterPath ? (
              // eslint-disable-next-line @next/next/no-img-element -- external TMDB CDN image, not worth next/image's config for a personal app
              <img
                src={`${POSTER_BASE}${movie.posterPath}`}
                alt=""
                className="h-36 w-24 shrink-0 rounded object-cover"
              />
            ) : null}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Release date</dt>
              <dd>{movie.releaseDate ?? "—"}</dd>
              <dt className="text-muted-foreground">Runtime</dt>
              <dd>{movie.runtimeMinutes ? `${movie.runtimeMinutes} min` : "—"}</dd>
              <dt className="text-muted-foreground">Genres</dt>
              <dd>{movie.genres.length > 0 ? movie.genres.join(", ") : "—"}</dd>
              <dt className="text-muted-foreground">Collection</dt>
              <dd>{movie.collectionName ?? "—"}</dd>
            </dl>
          </div>

          <DeleteCatalogItem
            itemLabel={movie.title}
            isBlocked={usage.watches.length > 0}
            afterDeleteHref="/manage/entertainment/movies"
            onDelete={async () => {
              const res = await fetch(`/api/movies/${movie.id}`, { method: "DELETE" });
              if (!res.ok) throw new Error("Failed to delete");
            }}
            blockedContent={
              <ul className="list-inside list-disc">
                {usage.watches.map((w, i) => (
                  <li key={i}>
                    <Link href={`/day/${w.date}/entertainment/movies`} className="text-primary hover:underline">
                      {w.date}
                    </Link>
                  </li>
                ))}
              </ul>
            }
          />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Watch history</CardTitle>
        </CardHeader>
        <CardContent className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {usage.watches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Never watched.</p>
          ) : (
            usage.watches.map((w, i) => (
              <Link
                key={i}
                href={`/day/${w.date}/entertainment/movies`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <span>{w.date}</span>
                <span className="text-xs text-muted-foreground">
                  {[w.rating ? `${w.rating}/10` : null, w.locationType].filter(Boolean).join(" · ") || "—"}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}
