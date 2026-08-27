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

export const dynamic = "force-dynamic";

// The legacy app's "database" section, renamed: the place you go to fix a
// typo'd name, merge/retire something, or clean up a mistaken add — as
// opposed to the entry forms' "+ New", which only ever adds. One card per
// top-level catalog; entertainment's own sub-kinds (movies, tv, sports,
// books, music) live one level down at /manage/entertainment, not here —
// see that page.
const CATALOGS = [
  { key: "people", label: "People" },
  { key: "places", label: "Places" },
  { key: "exercises", label: "Exercises" },
  { key: "entertainment", label: "Entertainment" },
] as const;

export default async function ManagePage() {
  const [people, places, exercises, entertainment, movies, sports, books] = await Promise.all([
    listPeopleCatalog(),
    listPlacesCatalog(),
    listExercisesCatalog(),
    listEntertainmentCatalog(),
    listMoviesCatalog(),
    listSportsCatalog(),
    listBooksCatalog(),
  ]);

  const counts: Record<(typeof CATALOGS)[number]["key"], number> = {
    people: people.length,
    places: places.length,
    exercises: exercises.length,
    // The generic (not-yet-migrated) catalog plus movies, sports, and
    // books, folded together — matches the day-summary page's same
    // "entertainment tile counts all of it" call.
    entertainment: entertainment.length + movies.length + sports.length + books.length,
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Manage</h1>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Home
        </Link>
      </div>
      <div className="flex flex-col gap-3">
        {CATALOGS.map((cat) => (
          <Link key={cat.key} href={`/manage/${cat.key}`}>
            <Card size="sm" className="transition-colors hover:bg-accent">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{cat.label}</CardTitle>
                  <span className="font-mono text-sm text-muted-foreground">{counts[cat.key]}</span>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
