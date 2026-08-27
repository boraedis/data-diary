"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { MovieCatalogItem, MovieUsage } from "@/lib/days";

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

          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {usage.watches.length === 0 ? "Never watched" : `Watched ${usage.watches.length}×`}
            </p>
            {usage.watches.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {usage.watches.map((w, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <Link href={`/day/${w.date}/entertainment/movies`} className="text-primary hover:underline">
                      {w.date}
                    </Link>
                    <span className="text-muted-foreground">
                      {[w.rating ? `${w.rating}/10` : null, w.locationType].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
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
    </>
  );
}
