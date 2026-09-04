import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { SocialMediaEntryForm } from "@/components/entry-forms/social-media-entry-form";
import { isValidDateString } from "@/lib/date";
import { loadDay } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function SocialMediaEntryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }

  const day = await loadDay(date);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <DayNav date={date} category="social-media" />
      <SocialMediaEntryForm
        date={date}
        initial={{
          instagramFollowers: day.instagramFollowers,
          instagramFollowing: day.instagramFollowing,
        }}
      />
    </main>
  );
}
