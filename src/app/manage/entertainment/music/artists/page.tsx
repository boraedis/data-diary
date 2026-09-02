import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { listArtists } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

export const dynamic = "force-dynamic";

function toSearchItem(artist: Awaited<ReturnType<typeof listArtists>>[number]): SearchItem {
  return {
    id: artist.id,
    primary: artist.name,
    secondary: artist.genres.slice(0, 3).join(", ") || undefined,
    searchTerms: artist.aliases,
  };
}

export default async function ManageArtistsPage() {
  const artists = await listArtists();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Artists</h1>
        <Link href="/manage/entertainment/music" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to Music
        </Link>
      </div>
      <CatalogBrowser
        items={artists.map(toSearchItem)}
        basePath="/manage/entertainment/music/artists"
        placeholder="Search artists…"
        emptyMessage="No artists yet — import some listens first."
      />
    </main>
  );
}
