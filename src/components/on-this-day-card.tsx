import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OnThisDayHighlight, OnThisDayYear } from "@/lib/on-this-day";
import { formatDate } from "@/lib/viz/format";

// Home's "on this day" teaser (#522). One line by design: the scope on
// #522 keeps Home to the single strongest moment and moves everything else
// to /on-this-day, which this card is the only way into (no section-link
// tile — it's a daily surface, not a section).
//
// Because it's the only way in, it always renders. The first cut hid it on
// a date with no highlight, which left /on-this-day unreachable on exactly
// the days you'd want to browse past dates — so a quiet date gets one muted
// line instead of a highlight, and the link stays.
//
// `OnThisDayYearCard` below is the full page's per-year card, kept beside
// it so the two surfaces format a moment the same way.

export function yearsAgoLabel(yearsAgo: number): string {
  return yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
}

export function OnThisDayCard({ highlight }: { highlight: OnThisDayHighlight | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>On this day</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {highlight ? (
          <Link href={highlight.href} className="group flex flex-col gap-0.5">
            <span className="font-medium group-hover:underline">{highlight.moment.headline}</span>
            <span className="text-sm text-muted-foreground">
              {yearsAgoLabel(highlight.yearsAgo)} · {formatDate(highlight.moment.date, "dayYear")}
              {highlight.moment.detail ? ` · ${highlight.moment.detail}` : null}
            </span>
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing standout on this date in past years.</p>
        )}
        <Link href="/on-this-day" className="text-sm text-muted-foreground hover:text-foreground">
          See all years &rarr;
        </Link>
      </CardContent>
    </Card>
  );
}

export function OnThisDayYearCard({ entry }: { entry: OnThisDayYear }) {
  const { moment, facts } = entry;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-3">
          <span>{entry.year}</span>
          <span className="text-sm font-normal text-muted-foreground">
            {yearsAgoLabel(entry.yearsAgo)} · {formatDate(entry.date, "weekdayYear")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {moment ? (
          <Link
            href={`/day/${moment.date}`}
            className="group flex flex-col gap-0.5 border-l-2 border-primary pl-3"
          >
            <span className="font-medium group-hover:underline">{moment.headline}</span>
            {moment.detail ? (
              <span className="text-sm text-muted-foreground">{moment.detail}</span>
            ) : null}
          </Link>
        ) : null}

        {facts ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {facts.happiness !== null ? (
              <>
                <dt className="text-muted-foreground">Happiness</dt>
                <dd className="tabular-nums">{facts.happiness} / 100</dd>
              </>
            ) : null}
            {facts.places.length > 0 ? (
              <>
                <dt className="text-muted-foreground">Where</dt>
                <dd>{facts.places.join(", ")}</dd>
              </>
            ) : null}
            {facts.people.length > 0 ? (
              <>
                <dt className="text-muted-foreground">With</dt>
                <dd>{facts.people.join(", ")}</dd>
              </>
            ) : null}
          </dl>
        ) : null}

        <div className="flex gap-4 text-sm">
          {facts ? (
            <Link href={`/day/${entry.date}`} className="text-muted-foreground hover:text-foreground">
              Open day &rarr;
            </Link>
          ) : null}
          {entry.recapHref ? (
            <Link href={entry.recapHref} className="text-muted-foreground hover:text-foreground">
              {entry.year} recap &rarr;
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
