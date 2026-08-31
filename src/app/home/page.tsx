import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TodayLink } from "@/components/today-link";
import { GoToDate } from "@/components/go-to-date";
import { getHomeDashboardData, type BirthdayEntry, type RecentDay } from "@/lib/home";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortLabel(dateStr: string): { weekday: string; day: string; month: string } {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return { weekday: WEEKDAYS[d.getDay()], day: String(day), month: MONTHS[month - 1] };
}

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

function DayTab({ day, isToday }: { day: RecentDay; isToday: boolean }) {
  const label = shortLabel(day.date);
  const pct = (day.score / 10) * 100;
  return (
    <Link
      href={`/day/${day.date}`}
      className={`flex min-w-[52px] flex-shrink-0 flex-col items-center gap-1.5 rounded-lg border px-2 py-2 text-center transition-colors hover:bg-accent ${isToday ? "border-primary/50 bg-primary/5" : ""}`}
    >
      <span className="text-[10px] font-medium text-muted-foreground">{label.weekday}</span>
      <span className="text-sm font-semibold">{label.day}</span>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground">{label.month}</span>
    </Link>
  );
}

export default async function HomePage() {
  const data = await getHomeDashboardData();
  const todayDate = data.recentDays[data.recentDays.length - 1]?.date ?? "";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:py-12">
      <div>
        <h1 className="font-heading text-3xl font-medium tracking-tight text-primary italic md:text-4xl">
          Data Diary
        </h1>
      </div>

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
          <div className="flex gap-2 overflow-x-auto pb-1">
            {data.recentDays.map((day) => (
              <DayTab key={day.date} day={day} isToday={day.date === todayDate} />
            ))}
          </div>
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
              <TodayLink />
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { href: "/charts", label: "Charts" },
                { href: "/manage", label: "Manage" },
                { href: "/profile", label: "Profile" },
              ] as const
            ).map(({ href, label }) => (
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
