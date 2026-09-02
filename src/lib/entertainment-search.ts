import { categoricalColor } from "@/lib/viz/color";

// The unified entertainment search (issue #61) combines 5 catalogs that
// each already have their own numeric id space (a movie #4 and a book #4
// are unrelated rows) into one SearchPanel list. SearchItem.id stays a
// plain `number` everywhere else in the app — every existing consumer maps
// one catalog's own PK straight through — so rather than widen that shared
// type (and every existing caller's onSelect signature) for this one new
// use, a composite id packs (kind, catalogId) into a single number local to
// this feature. 10,000,000 per kind slot is comfortably larger than any
// catalog this personal app will ever hold.
export const ENTERTAINMENT_KINDS = ["movie", "tv", "sports", "book", "other"] as const;
export type EntertainmentKind = (typeof ENTERTAINMENT_KINDS)[number];

const KIND_MULTIPLIER = 10_000_000;

export function encodeSearchId(kind: EntertainmentKind, catalogId: number): number {
  return ENTERTAINMENT_KINDS.indexOf(kind) * KIND_MULTIPLIER + catalogId;
}

export function decodeSearchId(compositeId: number): { kind: EntertainmentKind; id: number } {
  const kindIndex = Math.floor(compositeId / KIND_MULTIPLIER);
  const kind = ENTERTAINMENT_KINDS[kindIndex];
  return { kind, id: compositeId - kindIndex * KIND_MULTIPLIER };
}

// Fixed-order color per kind, same non-cycled `--chart-1..5` slots every
// chart uses (src/lib/viz/color.ts) — the first use of categoricalColor
// outside a chart, but it's exactly what "N fixed kinds, each gets a
// stable accent" calls for. Index doubles as ENTERTAINMENT_KINDS' order.
export function entertainmentKindColor(kind: EntertainmentKind): string {
  return categoricalColor(ENTERTAINMENT_KINDS.indexOf(kind));
}

export const ENTERTAINMENT_KIND_LABELS: Record<EntertainmentKind, string> = {
  movie: "Movie",
  tv: "TV show",
  sports: "Sports",
  book: "Book",
  other: "Other",
};
