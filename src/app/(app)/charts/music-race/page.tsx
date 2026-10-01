import { MusicRaceChart } from "@/components/charts/music-race-chart";
import {
  buildMusicRaceFrames,
  colorArtistsByTopGenre,
  getArtistGenreRows,
  getMonthlyArtistListening,
} from "@/lib/music-race";

export const dynamic = "force-dynamic";

// Frames for both standings are built here and trimmed to each month's
// leaders, so the client gets a few thousand entries rather than the whole
// (month, artist) grid — see src/lib/music-race.ts.
export default async function Page() {
  const [rows, genreRows] = await Promise.all([getMonthlyArtistListening(), getArtistGenreRows()]);
  const frames = {
    cumulative: buildMusicRaceFrames(rows, "cumulative"),
    recent: buildMusicRaceFrames(rows, "recent"),
  };
  // Only artists that actually appear in a frame need a colour.
  const coloring = colorArtistsByTopGenre(genreRows);
  const raced = new Set([...frames.cumulative, ...frames.recent].flatMap((f) => f.entries.map((e) => e.label)));
  coloring.slotByArtist = Object.fromEntries(Object.entries(coloring.slotByArtist).filter(([name]) => raced.has(name)));
  return <MusicRaceChart frames={frames} coloring={coloring} />;
}
