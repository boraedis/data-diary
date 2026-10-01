import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { AREA_MAX_BANDS, AREA_OTHER_ID } from "@/lib/viz/area-fold";

// Listening time over time, for the Music Trend stacked area (#222).
//
// **Aggregated in SQL to one row per (month, band).** ~100k listens never
// leave the database, the same boundary src/lib/leaderboards/listens.ts
// draws. Month is the finest bucket: the chart's period picker re-buckets
// these into quarters/years client-side (viz/bin.ts), but a weekly view
// would mean a row per (week, artist) for thousands of artists, for a
// stack nobody can read at that grain anyway.
//
// **Time, not play count**, summed from `ms_played` — the same measure the
// leaderboards and the recap rank by (src/lib/music.ts), so a band here is
// the same size as that artist's row there. Importing never stores a listen
// under MIN_LISTEN_MS, so there's no skip threshold to reapply.
//
// **Months are UTC.** Listens carry a timestamp, not a day, and this data
// records no timezone to bucket in (see leaderboards/listens.ts). A listen
// within hours of a month boundary can land a month either side of where it
// was heard — immaterial at this scale.
//
// **Only the dimensions that partition.** A stack must sum to the real
// total, and an artist carries several Spotify genre tags (and sometimes
// several genre groups), so stacking by genre would count a listen once per
// tag. Artist is single-valued per listen, so it partitions as is. Genre
// group is the genre view: each listen's time is split *evenly* across the
// distinct groups its artist belongs to, so a listen of an artist in two
// groups puts half in each and the stack still equals total listening.
// That differs on purpose from the Music Leaderboard, which credits a
// listen in full to every genre — right for "how much of what I play is
// dream pop", wrong for a stack whose height is the total. Podcast listens
// have no artist and are excluded, so this is music only.

export type MusicTrendMode = "artist" | "group";

export type MusicTrendRow = {
  /** First of the month, "YYYY-MM-DD". */
  date: string;
  /** Band id: an artist id, a genre group id, or `AREA_OTHER_ID`. */
  id: string;
  hours: number;
};

export type MusicTrendBand = { id: string; label: string; color: string | null };

export type MusicTrendData = {
  rows: MusicTrendRow[];
  /** Bands in the order they stack (biggest first). */
  bands: MusicTrendBand[];
};

/** Group id for artists whose genres have no group (or no genres at all):
 * not a real `genre_groups` row, so it can't collide with a numeric id. */
export const NO_GROUP_ID = "__none__";

const MS_PER_HOUR = 3_600_000;

// One short of the chart's own band cap, so the Other band this folds into
// still leaves the total at the cap — otherwise InteractiveArea would fold
// again and mint a second "Other" with the same id.
const ARTIST_BANDS = AREA_MAX_BANDS - 1;

type RawRow = { month: string; id: string; label: string; color: string | null; ms: string | number };

function toData(raw: RawRow[]): MusicTrendData {
  const totals = new Map<string, number>();
  const meta = new Map<string, MusicTrendBand>();
  const rows: MusicTrendRow[] = raw.map((r) => {
    const hours = Number(r.ms) / MS_PER_HOUR;
    totals.set(r.id, (totals.get(r.id) ?? 0) + hours);
    if (!meta.has(r.id)) meta.set(r.id, { id: r.id, label: r.label, color: r.color });
    return { date: r.month, id: r.id, hours };
  });
  // "Other" is a remainder, not a peer — always on top, whatever its size.
  const bands = [...meta.values()].sort((a, b) => {
    if (a.id === AREA_OTHER_ID) return 1;
    if (b.id === AREA_OTHER_ID) return -1;
    return (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0);
  });
  return { rows, bands };
}

async function run(query: ReturnType<typeof sql>): Promise<RawRow[]> {
  const result = await getDb().execute(query);
  return (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as RawRow[];
}

/** Hours per month for each of the `ARTIST_BANDS` most-listened artists,
 * with every other artist folded into one Other band here in SQL — the
 * chart would fold the same tail anyway, and this way thousands of
 * single-listen artists never cross the wire. */
export async function getMusicTrendByArtist(): Promise<MusicTrendData> {
  const raw = await run(sql`
    with per_artist as (
      select l.artist_id, a.name,
             to_char(date_trunc('month', l.played_at at time zone 'UTC'), 'YYYY-MM-DD') as month,
             sum(l.ms_played) as ms
      from music_listens l join artists a on a.id = l.artist_id
      group by l.artist_id, a.name, 2
    ),
    ranked as (
      select artist_id, row_number() over (order by sum(ms) desc, artist_id) as rank
      from per_artist group by artist_id
    )
    select p.month,
           case when r.rank <= ${ARTIST_BANDS} then p.artist_id::text else ${AREA_OTHER_ID} end as id,
           case when r.rank <= ${ARTIST_BANDS} then p.name else 'Other' end as label,
           null::text as color,
           sum(p.ms) as ms
    from per_artist p join ranked r on r.artist_id = p.artist_id
    group by 1, 2, 3
    order by 1
  `);
  return toData(raw);
}

/** Hours per month for each genre group, each listen split evenly across
 * its artist's distinct groups (see the header). An artist whose genres
 * have no group, or who has no genres, is one "No group" share. */
export async function getMusicTrendByGroup(): Promise<MusicTrendData> {
  const raw = await run(sql`
    with artist_groups as (
      select a.id as artist_id, x.group_id,
             count(*) over (partition by a.id) as shares
      from artists a
      left join (
        select distinct ag.artist_id, g.group_id
        from artist_genres ag join genres g on g.id = ag.genre_id
      ) x on x.artist_id = a.id
    )
    select to_char(date_trunc('month', l.played_at at time zone 'UTC'), 'YYYY-MM-DD') as month,
           coalesce(gg.id::text, ${NO_GROUP_ID}) as id,
           coalesce(gg.name, 'No group') as label,
           gg.color as color,
           sum(l.ms_played::numeric / ag.shares) as ms
    from music_listens l
    join artist_groups ag on ag.artist_id = l.artist_id
    left join genre_groups gg on gg.id = ag.group_id
    group by 1, 2, 3, 4
    order by 1
  `);
  return toData(raw);
}
