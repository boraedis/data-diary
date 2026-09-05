import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listRecapYears } from "@/lib/recap";

export const dynamic = "force-dynamic";

// The recap year index (issue #169, epic #130). Same card-grid shape as
// /charts, and deliberately not a curated list: the years come from the
// data itself, so every historical year is reachable the moment this ships
// rather than only years that happen to fall after it (#130's backfill
// requirement).

export default async function RecapIndexPage() {
  const years = await listRecapYears();

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
          Nothing logged yet — a recap appears here once there are days to summarize.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
          {years.map((year) => (
            <Link key={year.year} href={`/recap/${year.year}`}>
              <Card className="h-full transition-colors hover:bg-accent">
                <CardHeader>
                  <CardTitle>{year.year}</CardTitle>
                  <CardDescription>
                    {year.loggedDays === 0
                      ? "No days logged this year."
                      : `${year.loggedDays} day${year.loggedDays === 1 ? "" : "s"} logged.`}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
