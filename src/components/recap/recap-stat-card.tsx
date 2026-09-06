import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercent, formatThousandsNumber } from "@/lib/viz/format";
import type { RecapStat } from "@/lib/recap";

// The recap's "flashpoint" presentation (issue #169, epic #130): a big
// absolute number first, with the comparative line demoted to a secondary
// row underneath. #130 is explicit that the raw number leads and the
// year-over-year delta supports it, never the other way round.
//
// Every domain card in this epic renders through this component rather than
// hand-rolling a tile, so the two states that are easy to get subtly wrong —
// "no prior period to compare against" and "not enough data logged" — look
// and read the same everywhere, and only have to be right once.

// The delta is deliberately uncolored — its direction is carried by the
// words ("more"/"less than 2024"), not by a hue.
//
// Two reasons. Most recap numbers (movies watched, places visited, people
// logged) carry no judgment about whether more is better, so a green/red
// treatment would invent an opinion the recap doesn't have. And this app's
// palette has no status colors to borrow: `--chart-1..5` are the fixed
// categorical slots, which the dataviz skill forbids reusing as status, and
// `--destructive` means error, not "slept less than last year". Adding a
// real good/warning/serious/critical ramp is a palette change, and this
// repo runs those through the dataviz validator before trusting them (see
// AGENTS.md) — out of scope for a foundation PR. A later card that truly
// needs sentiment color should do that work first.

export function RecapStatCard({
  label,
  stat,
  format = formatThousandsNumber,
  unit,
  priorLabel,
  detail,
  preserveLabelCase = false,
}: {
  /** Sentence case, no trailing colon (dataviz stat-tile contract). */
  label: string;
  stat: RecapStat<number>;
  /** How to render the raw value; defaults to a thousands-separated
   * integer. Pass a formatter for durations, scores out of 100, etc. */
  format?: (value: number) => string;
  /** Short trailing unit ("days", "movies") — kept out of `format` so the
   * value and its unit can be typeset at different sizes. */
  unit?: string;
  /** What the comparison is against, named rather than implied — "2024",
   * not "last period". */
  priorLabel?: string;
  /** Optional supporting line under the delta (a date, a name). */
  detail?: string;
  /** Keeps the label's own capitalization instead of the small-caps
   * treatment. For labels that are names rather than prose: the tracked
   * subs are written "Ni", "NO" and "Ad", and uppercasing them throws away
   * a distinction the user actually made. */
  preserveLabelCase?: boolean;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-1">
        <CardTitle
          className={`text-xs font-medium tracking-widest text-muted-foreground ${
            preserveLabelCase ? "" : "uppercase"
          }`}
        >
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {stat.status === "insufficient" ? (
          <InsufficientData loggedDays={stat.loggedDays} requiredDays={stat.requiredDays} />
        ) : (
          <>
            <p className="flex items-baseline gap-1.5">
              {/* Proportional figures, not `tabular-nums`: at display sizes
                  tabular figures pad every digit to the width of a zero,
                  which makes a standalone number read loose and gappy.
                  Tabular is for columns that must align vertically. */}
              <span className="text-3xl font-semibold md:text-4xl">{format(stat.value)}</span>
              {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
            </p>
            <Delta value={stat.value} prior={stat.prior} priorLabel={priorLabel} format={format} />
            {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The earliest period with data has nothing behind it. #130 calls this out
 * as a state to design for rather than patch later, so it gets its own copy
 * instead of rendering a 0% change or an em-dash that reads like a bug. */
function Delta({
  value,
  prior,
  priorLabel,
  format,
}: {
  value: number;
  prior: number | null;
  priorLabel?: string;
  format: (value: number) => string;
}) {
  if (prior === null) {
    return <p className="text-xs text-muted-foreground">No earlier period to compare</p>;
  }

  const difference = value - prior;
  const named = priorLabel ?? "the period before";

  // "Same as", not "same than" — the comparative and the equality case take
  // different prepositions, so they can't share one suffix string.
  if (difference === 0) {
    return <p className="text-xs text-muted-foreground">Same as {named}</p>;
  }

  // If the two values render identically at this card's own precision, the
  // change isn't visible on the card that states it — an average happiness
  // of 88.28 against 88.05 both read "88", and "0.228 less than 2024" is
  // noise dressed up as a finding. Precision-aware rather than a fixed
  // epsilon, so a card showing whole days and one showing hours each get
  // the right answer.
  if (format(value) === format(prior)) {
    return <p className="text-xs text-muted-foreground">About the same as {named}</p>;
  }

  // A percentage needs a non-zero base to mean anything (going from 0 to 12
  // is not "+1200%", it's "12 more"), and it also has to survive rounding:
  // 365 days logged against a 366-day leap year is a real one-day
  // difference that renders as "0% less", which reads as a bug rather than
  // as a small change. Below whole-percent resolution the absolute
  // difference is the honest number — formatted the same way the value is,
  // so a duration card says "12m more" and not "12".
  const share = Math.abs(difference) / Math.abs(prior);
  const magnitude =
    prior !== 0 && share >= 0.005 ? formatPercent(share) : format(Math.abs(difference));
  const direction = difference > 0 ? "more" : "less";

  return (
    <p className="text-xs text-muted-foreground">
      {magnitude} {direction} than {named}
    </p>
  );
}

/** Coverage in this app is genuinely uneven year to year (subs, the
 * entertainment tables and the music import all started at different
 * points), so this is a normal outcome for an early year — worded as a fact
 * about the log, not as an error. */
function InsufficientData({ loggedDays, requiredDays }: { loggedDays: number; requiredDays: number }) {
  return (
    <p className="py-2 text-sm text-muted-foreground">
      {loggedDays === 0
        ? "Nothing logged this period."
        : `Only ${loggedDays} day${loggedDays === 1 ? "" : "s"} logged — needs ${requiredDays}.`}
    </p>
  );
}
