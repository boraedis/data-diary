import { notFound } from "next/navigation";
import { ChartPage } from "@/components/charts/chart-page";
import { RecapGate } from "@/components/recap/recap-gate";
import { todayDateString } from "@/lib/date";
import { chapterPeriod, chapterSpanLabel, getRecapChapter } from "@/lib/recap-chapters";

export const dynamic = "force-dynamic";

// One life chapter's recap (#519): a job, a role within one, a home or a
// relationship, at `/recap/chapters/<kind>-<id>`. The static `chapters`
// segment wins over the `[year]` route beside it, and the year route only
// accepts four digits anyway, so the two can't collide.
//
// The same thin wrapper the year and month routes are — the chapter
// supplies the period, `RecapGate` holds it back until it has ended
// (#517), and `RecapReport` renders it with its chapter-scope choices.

export default async function RecapChapterPage({
  params,
  searchParams,
}: {
  params: Promise<{ chapter: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { chapter: segment } = await params;
  const { preview } = await searchParams;
  // Unlike a year, a chapter that doesn't exist isn't "a period with
  // nothing logged" — there is no such period — so it 404s.
  const chapter = await getRecapChapter(segment);
  if (chapter === null) notFound();

  const today = todayDateString();
  return (
    <ChartPage
      title={`Recap: ${chapter.title}`}
      backHref="/recap"
      backLabel="Recap"
      description={chapterSpanLabel(chapter, today)}
    >
      <RecapGate period={chapterPeriod(chapter, today)} preview={preview === "1"} chapter={chapter} />
    </ChartPage>
  );
}
