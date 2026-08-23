import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DayNav } from "@/components/day-nav";
import { isValidDateString } from "@/lib/date";
import {
  loadDay,
  NEGATIVE_PEOPLE_SLOTS,
  PLACE_SLOTS,
  POSITIVE_PEOPLE_SLOTS,
  SUB_NAMES,
  type DayPayload,
} from "@/lib/days";

// Always a live DB read for the given date — never statically cached.
export const dynamic = "force-dynamic";

// Scalar sections show "X/N filled" with a progress bar. Subs/people/places
// now have a fixed field count too (SUB_NAMES / the people & place slot
// constants), so they get the same treatment. Entertainment is still a
// genuinely open-ended list, so it shows a simple "N logged" badge instead —
// same "at a glance, not exact" spirit, just without a manufactured
// denominator.
type CategorySummary =
  | { key: string; label: string; kind: "progress"; filled: number; total: number }
  | { key: string; label: string; kind: "count"; count: number };

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
      kind: "progress",
      filled: present([day.distanceWalkedKm, day.coffees, day.sick, day.workouts.length > 0 ? true : null]),
      total: 4,
    },
    {
      key: "sleep",
      label: "Sleep",
      kind: "progress",
      filled: present([day.sleepTime, day.wakeTime, day.sleepLocationType, day.napMinutes]),
      total: 4,
    },
    {
      key: "happiness",
      label: "Happiness",
      kind: "progress",
      filled: present([day.happiness, day.happinessReason, day.journal, day.dayType]),
      total: 4,
    },
    {
      key: "work",
      label: "Work",
      kind: "progress",
      filled: present([
        day.productivity,
        day.workDurationMinutes,
        day.workLocation.length > 0 ? true : null,
        day.commute.length > 0 ? true : null,
      ]),
      total: 4,
    },
    {
      key: "technology",
      label: "Technology",
      kind: "progress",
      filled: present([day.phoneUsageMinutes, day.laptopUsageMinutes, day.instagramUsageMinutes]),
      total: 3,
    },
    {
      key: "weight",
      label: "Weight",
      kind: "progress",
      filled: present([day.weightKg, day.bodyFatPercent, day.muscleMassKg]),
      total: 3,
    },
    {
      key: "social-media",
      label: "Social media",
      kind: "progress",
      filled: present([day.instagramFollowers, day.instagramFollowing]),
      total: 2,
    },
    { key: "subs", label: "Subs", kind: "progress", filled: day.subs.length, total: SUB_NAMES.length },
    {
      key: "people",
      label: "People",
      kind: "progress",
      filled: day.people.length,
      total: POSITIVE_PEOPLE_SLOTS + NEGATIVE_PEOPLE_SLOTS,
    },
    { key: "places", label: "Places", kind: "progress", filled: day.places.length, total: PLACE_SLOTS },
    { key: "entertainment", label: "Entertainment", kind: "count", count: day.entertainment.length },
    { key: "movies", label: "Movies", kind: "count", count: day.movies.length },
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
                    {cat.kind === "progress" ? `${cat.filled}/${cat.total}` : `${cat.count} logged`}
                  </span>
                </div>
              </CardHeader>
              {cat.kind === "progress" ? (
                <CardContent>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${(cat.filled / cat.total) * 100}%` }}
                    />
                  </div>
                </CardContent>
              ) : (
                <CardContent>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: cat.count > 0 ? "100%" : "0%" }}
                    />
                  </div>
                </CardContent>
              )}
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
