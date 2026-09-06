import { ChartCard } from "@/components/charts/chart-card";
import { formatDate } from "@/lib/viz/format";
import type { RecapLifeEvent, RecapLifeEventKind } from "@/lib/recap-life-events";

// The life-events section of the recap report (issue #173, epic #130).
//
// A plain chronological list, deliberately: #130 wants this section
// shipped without waiting on #119's InteractiveTimeline, and the data
// shape it renders is already interval-based, so upgrading to the timeline
// primitive later is a rendering swap rather than a rewrite.

const KIND_LABELS: Record<RecapLifeEventKind, string> = {
  occupation: "Job",
  residence: "Home",
  relationship: "Relationship",
  role: "Role",
};

/** Phrased per kind rather than one generic set of verbs — "Moved in"
 * says what a residence starting actually was, where "Started" reads like
 * boilerplate. `throughout` is the one framing that stays neutral across
 * kinds: nothing happened, it was simply true all period. */
const FRAMING_LABELS: Record<RecapLifeEventKind, Record<RecapLifeEvent["framing"], string>> = {
  occupation: {
    started: "Started",
    ended: "Left",
    "started-and-ended": "Started and left",
    throughout: "All year",
  },
  residence: {
    started: "Moved in",
    ended: "Moved out",
    "started-and-ended": "Moved in and out",
    throughout: "All year",
  },
  relationship: {
    started: "Began",
    ended: "Ended",
    "started-and-ended": "Began and ended",
    throughout: "All year",
  },
  role: {
    started: "New role",
    ended: "Ended",
    "started-and-ended": "Held briefly",
    throughout: "All year",
  },
};

export function RecapLifeEventsCard({ events, periodLabel }: { events: RecapLifeEvent[]; periodLabel: string }) {
  return (
    <ChartCard
      title="Life events"
      description={`Jobs, homes and relationships that started, ended, or ran through ${periodLabel}.`}
      empty={events.length === 0}
    >
      <ul className="flex flex-col gap-3">
        {events.map((event) => (
          <li
            key={`${event.kind}-${event.title}-${event.start}`}
            className="flex items-start gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0"
          >
            {/* The entry's own color from the profile admin UI, the same
                value the scroller regions use — identity, not a palette
                slot this component gets to assign. Entries with no color
                set get a neutral dot rather than a borrowed hue. */}
            <span
              aria-hidden
              className="mt-1.5 size-2 shrink-0 rounded-full"
              style={{ backgroundColor: event.color ?? "var(--muted-foreground)" }}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-sm font-medium">{event.title}</p>
              {event.detail ? <p className="text-xs text-muted-foreground">{event.detail}</p> : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
              <span className="text-xs font-medium">
                {FRAMING_LABELS[event.kind][event.framing]}
              </span>
              <span className="text-xs text-muted-foreground">
                {KIND_LABELS[event.kind]}
                {datePart(event) ? ` · ${datePart(event)}` : ""}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

/** The date(s) the framing refers to. An entry that only ended in this
 * period shows when it ended, not when it began years earlier; one that
 * both began and ended shows the span, since either date alone leaves half
 * the sentence unanswered. An entry that spanned the whole period has no
 * date to report — that's what "all year" means. */
function datePart(event: RecapLifeEvent): string | null {
  switch (event.framing) {
    case "throughout":
      return null;
    case "ended":
      return formatDate(event.end as string);
    case "started-and-ended":
      return `${formatDate(event.start)} – ${formatDate(event.end as string)}`;
    case "started":
      return formatDate(event.start);
  }
}
