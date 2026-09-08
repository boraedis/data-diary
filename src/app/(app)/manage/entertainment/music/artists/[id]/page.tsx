import { notFound } from "next/navigation";
import { ArtistDetail } from "@/components/manage/artist-detail";
import { getArtist, listGenres } from "@/lib/catalog-admin";
import { getArtistAlbums, getArtistTracks } from "@/lib/music";

export const dynamic = "force-dynamic";

export default async function ManageArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const artist = await getArtist(id);
  if (!artist) {
    notFound();
    return;
  }
  const [albums, tracks, allGenres] = await Promise.all([getArtistAlbums(id), getArtistTracks(id), listGenres()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <ArtistDetail artist={artist} albums={albums} tracks={tracks} allGenres={allGenres} />
    </main>
  );
}
