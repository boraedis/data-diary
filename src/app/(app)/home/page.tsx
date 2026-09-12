import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GoToDate } from "@/components/go-to-date";
import { RecentDaysScroller } from "@/components/recent-days-scroller";
import { getHomeDashboardData, type BirthdayEntry } from "@/lib/home";

export const dynamic = "force-dynamic";

// Every root-level section, not just the couple that fit in the persistent
// top nav (#348 trimmed that down to Charts/Manage since a flat tab list
// doesn't scale). This is the actual index: add a new root section here
// and it's reachable — the grid it feeds wraps to a 3rd column on `sm`
// rather than needing a hand-tuned column count each time (#347).
const SECTION_LINKS = [
  { href: "/charts", label: "Charts" },
  { href: "/journal", label: "Journal" },
  { href: "/recap", label: "Recap" },
  { href: "/manage", label: "Manage" },
  { href: "/profile", label: "Profile" },
] as const;

function formatLifePct(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(1)}%`;
}

function birthdayNote(entry: BirthdayEntry): string {
  if (entry.daysUntil === 0) return `turns ${entry.turnsAge} today!`;
  if (entry.daysUntil === 1) return `turns ${entry.turnsAge} tomorrow`;
  return `turns ${entry.turnsAge} in ${entry.daysUntil}d`;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function HomePage() {
  const data = await getHomeDashboardData();
  const todayDate = data.recentDays[data.recentDays.length - 1]?.date ?? "";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:py-12">
      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <StatTile label="Days Logged" value={data.daysLogged.toLocaleString()} />
        <StatTile label="% of Life" value={formatLifePct(data.percentOfLifeLogged)} />
        <StatTile label="Days Behind" value={String(data.daysBehind)} />
      </div>

      {/* Entry History */}
      <Card>
        <CardHeader>
          <CardTitle>Recent days</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentDaysScroller days={data.recentDays} todayDate={todayDate} />
        </CardContent>
      </Card>

      {/* Bottom section */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Upcoming birthdays */}
        <Card>
          <CardHeader>
            <CardTitle>Upcoming birthdays</CardTitle>
          </CardHeader>
          <CardContent>
            {data.upcomingBirthdays.length === 0 ? (
              <p className="text-sm text-muted-foreground">No people with birthdays on file.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {data.upcomingBirthdays.map((entry) => (
                  <li key={entry.name} className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
                    <span className="font-medium">{entry.name}</span>
                    <span
                      className={`shrink-0 text-sm ${entry.daysUntil === 0 ? "font-medium text-primary" : "text-muted-foreground"}`}
                    >
                      {birthdayNote(entry)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Navigation column */}
        <div className="flex flex-col gap-3">
          <Card>
            <CardHeader>
              <CardTitle>Go to date</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <GoToDate />
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SECTION_LINKS.map(({ href, label }) => (
              <Link key={href} href={href}>
                <Card className="h-full transition-colors hover:bg-accent">
                  <CardContent className="py-3 text-sm font-medium">{label}</CardContent>
                </Card>
              </Link>
            ))}

            <form action="/api/auth/logout" method="post" className="h-full">
              <Card className="h-full transition-colors hover:bg-accent">
                <CardContent className="py-3">
                  <button type="submit" className="w-full text-left text-sm font-medium">
                    Sign out
                  </button>
                </CardContent>
              </Card>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
