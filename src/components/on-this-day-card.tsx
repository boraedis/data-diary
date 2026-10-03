import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OnThisDayHighlight } from "@/lib/on-this-day";
import { formatDate } from "@/lib/viz/format";

// Home's "on this day" teaser (#522). One line by design: the scope on
// #522 keeps Home to the single strongest moment and moves everything else
// to /on-this-day, which this card is the only way into (no section-link
// tile — it's a daily surface, not a section). The caller renders nothing
// at all when there's no highlight, so there's no empty state here.

export function yearsAgoLabel(yearsAgo: number): string {
  return yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
}

export function OnThisDayCard({ highlight }: { highlight: OnThisDayHighlight }) {
  const { moment } = highlight;
  return (
    <Card>
      <CardHeader>
        <CardTitle>On this day</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Link href={highlight.href} className="group flex flex-col gap-0.5">
          <span className="font-medium group-hover:underline">{moment.headline}</span>
          <span className="text-sm text-muted-foreground">
            {yearsAgoLabel(highlight.yearsAgo)} · {formatDate(moment.date, "dayYear")}
            {moment.detail ? ` · ${moment.detail}` : null}
          </span>
        </Link>
        <Link href="/on-this-day" className="text-sm text-muted-foreground hover:text-foreground">
          See all years &rarr;
        </Link>
      </CardContent>
    </Card>
  );
}
