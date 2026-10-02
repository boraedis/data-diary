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
  education: "School",
  residence: "Home",
  relationship: "Relationship",
  role: "Role",
};

/** Phrased per kind rather than one generic set of verbs — "Moved in"
 * says what a residence starting actually was, where "Started" reads like
 * boilerplate. `throughout` is the one framing that stays neutral across
 * kinds: nothing happened, it was simply true all period — so it's worded
 * from the period's own noun ("All year") in `framingLabel` below rather
 * than listed here. */
const FRAMING_LABELS: Record<
  RecapLifeEventKind,
  Record<Exclude<RecapLifeEvent["framing"], "throughout">, string>
> = {
  occupation: { started: "Started", ended: "Left", "started-and-ended": "Started and left" },
  education: { started: "Enrolled", ended: "Graduated", "started-and-ended": "Enrolled and graduated" },
  residence: { started: "Moved in", ended: "Moved out", "started-and-ended": "Moved in and out" },
  relationship: { started: "Began", ended: "Ended", "started-and-ended": "Began and ended" },
  role: { started: "New role", ended: "Ended", "started-and-ended": "Held briefly" },
};

function framingLabel(event: RecapLifeEvent, periodNoun: string): string {
  return event.framing === "throughout"
    ? `All ${periodNoun}`
    : FRAMING_LABELS[event.kind][event.framing];
}

export function RecapLifeEventsCard({
  events,
  periodLabel,
  periodNoun = "year",
  description,
}: {
  events: RecapLifeEvent[];
  periodLabel: string;
  /** Names the period in the "All year" framing — "month" on a monthly
   * recap (#176). */
  periodNoun?: string;
  /** Overrides the default description, for a caller that filtered the
   * list (the monthly recap drops entries that ran through the whole
   * month, so "or ran through" would be untrue). */
  description?: string;
}) {
  return (
    <ChartCard
      title="Life events"
      description={
        description ??
        `Jobs, homes and relationships that started, ended, or ran through ${periodLabel}.`
      }
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
                {framingLabel(event, periodNoun)}
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
