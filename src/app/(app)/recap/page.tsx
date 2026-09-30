import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listRecapYears } from "@/lib/recap";
import { getUnseenRecaps } from "@/lib/recap-seen";

export const dynamic = "force-dynamic";

// The recap year index (issue #169, epic #130). Same card-grid shape as
// /charts, and deliberately not a curated list: the years come from the
// data itself, so every historical year is reachable the moment this ships
// rather than only years that happen to fall after it (#130's backfill
// requirement) — minus any year whose recap isn't published yet (#517), so
// the current year appears only once its period is complete.

function NewBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
      {children}
    </span>
  );
}

export default async function RecapIndexPage() {
  const [years, unseen] = await Promise.all([listRecapYears(), getUnseenRecaps()]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Recap</h1>
        <Link href="/home" className="text-xs text-muted-foreground hover:text-foreground">
          Home
        </Link>
      </div>

      {years.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recap is ready yet — each one appears a few days after its month or year ends, once
          there are days to summarize.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
          {years.map((year) => {
            // Each unopened recap is marked individually (#518): the year
            // itself, and separately any of its months.
            const yearIsNew = unseen.years.includes(year.year);
            const newMonths = unseen.months.filter((m) => m.startsWith(`${year.year}-`)).length;
            return (
              <Link key={year.year} href={`/recap/${year.year}`}>
                <Card className="h-full transition-colors hover:bg-accent">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {year.year}
                      {yearIsNew ? <NewBadge>New</NewBadge> : null}
                      {newMonths > 0 ? (
                        <NewBadge>
                          {newMonths} new month{newMonths === 1 ? "" : "s"}
                        </NewBadge>
                      ) : null}
                    </CardTitle>
                    <CardDescription>
                      {year.loggedDays === 0
                        ? "No days logged this year."
                        : `${year.loggedDays} day${year.loggedDays === 1 ? "" : "s"} logged.`}
                      {year.published ? null : " Year in progress — months available."}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
