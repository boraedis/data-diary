import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { PortraitCapture } from "@/components/entry-forms/portrait-capture";
import { isValidDateString } from "@/lib/date";
import { getDayPortrait } from "@/lib/day-portraits/store";
import { getR2PortraitsConfig } from "@/lib/video-journal/r2";

export const dynamic = "force-dynamic";

export default async function PortraitEntryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }

  // Without the portraits bucket there is nowhere to keep a photo, so say so up front rather
  // than letting someone take one that cannot be saved. A storage failure
  // on read just means no photo is shown; the capture card still works.
  const configured = getR2PortraitsConfig() !== null;
  const portrait = configured
    ? await getDayPortrait(date).catch((error: unknown) => {
        console.error("[portrait page] Could not load the day's portrait:", error);
        return null;
      })
    : null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <DayNav date={date} category="portrait" />
      {configured ? (
        <PortraitCapture date={date} initial={portrait} />
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Portrait storage (R2_PORTRAITS_BUCKET) is not configured on this deployment, so portraits can&apos;t be saved here.
        </p>
      )}
    </main>
  );
}
