import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { addDays, todayDateString } from "@/lib/date";

// The TV backlog over time — how many aired episodes of shows I follow
// were still unwatched on each day (#222's `unwatched_episodes`, decided to
// stay a /charts page, not a /manage tracker).
//
// An episode counts as backlog on day D when ALL of these hold:
//   - it had aired (`air_date <= D`);
//   - I was following its show: from the show's first *dated* watch, until
//     it was dropped (`uninterested_date`) if it ever was;
//   - I hadn't watched it yet (its first dated watch is after D).
// Each episode therefore contributes at most one interval [enter, exit),
// so the whole series is a running sum of +1/-1 events.
//
// **Where "following" starts is a judgement call.** Nothing records when a
// show was added (`created_at` is the migration time for the legacy ones),
// so the first dated watch stands in. Consequence worth knowing: on that
// day every already-aired episode of the show that I haven't watched joins
// the backlog at once, so a long-running show shows up as a step, not a
// ramp.
//
// **Left out entirely:** episodes with no air date (can't place them); any
// episode with an undated watch (the legacy "watched before I tracked"
// mark — it was never backlog); and shows with no dated watch at all (no
// start). Shows I'm following but that are fully caught up contribute zero.
//
// **Dropped shows** leave the backlog on their `uninterested_date`. Legacy
// shows marked not-interested often have none, so those leave on the day of
// their last dated watch instead — the last evidence I was still following
// them. (An earlier version left such shows out entirely, which made every
// show dropped before that date was recorded vanish from the chart.)
//
// Aggregated to events in SQL, so thousands of episodes never leave the
// database; only a (day, show, net change) row wherever something moved.

export type BacklogEvent = { date: string; showId: string; title: string; delta: number };
export type BacklogBand = { id: string; label: string };
/** One calendar day: the backlog per show, only for shows with any (a
 * caught-up show is simply absent, not a zero entry — a show with a
 * thousand quiet days would otherwise ship a thousand zeros). */
export type BacklogDay = { date: string; values: Record<string, number> };
export type BacklogSeries = { bands: BacklogBand[]; days: BacklogDay[] };

export async function getBacklogEvents(): Promise<BacklogEvent[]> {
  const result = await getDb().execute(sql`
    with starts as (
      select e.show_id, min(w.date) as start, max(w.date) as last
      from tv_episode_watches w join tv_episodes e on e.id = w.episode_id
      where w.date is not null
      group by e.show_id
    ),
    spans as (
      select sh.id as show_id, sh.title,
             greatest(e.air_date, s.start) as enter,
             least(
               min(w.date),
               -- Dropped: the recorded drop date, else (legacy shows often
               -- have none) the day of the show's last dated watch.
               case when sh.interested then null else coalesce(sh.uninterested_date, s.last) end
             ) as exit,
             bool_or(w.id is not null and w.date is null) as undated
      from tv_episodes e
      join tv_shows sh on sh.id = e.show_id
      join starts s on s.show_id = e.show_id
      left join tv_episode_watches w on w.episode_id = e.id
      where e.air_date is not null
      group by e.id, e.air_date, s.start, s.last, sh.id, sh.title, sh.interested, sh.uninterested_date
    ),
    live as (
      select show_id, title, enter, exit from spans where not undated and (exit is null or enter < exit)
    )
    select to_char(d, 'YYYY-MM-DD') as date, show_id::text as "showId", title, sum(delta)::int as delta
    from (
      select show_id, title, enter as d, 1 as delta from live
      union all
      select show_id, title, exit as d, -1 as delta from live where exit is not null
    ) ev
    group by d, show_id, title
    order by d
  `);
  return (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as BacklogEvent[];
}

/** Running sums of the events as one row per calendar day, quiet days
 * included, from the first event to `through` (default today). Events after
 * `through` — episodes yet to air — don't appear. Bands come out biggest
 * show first, by total episode-days in the backlog. Pure, so it's testable
 * without a database. */
export function buildBacklogSeries(events: BacklogEvent[], through: string = todayDateString()): BacklogSeries {
  if (events.length === 0) return { bands: [], days: [] };
  const byDate = new Map<string, BacklogEvent[]>();
  for (const e of events) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }
  const first = [...byDate.keys()].sort()[0];

  const level = new Map<string, number>();
  const titles = new Map<string, string>();
  const totals = new Map<string, number>();
  const days: BacklogDay[] = [];
  for (let date = first; date <= through; date = addDays(date, 1)) {
    for (const e of byDate.get(date) ?? []) {
      level.set(e.showId, (level.get(e.showId) ?? 0) + Number(e.delta));
      titles.set(e.showId, e.title);
    }
    const values: Record<string, number> = {};
    for (const [id, n] of level) {
      if (n <= 0) continue;
      values[id] = n;
      totals.set(id, (totals.get(id) ?? 0) + n);
    }
    days.push({ date, values });
  }
  const bands = [...totals.keys()]
    .sort((a, b) => (totals.get(b) as number) - (totals.get(a) as number))
    .map((id) => ({ id, label: titles.get(id) as string }));
  return { bands, days };
}
