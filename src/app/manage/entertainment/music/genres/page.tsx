import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { listGenreGroups, listGenres } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

export const dynamic = "force-dynamic";

export default async function ManageGenresPage() {
  const [genres, groups] = await Promise.all([listGenres(), listGenreGroups()]);
  const groupById = new Map(groups.map((g) => [g.id, g]));

  const items: SearchItem[] = genres.map((genre) => {
    const group = genre.groupId ? groupById.get(genre.groupId) : undefined;
    return {
      id: genre.id,
      primary: genre.name,
      secondary: group ? group.name : "Ungrouped",
      accentColor: group?.color,
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Genres</h1>
        <Link href="/manage/entertainment/music" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to Music
        </Link>
      </div>
      <CatalogBrowser
        items={items}
        basePath="/manage/entertainment/music/genres"
        placeholder="Search genres…"
        emptyMessage="No genres yet — import some listens first."
      />
    </main>
  );
}
