import { LeaderboardExplorer } from "@/components/charts/leaderboard";
import { getMusicLeaderboardData, MUSIC_MODES, musicColumns, type MusicMode } from "@/lib/leaderboards/listens";
import { pickOption, type SearchParams } from "@/lib/leaderboards/options";
import { MUSIC_METHODOLOGY } from "@/lib/viz/methodology";
import { MUSIC_TRACKING_SPAN } from "@/lib/viz/tracking-span";

export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<MusicMode, string> = {
  artist: "The artists I've listened to most, by total listening time.",
  album: "The albums I've listened to most, by total listening time.",
  song: "Every song I've played, ranked by total listening time.",
  group: "Listening time by genre group — the hand-sorted groups Spotify's genres fold into.",
  genre: "Listening time by Spotify genre. Artists carry several genres, so the same listen counts toward each.",
};

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const mode = pickOption((await searchParams).by, MUSIC_MODES);
  const rows = await getMusicLeaderboardData(mode);
  return (
    <LeaderboardExplorer
      title="Music Leaderboard"
      description={DESCRIPTIONS[mode]}
      methodology={MUSIC_METHODOLOGY}
      trackingSpan={MUSIC_TRACKING_SPAN}
      pickers={[{ param: "by", label: "Rank", value: mode, options: MUSIC_MODES }]}
      rows={rows}
      columns={musicColumns(mode)}
      ariaLabel="Music ranked by listening time, with how each has moved over the last week, month and year."
    />
  );
}
