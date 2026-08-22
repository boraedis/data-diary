import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DayNav } from "@/components/day-nav";
import { isValidDateString } from "@/lib/date";
import { loadDay, type DayPayload } from "@/lib/days";

// Always a live DB read for the given date — never statically cached.
export const dynamic = "force-dynamic";

type CategorySummary = {
  key: string;
  label: string;
  filled: number;
  total: number;
};

// "Filled" is a simple presence count per section, not a judgment about
// whether the day is "complete" — it's just enough to show at a glance
// which sections you haven't touched yet, same idea as the legacy app's
// per-category progress bars on its day dashboard.
function summarize(day: DayPayload): CategorySummary[] {
  const present = (values: unknown[]) => values.filter((v) => v !== null && v !== undefined).length;

  return [
    {
      key: "health",
      label: "Health",
      filled: present([day.distanceWalkedKm, day.coffees, day.sick, day.workouts.length > 0 ? true : null]),
      total: 4,
    },
    {
      key: "sleep",
      label: "Sleep",
      filled: present([day.sleepTime, day.wakeTime, day.sleepLocationType, day.napMinutes]),
      total: 4,
    },
    {
      key: "happiness",
      label: "Happiness",
      filled: present([day.happiness, day.happinessReason, day.journal, day.dayType]),
      total: 4,
    },
    {
      key: "work",
      label: "Work",
      filled: present([
        day.productivity,
        day.workDurationMinutes,
        day.workLocation.length > 0 ? true : null,
        day.commute.length > 0 ? true : null,
      ]),
      total: 4,
    },
  ];
}

export default async function DaySummaryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }

  const day = await loadDay(date);
  const categories = summarize(day);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <DayNav date={date} />
      <div className="flex flex-col gap-3">
        {categories.map((cat) => (
          <Link key={cat.key} href={`/day/${date}/${cat.key}`}>
            <Card size="sm" className="transition-colors hover:bg-accent">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{cat.label}</CardTitle>
                  <span className="font-mono text-sm text-muted-foreground">
                    {cat.filled}/{cat.total}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${(cat.filled / cat.total) * 100}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
