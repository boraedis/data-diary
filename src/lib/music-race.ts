import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { daysBetween, parseDate, toDateString } from "@/lib/date";
import { recencyWeight } from "@/lib/impact";
import { CATEGORICAL_SLOT_COUNT } from "@/lib/viz/color";
import type { RaceFrame } from "@/lib/viz/race";

// The music bar race (#295): artists racing over time on InteractiveBarRace.
//
// **Aggregated in SQL to one row per (month, artist)** — ~100k listens never
// leave the database, the boundary leaderboards/listens.ts and music-trend.ts
// draw. Months are UTC (listens carry a timestamp, not a day; see
// music-trend.ts). The frames themselves are built server-side from those
// rows and trimmed to the leaders, so the page ships a few thousand entries,
// not the whole (month, artist) grid.
//
// **Listening time**, summed from `ms_played` — the same measure as the
// leaderboards, the Music Trend and the recap (src/lib/music.ts, #183). A
// skipped track counts only for its own seconds, and nothing under
// MIN_LISTEN_MS is stored at all (#244), so no skip threshold is reapplied.
//
// **Two standings, behind a toggle** (decided on #295):
//  - `cumulative` — all listening so far. Honest, but a decade in, the early
//    leaders are far enough ahead that ranks stop changing.
//  - `recent` — the same recency fade the People Race uses (`recencyWeight`),
//    so each past month still counts but less the longer ago it was, which is
//    what lets bars fall as well as rise.

export type MusicRaceMode = "cumulative" | "recent";

export type MonthlyArtistRow = {
  /** First of the month, "YYYY-MM-DD". */
  month: string;
  name: string;
  hours: number;
};

/** Entries kept per frame. The chart draws 20 and lets a climbing bar rise
 * from just below the cut; the rest of the margin means a bar a few places
 * under the visible area still has a real value to animate from. */
const FRAMES_KEEP = 40;

const MS_PER_HOUR = 3_600_000;

export async function getMonthlyArtistListening(): Promise<MonthlyArtistRow[]> {
  const result = await getDb().execute(sql`
    select to_char(date_trunc('month', l.played_at at time zone 'UTC'), 'YYYY-MM-DD') as month,
           a.name,
           sum(l.ms_played) as ms
    from music_listens l join artists a on a.id = l.artist_id
    group by 1, a.id, a.name
    order by 1
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
    month: string;
    name: string;
    ms: string | number;
  }[];
  return rows.map((r) => ({ month: r.month, name: r.name, hours: Number(r.ms) / MS_PER_HOUR }));
}

/**
 * One frame per calendar month from the first listen to the last (months
 * with no listening still get a frame, so the ticker doesn't skip), each
 * holding the top `FRAMES_KEEP` artists' standings at that month.
 *
 * `recent` weights a past month's hours by `recencyWeight` of the days
 * between it and the frame's month — same-month listening at full weight.
 * Both modes drop non-positive values (a bar can't be drawn from nothing).
 *
 * Pure, so the standings maths is testable without a database.
 */
export function buildMusicRaceFrames(rows: MonthlyArtistRow[], mode: MusicRaceMode): RaceFrame[] {
  if (rows.length === 0) return [];

  const months: string[] = [];
  const first = rows[0].month;
  const last = rows[rows.length - 1].month;
  for (let m = first; m <= last; m = nextMonth(m)) months.push(m);
  const monthIndex = new Map(months.map((m, i) => [m, i]));

  // artist -> [monthIndex, hours][], oldest first (rows arrive month-ordered).
  const byArtist = new Map<string, [number, number][]>();
  for (const r of rows) {
    const list = byArtist.get(r.name);
    const entry: [number, number] = [monthIndex.get(r.month) as number, r.hours];
    if (list) list.push(entry);
    else byArtist.set(r.name, [entry]);
  }

  const cumulative = new Map<string, number>();
  const cursor = new Map<string, number>(); // artist -> next unread entry (cumulative mode)

  return months.map((month, i) => {
    const entries: { label: string; value: number }[] = [];
    for (const [name, list] of byArtist) {
      let value = 0;
      if (mode === "cumulative") {
        let at = cursor.get(name) ?? 0;
        let total = cumulative.get(name) ?? 0;
        while (at < list.length && list[at][0] <= i) total += list[at++][1];
        cursor.set(name, at);
        cumulative.set(name, total);
        value = total;
      } else {
        for (const [m, hours] of list) {
          if (m > i) break;
          value += hours * recencyWeight(daysBetween(months[m], month));
        }
      }
      if (value > 0) entries.push({ label: name, value });
    }
    entries.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    return { date: parseDate(month), entries: entries.slice(0, FRAMES_KEEP) };
  });
}

function nextMonth(month: string): string {
  const d = parseDate(month);
  return toDateString(new Date(d.getFullYear(), d.getMonth() + 1, 1));
}

// --- Colour ------------------------------------------------------------------
//
// Bars are coloured by the artist's top genre (decided on #295). Spotify's
// genre vocabulary runs to hundreds of tags and the palette has five real
// slots, so only the five genres with the most listening get one; every
// other genre — and every artist with none — folds to the muted neutral,
// never a cycled hue (viz/color.ts).

export type ArtistGenreRow = { artist: string; genre: string; genreHours: number };

export type GenreColoring = {
  /** Artist name -> palette slot, only for artists whose top genre earned one. */
  slotByArtist: Record<string, number>;
  /** The slotted genres, in slot order, for the legend. */
  legend: { genre: string; slot: number }[];
};

export async function getArtistGenreRows(): Promise<ArtistGenreRow[]> {
  const result = await getDb().execute(sql`
    with genre_time as (
      select ag.genre_id, sum(l.ms_played) as ms
      from artist_genres ag join music_listens l on l.artist_id = ag.artist_id
      group by ag.genre_id
    )
    select a.name as artist, g.name as genre, gt.ms
    from artist_genres ag
    join artists a on a.id = ag.artist_id
    join genres g on g.id = ag.genre_id
    join genre_time gt on gt.genre_id = ag.genre_id
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
    artist: string;
    genre: string;
    ms: string | number;
  }[];
  return rows.map((r) => ({ artist: r.artist, genre: r.genre, genreHours: Number(r.ms) / MS_PER_HOUR }));
}

/**
 * Each artist's top genre is the one of theirs with the most listening
 * across the whole library (so "top" means the same thing for every artist,
 * rather than depending on tag order, which Spotify doesn't define). The
 * library's top `CATEGORICAL_SLOT_COUNT` genres get slots; ties break by
 * genre name so the assignment is stable.
 */
export function colorArtistsByTopGenre(rows: ArtistGenreRow[]): GenreColoring {
  const hoursByGenre = new Map<string, number>();
  for (const r of rows) hoursByGenre.set(r.genre, r.genreHours);
  const ranked = [...hoursByGenre.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g);
  const slotOfGenre = new Map(ranked.slice(0, CATEGORICAL_SLOT_COUNT).map((g, i) => [g, i]));
  const rankOfGenre = new Map(ranked.map((g, i) => [g, i]));

  const best = new Map<string, string>(); // artist -> highest-ranked genre
  for (const r of rows) {
    const current = best.get(r.artist);
    if (current === undefined || (rankOfGenre.get(r.genre) as number) < (rankOfGenre.get(current) as number)) {
      best.set(r.artist, r.genre);
    }
  }

  const slotByArtist: Record<string, number> = {};
  for (const [artist, genre] of best) {
    const slot = slotOfGenre.get(genre);
    if (slot !== undefined) slotByArtist[artist] = slot;
  }
  return { slotByArtist, legend: [...slotOfGenre.entries()].map(([genre, slot]) => ({ genre, slot })) };
}
