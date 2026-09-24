import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { rankSnapshots, STANDARD_RANK_WINDOWS, type RankSnapshot } from "@/lib/ranking";
import { toLeaderboardRows, type LeaderboardColumns, type LeaderboardRow } from "@/lib/leaderboards/rows";
import type { LeaderboardOption } from "@/lib/leaderboards/options";

// Music and podcast leaderboards (#115), from the Spotify listen history.
//
// **Aggregated in SQL, unlike every other leaderboard.** There are ~100k
// listens against a few thousand days or sessions everywhere else, and
// song mode alone is ~17k keys. So instead of shipping listens to
// `computeRankings`, each query sums straight to one `RankSnapshot` per
// key — the total now, and the total as it stood at each window's start
// (`sum(...) filter (where played_at <= cutoff)`) — and `rankSnapshots`
// does the ranking. Same movement definition as every other table; the
// listens just never leave the database.
//
// **Windows anchor on the latest listen**, not today — Spotify history
// arrives by periodic export, so "a week ago" relative to today would
// usually fall after the last imported listen and read as no movement.
// Cutoffs are timestamps (latest listen minus N days) rather than calendar
// days: listens carry a time, and the day boundary would need a timezone
// this data doesn't record.
//
// **Genres credit in full.** An artist tagged both "indie pop" and "dream
// pop" counts every listen toward both genres, so genre totals sum past
// the real listening total. That's the right reading for a ranking ("how
// much of what I play is dream pop") where splitting a listen into
// fractions would understate every multi-genre artist. Genre *groups*
// credit each listen once per group, not once per genre inside it.

export type MusicMode = "artist" | "album" | "song" | "group" | "genre";

export const MUSIC_MODES: LeaderboardOption<MusicMode>[] = [
  { id: "artist", label: "Artists" },
  { id: "album", label: "Albums" },
  { id: "song", label: "Songs" },
  { id: "group", label: "Genre Groups" },
  { id: "genre", label: "Genres" },
];

export type PodcastMode = "show" | "episode" | "category";

export const PODCAST_MODES: LeaderboardOption<PodcastMode>[] = [
  { id: "show", label: "Shows" },
  { id: "episode", label: "Episodes" },
  { id: "category", label: "Categories" },
];

/** One mode's query: what a listen is credited to and how it's labelled.
 * Every fragment may reference the listen as `l`; `key` must determine
 * `name`/`detail`/`color`, since all four are grouped on. */
type ListenQuery = { key: SQL; name: SQL; detail: SQL; color: SQL; from: SQL; where?: SQL };

const MS_PER_HOUR = 3_600_000;

// chr(31) (unit separator) joins composite keys: a title can contain any
// printable character, and Postgres text can't hold the NUL a JS key
// would normally use.
const MUSIC_QUERIES: Record<MusicMode, ListenQuery> = {
  artist: {
    key: sql`l.artist_id::text`,
    name: sql`a.name`,
    detail: sql`null::text`,
    color: sql`null::text`,
    from: sql`music_listens l join artists a on a.id = l.artist_id`,
  },
  album: {
    // Keyed with the artist: "Greatest Hits" is dozens of albums.
    key: sql`concat_ws(chr(31), l.album_name, l.artist_id)`,
    name: sql`l.album_name`,
    detail: sql`a.name`,
    color: sql`null::text`,
    from: sql`music_listens l left join artists a on a.id = l.artist_id`,
    where: sql`l.album_name is not null`,
  },
  song: {
    key: sql`concat_ws(chr(31), l.track_name, l.artist_id)`,
    name: sql`l.track_name`,
    detail: sql`a.name`,
    color: sql`null::text`,
    from: sql`music_listens l left join artists a on a.id = l.artist_id`,
  },
  group: {
    key: sql`gg.id::text`,
    name: sql`gg.name`,
    detail: sql`null::text`,
    color: sql`gg.color`,
    // Distinct (artist, group) first, so an artist with three genres in
    // one group doesn't count each listen three times toward it.
    from: sql`music_listens l
      join (
        select distinct ag.artist_id, g.group_id
        from artist_genres ag join genres g on g.id = ag.genre_id
        where g.group_id is not null
      ) ag on ag.artist_id = l.artist_id
      join genre_groups gg on gg.id = ag.group_id`,
  },
  genre: {
    key: sql`g.id::text`,
    name: sql`g.name`,
    detail: sql`gg.name`,
    color: sql`gg.color`,
    from: sql`music_listens l
      join artist_genres ag on ag.artist_id = l.artist_id
      join genres g on g.id = ag.genre_id
      left join genre_groups gg on gg.id = g.group_id`,
  },
};

const PODCAST_QUERIES: Record<PodcastMode, ListenQuery> = {
  show: {
    key: sql`s.id::text`,
    name: sql`s.name`,
    detail: sql`c.name`,
    color: sql`null::text`,
    from: sql`music_listens l
      join podcast_shows s on s.id = l.podcast_show_id
      left join podcast_categories c on c.id = s.category_id`,
  },
  episode: {
    key: sql`concat_ws(chr(31), l.episode_name, l.podcast_show_id)`,
    name: sql`l.episode_name`,
    detail: sql`s.name`,
    color: sql`null::text`,
    from: sql`music_listens l left join podcast_shows s on s.id = l.podcast_show_id`,
  },
  category: {
    key: sql`coalesce(c.id::text, 'none')`,
    name: sql`coalesce(c.name, 'Uncategorized')`,
    detail: sql`null::text`,
    color: sql`null::text`,
    from: sql`music_listens l
      join podcast_shows s on s.id = l.podcast_show_id
      left join podcast_categories c on c.id = s.category_id`,
  },
};

type SnapshotRow = {
  key: string;
  name: string | null;
  detail: string | null;
  color: string | null;
  total: number | string;
  plays: number | string;
} & Record<string, number | string | null>;

async function listenLeaderboard(query: ListenQuery, kind: SQL): Promise<LeaderboardRow[]> {
  const db = getDb();
  const beforeColumns = sql.join(
    STANDARD_RANK_WINDOWS.map(
      (w) =>
        // `days` comes from a constant, never user input — sql.raw is safe.
        sql`sum(l.ms_played) filter (where l.played_at <= b.as_of - interval '${sql.raw(String(w.days))} days')::float8 as ${sql.identifier(`before_${w.id}`)}`,
    ),
    sql`, `,
  );
  const result = await db.execute(sql`
    with b as (select max(l.played_at) as as_of from music_listens l where ${kind})
    select ${query.key} as key, ${query.name} as name, ${query.detail} as detail, ${query.color} as color,
      sum(l.ms_played)::float8 as total, count(*)::int as plays, ${beforeColumns}
    from ${query.from} cross join b
    where ${kind} ${query.where ? sql`and ${query.where}` : sql``}
    group by 1, 2, 3, 4
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as SnapshotRow[];

  const labels = new Map<string, { name: string; detail: string | null; color: string | null }>();
  const snapshots: RankSnapshot[] = rows.map((r) => {
    labels.set(r.key, { name: r.name ?? "Unknown", detail: r.detail, color: r.color });
    const before: Record<string, number | null> = {};
    for (const w of STANDARD_RANK_WINDOWS) {
      const v = r[`before_${w.id}`];
      before[w.id] = v === null || v === undefined ? null : Number(v) / MS_PER_HOUR;
    }
    return { key: r.key, total: Number(r.total) / MS_PER_HOUR, occurrences: Number(r.plays), before };
  });

  const ranked = rankSnapshots(snapshots, STANDARD_RANK_WINDOWS);
  return toLeaderboardRows(ranked, STANDARD_RANK_WINDOWS, (key) => labels.get(key) ?? { name: "Unknown" });
}

export function getMusicLeaderboardData(mode: MusicMode): Promise<LeaderboardRow[]> {
  return listenLeaderboard(MUSIC_QUERIES[mode], sql`l.track_name is not null`);
}

export function getPodcastLeaderboardData(mode: PodcastMode): Promise<LeaderboardRow[]> {
  return listenLeaderboard(PODCAST_QUERIES[mode], sql`l.episode_name is not null`);
}

const TIME = {
  valueHeader: "Time",
  valueDescription: "Total listening time.",
  valueFormat: "hours" as const,
  countHeader: "Plays",
  countDescription: "Every stream Spotify recorded, however short.",
  gainedNoun: "listening time gained",
};

export function musicColumns(mode: MusicMode): LeaderboardColumns {
  switch (mode) {
    case "artist":
      return { ...TIME, nameHeader: "Artist" };
    case "album":
      return { ...TIME, nameHeader: "Album" };
    case "song":
      return { ...TIME, nameHeader: "Song" };
    case "group":
      return {
        ...TIME,
        nameHeader: "Genre Group",
        valueDescription: "Listening time to artists in this group. An artist in several groups counts toward each.",
      };
    case "genre":
      return {
        ...TIME,
        nameHeader: "Genre",
        valueDescription:
          "Listening time to artists tagged with this genre. Artists carry several genres and count toward each, so these add up to more than total listening.",
      };
  }
}

export function podcastColumns(mode: PodcastMode): LeaderboardColumns {
  switch (mode) {
    case "show":
      return { ...TIME, nameHeader: "Show" };
    case "episode":
      return { ...TIME, nameHeader: "Episode" };
    case "category":
      return { ...TIME, nameHeader: "Category" };
  }
}
