import type { ArtistListItem } from "@/lib/catalog-admin";

// Which artists the manage list shows (#540). The three views are nested:
// "no genre" is a subset of "no group", which is the set the Music Trend
// charts as its "No group" band — so working down the second list is what
// shrinks that band.

export type ArtistFilter = "all" | "no-genre" | "no-group";

export function filterArtists<T extends Pick<ArtistListItem, "genres" | "hasGroup">>(artists: T[], filter: ArtistFilter): T[] {
  switch (filter) {
    case "no-genre":
      return artists.filter((a) => a.genres.length === 0);
    case "no-group":
      return artists.filter((a) => !a.hasGroup);
    default:
      return artists;
  }
}
