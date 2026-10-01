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
// mark — it was never backlog); shows with no dated watch at all (no start);
// and shows marked not-interested with no drop date (can't place when they
// left). Shows I'm following but that are fully caught up contribute zero.
//
// Aggregated to events in SQL, so thousands of episodes never leave the
// database; only a (date, net change) row per day with any movement.

export type BacklogEvent = { date: string; delta: number };
export type BacklogDay = { date: string; backlog: number };

export async function getBacklogEvents(): Promise<BacklogEvent[]> {
  const result = await getDb().execute(sql`
    with starts as (
      select e.show_id, min(w.date) as start
      from tv_episode_watches w join tv_episodes e on e.id = w.episode_id
      where w.date is not null
      group by e.show_id
    ),
    spans as (
      select greatest(e.air_date, s.start) as enter,
             least(min(w.date), sh.uninterested_date) as exit,
             bool_or(w.id is not null and w.date is null) as undated
      from tv_episodes e
      join tv_shows sh on sh.id = e.show_id
      join starts s on s.show_id = e.show_id
      left join tv_episode_watches w on w.episode_id = e.id
      where e.air_date is not null
        and (sh.interested or sh.uninterested_date is not null)
      group by e.id, e.air_date, s.start, sh.uninterested_date
    ),
    live as (
      select enter, exit from spans where not undated and (exit is null or enter < exit)
    )
    select to_char(d, 'YYYY-MM-DD') as date, sum(delta)::int as delta
    from (
      select enter as d, 1 as delta from live
      union all
      select exit as d, -1 as delta from live where exit is not null
    ) ev
    group by d
    order by d
  `);
  return (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as BacklogEvent[];
}

/** Running sum of the events as one row per calendar day, zero-change days
 * included, from the first event to `through` (default today). Events after
 * `through` — episodes yet to air — don't appear. Pure, so it's testable
 * without a database. */
export function buildBacklogSeries(events: BacklogEvent[], through: string = todayDateString()): BacklogDay[] {
  if (events.length === 0) return [];
  const byDate = new Map<string, number>();
  for (const e of events) byDate.set(e.date, (byDate.get(e.date) ?? 0) + Number(e.delta));
  const first = [...byDate.keys()].sort()[0];
  const out: BacklogDay[] = [];
  let backlog = 0;
  for (let date = first; date <= through; date = addDays(date, 1)) {
    backlog += byDate.get(date) ?? 0;
    out.push({ date, backlog });
  }
  return out;
}
