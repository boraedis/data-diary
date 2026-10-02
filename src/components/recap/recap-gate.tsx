import Link from "next/link";
import { MarkRecapSeen } from "@/components/recap/mark-recap-seen";
import { RecapReport } from "@/components/recap/recap-report";
import { Card, CardContent } from "@/components/ui/card";
import { todayDateString } from "@/lib/date";
import { isPeriodPublished, periodPublishDate, type RecapPeriod } from "@/lib/recap";
import type { RecapChapter } from "@/lib/recap-chapters";
import { recapPeriodKey } from "@/lib/recap-seen";
import { formatDate } from "@/lib/viz/format";

// The publish gate's single point of application for a period's own page
// (#517). Both recap routes wrap their report in this rather than each
// re-deriving the rule, so a year, a month, and any future period kind
// behave identically.
//
// Three outcomes:
// - published → the report, untouched;
// - not published → a "ready on <date>" state. Deliberately not a 404 and
//   not a partial recap: the period is real and the answer — "not yet,
//   and here's when" — is true, the same reasoning that makes a
//   well-formed year with nothing logged render empty rather than 404;
// - not published but `preview` → the report under a banner saying so.
//   This is a single-user app, so the escape hatch is a plain `?preview=1`
//   rather than anything access-controlled. It exists so the owner can
//   peek at a month as it's going, and is labelled so a half-finished
//   recap is never mistaken for the real one.
//
// A life chapter (#519) passes `chapter` too. The rule is unchanged — its
// period ends on the chapter's end — but an ongoing chapter has no end to
// count from, so its waiting state says "still going" instead of a date,
// and it never touches the seen-badge set, which only knows calendar keys.

export function RecapGate({
  period,
  preview,
  chapter,
}: {
  period: RecapPeriod;
  preview: boolean;
  chapter?: RecapChapter;
}) {
  const today = todayDateString();
  // An ongoing chapter's period ends today (`chapterPeriod`), so the date
  // rule alone would publish it a few days from now, forever. It's in
  // progress until it has a real end.
  const ongoing = chapter !== undefined && chapter.end === null;
  if (!ongoing && isPeriodPublished(period, today)) {
    // Opening a published recap is what clears its "new" badge (#518). Not
    // done for a preview, which isn't the real recap.
    const key = chapter ? null : recapPeriodKey(period);
    return (
      <>
        {key !== null ? <MarkRecapSeen periodKey={key} /> : null}
        <RecapReport period={period} chapter={chapter} />
      </>
    );
  }

  if (preview) {
    return (
      <div className="flex flex-col gap-6">
        <p
          role="status"
          className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
        >
          {ongoing ? (
            <>
              Preview — {period.label} is still going, so this recap covers it so far and will
              change. It&apos;s published a few days after it ends.
            </>
          ) : (
            <>
              Preview — {period.label} isn&apos;t complete yet, so this recap is partial and will
              change. It&apos;s published on {formatDate(periodPublishDate(period), "dayYear")}.
            </>
          )}
        </p>
        <RecapReport period={period} chapter={chapter} />
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-2 py-8">
        <h2 className="font-heading text-lg font-medium">
          Recap {period.label} isn&apos;t ready yet
        </h2>
        <p className="text-sm text-muted-foreground">
          {ongoing ? (
            <>
              {period.label} is still going. Its recap is published a few days after it ends —
              once an end date is recorded in your profile.
            </>
          ) : (
            <>
              It&apos;s published on {formatDate(periodPublishDate(period), "dayYear")} — a few days
              after the period ends, to leave time to fill in anything you haven&apos;t logged.
            </>
          )}
        </p>
        <Link
          href="?preview=1"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Preview it anyway
        </Link>
      </CardContent>
    </Card>
  );
}
