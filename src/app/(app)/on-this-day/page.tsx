import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { yearsAgoLabel } from "@/components/on-this-day-card";
import { todayDateString } from "@/lib/date";
import {
  getOnThisDay,
  monthDayOf,
  parseMonthDay,
  shiftMonthDay,
  WINDOW_DAYS,
  type OnThisDayYear,
} from "@/lib/on-this-day";
import { formatDate } from "@/lib/viz/format";

// The full "on this day" view (#522) — every past year for one month-day,
// newest first. Home's card is the teaser and the only link in; this page
// is where the fallback facts and the happiness dips Home leaves out live.
//
// `?date=MM-DD`, defaulting to today. Prev/next step one calendar day and
// wrap across the year end; a full date picker was left out of v1 on
// purpose (scope on #522) — stepping covers "what about tomorrow".
//
// "Today" is the server's date, same as the rest of Home; on Vercel that's
// UTC, so late in the evening west of Greenwich this opens on tomorrow.
// The arrows are the escape hatch, and Home's Recent days has the same
// behavior, so the two at least agree.

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** "Oct 3" from a month-day, via a leap year so "02-29" formats too. */
function monthDayLabel(monthDay: string): string {
  return formatDate(`2000-${monthDay}`, "short");
}

export default async function OnThisDayPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const today = todayDateString();
  const todayMonthDay = monthDayOf(today);
  const raw = first((await searchParams).date);
  // A hand-typed bad value 404s rather than silently showing today — same
  // rule as the recap's year/month segments.
  const monthDay = raw === undefined ? todayMonthDay : parseMonthDay(raw);
  if (monthDay === null) notFound();

  const years = await getOnThisDay(monthDay, today);
  const prev = shiftMonthDay(monthDay, -1);
  const next = shiftMonthDay(monthDay, 1);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/on-this-day?date=${prev}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          aria-label={`Previous day, ${monthDayLabel(prev)}`}
        >
          &larr; {monthDayLabel(prev)}
        </Link>
        <div className="flex flex-col items-center text-center">
          <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
            On this day
          </h1>
          <p className="text-sm text-muted-foreground">
            {monthDayLabel(monthDay)}
            {monthDay === todayMonthDay ? " · today" : null}
          </p>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <Link href="/home" className="hover:text-foreground">
              Home
            </Link>
            {monthDay === todayMonthDay ? null : (
              <Link href="/on-this-day" className="hover:text-foreground">
                Back to today
              </Link>
            )}
          </div>
        </div>
        <Link
          href={`/on-this-day?date=${next}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          aria-label={`Next day, ${monthDayLabel(next)}`}
        >
          {monthDayLabel(next)} &rarr;
        </Link>
      </div>

      {years.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          Nothing logged on {monthDayLabel(monthDay)} in any past year.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {years.map((entry) => (
              <li key={entry.year}>
                <YearCard entry={entry} />
              </li>
            ))}
          </ul>
          <p className="text-center text-xs text-muted-foreground">
            Highlights are the recap&rsquo;s automatic moments within {WINDOW_DAYS} days of the
            date. Feb 29 shows Feb 28 in other years.
          </p>
        </>
      )}
    </main>
  );
}

function YearCard({ entry }: { entry: OnThisDayYear }) {
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
            <span className="text-sm text-muted-foreground">
              {/* The moment can sit a few days off the date — say which. */}
              {moment.date === entry.date ? "On the day" : formatDate(moment.date, "weekday")}
              {moment.detail ? ` · ${moment.detail}` : null}
            </span>
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
