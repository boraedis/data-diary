import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { JournalSection, type JournalMode } from "@/components/journal/journal-section";
import { isValidDateString } from "@/lib/date";
import { loadDay } from "@/lib/days";
import type { VideoLogSummary } from "@/lib/video-journal/video-log-types";
import { listVideoLogsForDate, nextLogNumber } from "@/lib/video-journal/video-logs";

export const dynamic = "force-dynamic";

/** The day's journal, written or recorded (#340, epic #338). Moved out of
 * the Happiness section into its own once video journaling made it a
 * primary way of logging a day rather than one field among four. */
export default async function JournalEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }
  const { mode } = await searchParams;

  // Recordings load separately from the day itself, and a failure there
  // (R2 misconfigured, the video_logs table missing from whatever database
  // this deployment is pointed at) must not take the page down with it:
  // writing has to keep working whatever state video storage is in. The
  // message is shown in the Record pane rather than swallowed, because
  // this is a single-user page and the error is the fastest diagnosis.
  const [day, videoLogsResult, logNumber] = await Promise.all([
    loadDay(date),
    listVideoLogsForDate(date).then(
      (logs): { logs: VideoLogSummary[]; error: string | null } => ({ logs, error: null }),
      (error: unknown) => {
        console.error("[journal] Could not load video logs:", error);
        return { logs: [], error: describeError(error) };
      },
    ),
    // Only the HUD's provisional "LOG #N" (#599); never worth failing for.
    nextLogNumber().catch(() => 1),
  ]);

  // An explicit ?mode= always wins. Otherwise a day that has recordings
  // opens on Record, where they're listed and playable, and any other day
  // opens on Write. Only stored recordings count: takes still on a device
  // aren't visible to the server.
  const initialMode: JournalMode =
    mode === "record" || mode === "write" ? mode : videoLogsResult.logs.length > 0 ? "record" : "write";

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <DayNav date={date} category="journal" />
      <JournalSection
        date={date}
        initialMode={initialMode}         initialJournal={day.journal}
        videoLogs={videoLogsResult.logs}
        videoLogsError={videoLogsResult.error}
        nextLogNumber={logNumber}
        // The HUD reads these live for the date (#599's split): whatever
        // is logged now, including things logged after the recording.
        diaryStats={{
          sleepTime: day.sleepTime,
          wakeTime: day.wakeTime,
          wakeCrossedMidnight: day.wakeCrossedMidnight,
          coffees: day.coffees,
          distanceWalkedKm: day.distanceWalkedKm,
          happiness: day.happiness,
        }}
      />
    </main>
  );
}

/** Drizzle wraps a failed query as "Failed query: <sql>" with the driver's
 * actual reason (e.g. `relation "video_logs" does not exist`) on `cause`.
 * The reason is the useful part. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause.message : null;
    return cause ?? error.message;
  }
  return String(error);
}
