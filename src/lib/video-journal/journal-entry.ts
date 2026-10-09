import { formatElapsed } from "@/lib/video-journal/recording";

// The block a transcript becomes in days.journal (#341): a mission-log
// style header naming the recording it came from, then the transcript.
// Format chosen by the owner on #341, 2026-10-08:
//
//   VIDEO LOG #12
//   Date:     Thu 8 Oct 2026, 9:47 PM EDT
//   Length:   2:05
//   Ref:      5cea423f
//
//   <transcript>
//
// Plain text on purpose: the journal is a text column that /journal
// searches and the Write pane edits, so the header has to read well as
// text. `Ref` is the start of the recording's id, enough to find its file
// (video-journal/<date>/<id>.<ext>) and for the Journal page to match it
// to a recording.
//
// #599 (the mission HUD) will add `Location:` (City, State + lat/lng) and
// `Weather:` lines once those are captured at record time. Old entries
// keep their old header: each log stores the exact block it wrote
// (video_logs.journal_entry), and that stored text, not a re-render, is
// what "latest wins" compares against.

/** Labels padded to one width so values line up in a monospace view. */
const LABEL_WIDTH = 10;

function line(label: string, value: string): string {
  return `${`${label}:`.padEnd(LABEL_WIDTH)}${value}`;
}

/**
 * "Thu 8 Oct 2026, 9:47 PM EDT", in the recording device's own timezone.
 * Falls back to UTC (labelled as such) when the timezone is unknown or
 * unrecognised, rather than silently using the server's.
 */
export function formatRecordedAt(recordedAt: Date, timeZone: string | null): string {
  const format = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).formatToParts(recordedAt);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("timeZoneName")}`;
  };
  if (timeZone) {
    try {
      return format(timeZone);
    } catch {
      // Unknown IANA name: fall through to UTC.
    }
  }
  return format("UTC");
}

export type JournalEntryInput = {
  id: string;
  logNumber: number | null;
  recordedAt: Date;
  recordedTz: string | null;
  durationMs: number;
  transcript: string;
};

export function buildJournalEntry(log: JournalEntryInput): string {
  const header = [
    log.logNumber !== null ? `VIDEO LOG #${log.logNumber}` : "VIDEO LOG",
    line("Date", formatRecordedAt(log.recordedAt, log.recordedTz)),
    line("Length", formatElapsed(log.durationMs)),
    line("Ref", log.id.slice(0, 8)),
  ];
  return `${header.join("\n")}\n\n${log.transcript.trim()}`;
}
