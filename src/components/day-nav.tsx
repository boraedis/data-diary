import { buttonVariants } from "@/components/ui/button";
import { addDays } from "@/lib/date";
import { ConfirmLink } from "@/components/confirm-link";

/** Prev/next-day nav shared by the day summary page and each section's
 * entry page. Pass `category` on a section page so prev/next stay within
 * that section (e.g. "sleep" -> "sleep") and a link back up to the day
 * summary is shown; omit it on the summary page itself. Pass `manageHref`
 * (#138 ask #3) on a section that has a real corresponding /manage/*
 * catalog page, to link straight there instead of forcing a trip back
 * through /manage's own index.
 *
 * Uses ConfirmLink, not next/link's Link, directly (issue #143) — this is
 * the primary way someone leaves a dirty entry page (Prev/Next/Summary/
 * Manage), so it needs to check the nav-blocker flag the same way TopNav
 * does. */
export function DayNav({
  date,
  category,
  manageHref,
  manageLabel,
}: {
  date: string;
  category?: string;
  manageHref?: string;
  manageLabel?: string;
}) {
  const suffix = category ? `/${category}` : "";
  return (
    <div className="flex items-center justify-between">
      <ConfirmLink
        href={`/day/${addDays(date, -1)}${suffix}`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        &larr; Prev
      </ConfirmLink>
      <div className="flex flex-col items-center">
        <h1 className="font-mono text-xl font-medium text-primary md:text-2xl">{date}</h1>
        <ConfirmLink
          href={category ? `/day/${date}` : "/"}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {category ? "Summary" : "Home"}
        </ConfirmLink>
        {manageHref ? (
          <ConfirmLink href={manageHref} className="text-sm text-muted-foreground hover:text-foreground">
            {manageLabel ?? "Manage"}
          </ConfirmLink>
        ) : null}
      </div>
      <ConfirmLink
        href={`/day/${addDays(date, 1)}${suffix}`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Next &rarr;
      </ConfirmLink>
    </div>
  );
}
