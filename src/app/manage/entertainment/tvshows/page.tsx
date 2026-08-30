import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TvShowsManageList } from "@/components/manage/tvshows-manage-list";
import { listTvShowsCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageTvShowsPage() {
  const shows = await listTvShowsCatalog();

  // "Next up" — the legacy-app tracker this feature is replacing: shows
  // still being followed (interested), ordered by whichever's next episode
  // airs soonest. A date already in the past still sorts in rather than
  // being filtered out — TMDB's next_episode_to_air can lag right after an
  // episode airs, and "recently aired, not yet watched" is exactly the kind
  // of thing this list should still surface. nextEpisodeDate only updates
  // via "Refresh from TMDB" on the show's own detail page (see
  // refreshTvShowCatalogEntry in src/lib/days.ts) — there's no background
  // refresh job for a personal app at this request volume.
  const nextUp = shows
    .filter((s) => s.interested && s.nextEpisodeDate !== null)
    .sort((a, b) => (a.nextEpisodeDate! < b.nextEpisodeDate! ? -1 : a.nextEpisodeDate! > b.nextEpisodeDate! ? 1 : 0));

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">TV shows</h1>
        <Link href="/manage/entertainment" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Entertainment
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Next up</CardTitle>
        </CardHeader>
        <CardContent className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {nextUp.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming episodes tracked.</p>
          ) : (
            nextUp.map((show) => (
              <Link
                key={show.id}
                href={`/manage/entertainment/tvshows/${show.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <span className="truncate">{show.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {show.nextEpisodeDate}
                  {show.nextEpisodeSeason !== null && show.nextEpisodeNumber !== null
                    ? ` (S${show.nextEpisodeSeason}E${show.nextEpisodeNumber})`
                    : ""}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <TvShowsManageList initial={shows} />
    </main>
  );
}
