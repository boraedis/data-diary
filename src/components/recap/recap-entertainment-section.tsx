import { ChartCard } from "@/components/charts/chart-card";
import { RecapStatCard } from "@/components/recap/recap-stat-card";
import { MIN_DAYS_FOR_TOTAL, toRecapStat } from "@/lib/recap";
import type { RecapEntertainment } from "@/lib/recap-entertainment";

// The entertainment section of the recap report (issue #171, epic #130).
//
// Every total goes through the foundation's `toRecapStat` with the count
// itself standing in as the coverage number. That's what makes an
// untracked medium behave: a year before the Spotify import reads
// "Nothing logged this period" rather than a confident zero, and its
// year-over-year line disappears instead of comparing against a year the
// medium didn't exist in.

/** The first year a medium is tracked, *everything* in it is technically a
 * first — true, but a fifteen-genre list stops being a highlight. Cap the
 * named ones and count the rest. */
const MAX_LISTED_GENRES = 4;

export function RecapEntertainmentSection({
  entertainment,
  periodLabel,
  priorLabel,
}: {
  entertainment: RecapEntertainment;
  periodLabel: string;
  priorLabel: string;
}) {
  const { totals, topMovie, topBook, topArtist, topGenre, firsts } = entertainment;
  // A medium with nothing in either period isn't a gap worth a tile — it's
  // something this diary has never tracked. Dropping it keeps the section
  // about the year rather than about the schema.
  const tracked = totals.filter((total) => total.count > 0 || total.priorCount > 0);
  const highlights = [
    topMovie ? { label: "Best film watched", value: topMovie.title, note: `#${topMovie.rank} all-time` } : null,
    topBook ? { label: "Best book read", value: topBook.title, note: `#${topBook.rank} all-time` } : null,
    topArtist
      ? { label: "Top artist", value: topArtist.name, note: `${formatMinutes(topArtist.minutes)} listened` }
      : null,
    topGenre
      ? { label: "Top genre", value: topGenre.name, note: `${formatMinutes(topGenre.minutes)} listened` }
      : null,
  ].filter((item) => item !== null);

  const hasFirsts = firsts.newArtists.total > 0 || firsts.newMovieGenres.length > 0;

  return (
    <ChartCard
      title="Entertainment"
      description={`What you watched, read, played and listened to in ${periodLabel}.`}
      empty={tracked.length === 0}
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tracked.map((total) => (
            <RecapStatCard
              key={total.key}
              label={total.label}
              unit={total.unit}
              priorLabel={priorLabel}
              stat={toRecapStat({
                value: total.count,
                loggedDays: total.count,
                requiredDays: MIN_DAYS_FOR_TOTAL,
                prior: total.priorCount,
                priorLoggedDays: total.priorCount,
              })}
            />
          ))}
        </div>

        {highlights.length > 0 ? (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {highlights.map((item) => (
              <div key={item.label} className="flex flex-col gap-0.5">
                <dt className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
                  {item.label}
                </dt>
                <dd className="text-lg font-medium">{item.value}</dd>
                <dd className="text-xs text-muted-foreground">{item.note}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {hasFirsts ? (
          <div className="flex flex-col gap-1 border-t border-border/60 pt-4">
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Firsts
            </p>
            {firsts.newArtists.total > 0 ? (
              <p className="text-sm">
                {firsts.newArtists.total} new artist{firsts.newArtists.total === 1 ? "" : "s"}
                {firsts.newArtists.examples.length > 0
                  ? ` — starting with ${listSentence(firsts.newArtists.examples)}`
                  : ""}
              </p>
            ) : null}
            {firsts.newMovieGenres.length > 0 ? (
              <p className="text-sm">
                First film in {listSentence(firsts.newMovieGenres.slice(0, MAX_LISTED_GENRES))}
                {firsts.newMovieGenres.length > MAX_LISTED_GENRES
                  ? ` and ${firsts.newMovieGenres.length - MAX_LISTED_GENRES} more`
                  : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </ChartCard>
  );
}

/** Listening time reads better in hours once it stops being a lunch break —
 * "31,000 minutes" is a number nobody converts in their head. */
function formatMinutes(minutes: number): string {
  if (minutes < 90) return `${minutes} min`;
  return `${Math.round(minutes / 60).toLocaleString()} hours`;
}

function listSentence(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
