import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { addDays } from "@/lib/date";

/** Prev/next-day nav shared by the day summary page and each section's
 * entry page. Pass `category` on a section page so prev/next stay within
 * that section (e.g. "sleep" -> "sleep") and a link back up to the day
 * summary is shown; omit it on the summary page itself. */
export function DayNav({ date, category }: { date: string; category?: string }) {
  const suffix = category ? `/${category}` : "";
  return (
    <div className="flex items-center justify-between">
      <Link
        href={`/day/${addDays(date, -1)}${suffix}`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        &larr; Prev
      </Link>
      <div className="flex flex-col items-center">
        <h1 className="font-mono text-lg font-medium">{date}</h1>
        <Link
          href={category ? `/day/${date}` : "/"}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {category ? "Summary" : "Home"}
        </Link>
      </div>
      <Link
        href={`/day/${addDays(date, 1)}${suffix}`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Next &rarr;
      </Link>
    </div>
  );
}
