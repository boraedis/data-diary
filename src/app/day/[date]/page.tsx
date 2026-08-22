import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { DayEntryForm } from "@/components/day-entry-form";
import { addDays, isValidDateString } from "@/lib/date";
import { loadDay } from "@/lib/days";

// Always a live DB read for the given date — never statically cached.
export const dynamic = "force-dynamic";

export default async function DayPage({
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
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <Link href={`/day/${addDays(date, -1)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Prev
        </Link>
        <div className="flex flex-col items-center">
          <h1 className="font-mono text-lg font-medium">{date}</h1>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
            Home
          </Link>
        </div>
        <Link href={`/day/${addDays(date, 1)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Next &rarr;
        </Link>
      </div>
      <DayEntryForm initialDay={day} />
    </main>
  );
}
