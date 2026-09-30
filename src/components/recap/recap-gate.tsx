import Link from "next/link";
import { MarkRecapSeen } from "@/components/recap/mark-recap-seen";
import { RecapReport } from "@/components/recap/recap-report";
import { Card, CardContent } from "@/components/ui/card";
import { todayDateString } from "@/lib/date";
import { isPeriodPublished, periodPublishDate, type RecapPeriod } from "@/lib/recap";
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

export function RecapGate({ period, preview }: { period: RecapPeriod; preview: boolean }) {
  const today = todayDateString();
  if (isPeriodPublished(period, today)) {
    // Opening a published recap is what clears its "new" badge (#518). Not
    // done for a preview, which isn't the real recap.
    const key = recapPeriodKey(period);
    return (
      <>
        {key !== null ? <MarkRecapSeen periodKey={key} /> : null}
        <RecapReport period={period} />
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
          Preview — {period.label} isn&apos;t complete yet, so this recap is partial and will
          change. It&apos;s published on {formatDate(periodPublishDate(period), "dayYear")}.
        </p>
        <RecapReport period={period} />
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
          It&apos;s published on {formatDate(periodPublishDate(period), "dayYear")} — a few days after
          the period ends, to leave time to fill in anything you haven&apos;t logged.
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
