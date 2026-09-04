import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MusicUploadPanel } from "@/components/manage/music-upload-panel";
import { ReviewProgressRow } from "@/components/manage/review-progress-row";
import { getMusicCurationStats, getMusicListenStats } from "@/lib/music";

export const dynamic = "force-dynamic";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

export default async function ManageMusicPage() {
  const [stats, curation] = await Promise.all([getMusicListenStats(), getMusicCurationStats()]);

  const needsReview =
    curation.totalGenres - curation.groupedGenres + (curation.totalPodcastShows - curation.categorizedPodcastShows);

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
          </CardContent>
        </Card>
      )}
    </main>
  );
}
