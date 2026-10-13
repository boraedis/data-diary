import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MusicUploadPanel } from "@/components/manage/music-upload-panel";
import { ReviewProgressRow } from "@/components/manage/review-progress-row";
import { getMusicCurationStats, getMusicListenStats } from "@/lib/music";
import { todayDateString } from "@/lib/date";
import { daysSinceLatestListen, importFreshness, type ImportFreshness } from "@/lib/music-staleness";

export const dynamic = "force-dynamic";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

// Colour for the newest-listen date and its "N days ago" line (issue #643).
// The rule is a heads-up, not a nag: amber and red only ask for a fresh
// export, and nothing here changes behaviour.
const FRESHNESS_TEXT: Record<ImportFreshness, string> = {
  fresh: "text-success",
  due: "text-warning",
  overdue: "text-destructive",
};

export default async function ManageMusicPage() {
  const [stats, curation] = await Promise.all([getMusicListenStats(), getMusicCurationStats()]);
  // Computed on the server, so "today" is the server's calendar date. The
  // app runs on Vercel (UTC), so near local midnight this can read one day
  // behind, which is harmless against 30- and 60-day bands.
  const daysSince = daysSinceLatestListen(stats.latestPlayedAt, todayDateString());
  const freshnessClass = daysSince === null ? "" : FRESHNESS_TEXT[importFreshness(daysSince)];

  const needsReview =
    curation.totalGenres -
    curation.groupedGenres +
    (curation.totalPodcastShows - curation.categorizedPodcastShows) +
    (curation.totalArtists - curation.artistsWithGenres);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Music</h1>
        <Link href="/manage/entertainment" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to Entertainment
        </Link>
      </div>

      <MusicUploadPanel />

      <Card>
        <CardHeader>
          <CardTitle>Listen history</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <span className="text-muted-foreground">Total listens</span>
            <div className="font-mono">{stats.totalListens}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Artists</span>
            <div className="font-mono">{stats.uniqueArtists}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Podcast shows</span>
            <div className="font-mono">{stats.uniquePodcastShows}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Date range</span>
            <div className="font-mono text-xs">
              {formatDate(stats.earliestPlayedAt)} – <span className={freshnessClass}>{formatDate(stats.latestPlayedAt)}</span>
            </div>
            {daysSince !== null && (
              <div className={`text-xs ${freshnessClass}`}>
                {daysSince === 0 ? "newest listen today" : `newest listen ${daysSince} ${daysSince === 1 ? "day" : "days"} ago`}
              </div>
            )}
          </div>
          <p className="col-span-full text-xs text-muted-foreground">
            Aim for a Spotify export about monthly. Green under 30 days, amber 30–59, red 60+.
          </p>
          {/* Spotify's privacy page is where the GDPR export is requested
              (#651). It opens in a new tab, so the upload page stays put. */}
          <a
            href="https://www.spotify.com/us/account/privacy/"
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonVariants({ variant: "outline", size: "sm" })} col-span-full w-fit`}
          >
            Request a Spotify export
          </a>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Link href="/manage/entertainment/music/artists">
          <Card size="sm" className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Artists</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{stats.uniqueArtists}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/manage/entertainment/music/podcasts">
          <Card size="sm" className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Podcasts</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{stats.uniquePodcastShows}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {needsReview > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Needs review</CardTitle>
              <span className="text-xs text-muted-foreground">{needsReview} unassigned</span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {curation.totalGenres - curation.groupedGenres > 0 && (
              <ReviewProgressRow
                label="Genres grouped"
                href="/manage/entertainment/music/artists"
                done={curation.groupedGenres}
                total={curation.totalGenres}
              />
            )}
            {curation.totalPodcastShows - curation.categorizedPodcastShows > 0 && (
              <ReviewProgressRow
                label="Podcast shows categorized"
                href="/manage/entertainment/music/podcasts"
                done={curation.categorizedPodcastShows}
                total={curation.totalPodcastShows}
              />
            )}
            {curation.totalArtists - curation.artistsWithGenres > 0 && (
              <ReviewProgressRow
                label="Artists with a genre"
                href="/manage/entertainment/music/artists"
                done={curation.artistsWithGenres}
                total={curation.totalArtists}
              />
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
