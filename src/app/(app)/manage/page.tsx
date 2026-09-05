import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  listBooksCatalog,
  listEntertainmentCatalog,
  listExercisesCatalog,
  listMoviesCatalog,
  listPeopleCatalog,
  listPlacesCatalog,
  listSportsCatalog,
} from "@/lib/days";
import { listSavedColors, listSleepLocationTypes } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

// The legacy app's "database" section, renamed: the place you go to fix a
// typo'd name, merge/retire something, or clean up a mistaken add — as
// opposed to the entry forms' "+ New", which only ever adds. One card per
// top-level catalog; entertainment's own sub-kinds (movies, tv, sports,
// books, music) live one level down at /manage/entertainment, not here —
// see that page. "Sleep" (issue #59) only has the one location-type/subtype
// catalog behind it, no richer sub-hierarchy the way entertainment does, so
// its card links straight to /manage/sleep rather than an intermediate hub.
// "Colors" (issue #45) is the same shape as Sleep — one flat catalog, no
// sub-hierarchy — but isn't owned by any single domain (used by tags,
// places, sports teams, genre groups, and profile timeline entries alike),
// so it uses the neutral `border-border` rather than reusing one of the
// five categorical chart-N accents, which are reserved for actual data
// series (see AGENTS.md's color convention) — this tile isn't one.
const CATALOGS = [
  { key: "people", label: "People", accent: "border-chart-1" },
  { key: "places", label: "Places", accent: "border-chart-2" },
  { key: "exercises", label: "Exercises", accent: "border-chart-3" },
  { key: "entertainment", label: "Entertainment", accent: "border-chart-4" },
  { key: "sleep", label: "Sleep", accent: "border-chart-5" },
  { key: "colors", label: "Colors", accent: "border-border" },
] as const;

export default async function ManagePage() {
  const [people, places, exercises, entertainment, movies, sports, books, sleepLocationTypes, colors] =
    await Promise.all([
      listPeopleCatalog(),
      listPlacesCatalog(),
      listExercisesCatalog(),
      listEntertainmentCatalog(),
      listMoviesCatalog(),
      listSportsCatalog(),
      listBooksCatalog(),
      listSleepLocationTypes(),
      listSavedColors(),
    ]);

  const counts: Record<(typeof CATALOGS)[number]["key"], number> = {
    people: people.length,
    places: places.length,
    exercises: exercises.length,
    // The generic (not-yet-migrated) catalog plus movies, sports, and
    // books, folded together — matches the day-summary page's same
    // "entertainment tile counts all of it" call.
    entertainment: entertainment.length + movies.length + sports.length + books.length,
    sleep: sleepLocationTypes.length,
    colors: colors.length,
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Manage Home</h1>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Home
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {CATALOGS.map((cat) => (
          <Link key={cat.key} href={`/manage/${cat.key}`}>
            <Card className={`h-full border-l-4 ${cat.accent} transition-colors hover:bg-accent`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{cat.label}</CardTitle>
                  <span className="font-mono text-lg text-muted-foreground">{counts[cat.key]}</span>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
