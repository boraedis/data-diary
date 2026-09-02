import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MusicUploadPanel } from "@/components/manage/music-upload-panel";
import { listGenreGroups, listPodcastCategories } from "@/lib/catalog-admin";
import { getMusicCurationStats, getMusicListenStats } from "@/lib/music";

export const dynamic = "force-dynamic";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

// Same "X/N filled" progress-bar visual as the day-entry dashboard
// (src/app/day/[date]/page.tsx) — reused here for the two catalogs the
// Spotify import pipeline populates automatically but can never finish
// curating on its own (see getMusicCurationStats's comment).
function ReviewProgressRow({ label, href, done, total }: { label: string; href: string; done: number; total: number }) {
  const pct = total > 0 ? (done / total) * 100 : 100;
  return (
    <Link href={href} className="flex flex-col gap-1.5 rounded-lg px-1 py-1 transition-colors hover:bg-accent">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {done}/{total}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </Link>
  );
}

export default async function ManageMusicPage() {
  const [stats, curation, genreGroups, podcastCategories] = await Promise.all([
    getMusicListenStats(),
    getMusicCurationStats(),
    listGenreGroups(),
    listPodcastCategories(),
  ]);

  const needsReview = curation.totalGenres - curation.groupedGenres + (curation.totalPodcastShows - curation.categorizedPodcastShows);

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
              {formatDate(stats.earliestPlayedAt)} – {formatDate(stats.latestPlayedAt)}
            </div>
          </div>
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
        <Link href="/manage/entertainment/music/genre-groups">
          <Card size="sm" className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Genre groups</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{genreGroups.length}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/manage/entertainment/music/genres">
          <Card size="sm" className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Genres</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{curation.totalGenres}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/manage/entertainment/music/podcast-categories" className="col-span-2">
          <Card size="sm" className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Podcast categories</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{podcastCategories.length}</span>
              </div>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {(curation.totalGenres > 0 || curation.totalPodcastShows > 0) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Needs review</CardTitle>
              {needsReview > 0 && (
                <span className="text-xs text-muted-foreground">{needsReview} unassigned</span>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {curation.totalGenres > 0 && (
              <ReviewProgressRow
                label="Genres grouped"
                href="/manage/entertainment/music/genres"
                done={curation.groupedGenres}
                total={curation.totalGenres}
              />
            )}
            {curation.totalPodcastShows > 0 && (
              <ReviewProgressRow
                label="Podcast shows categorized"
                href="/manage/entertainment/music/podcasts"
                done={curation.categorizedPodcastShows}
                total={curation.totalPodcastShows}
              />
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
