"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type {
  ArtistItem,
  GenreGroupItem,
  GenreItem,
  PodcastCategoryItem,
  PodcastShowItem,
} from "@/lib/catalog-admin";

// Everything artist/genre/podcast rows need editing for lives in one page
// rather than this repo's usual list-page + [id]-detail-page split
// (compare src/app/manage/people/tags/): none of these five catalogs
// support create-by-hand or delete from here (see each lib function's own
// comment in catalog-admin.ts — genres/artists/podcast shows only ever
// come from the Spotify import pipeline), so there's no "+ New" flow or
// usage-checked delete to justify a full detail page per row, just a
// couple of editable fields per row.

type ArtistWithGenres = ArtistItem & { genres: string[] };
type GenreGroupWithCount = GenreGroupItem & { genreCount: number };
type GenreWithCount = GenreItem & { artistCount: number };
type PodcastCategoryWithCount = PodcastCategoryItem & { showCount: number };

export function MusicCatalogAdmin({
  initialGenreGroups,
  initialGenres,
  initialArtists,
  initialPodcastCategories,
  initialPodcastShows,
}: {
  initialGenreGroups: GenreGroupWithCount[];
  initialGenres: GenreWithCount[];
  initialArtists: ArtistWithGenres[];
  initialPodcastCategories: PodcastCategoryWithCount[];
  initialPodcastShows: PodcastShowItem[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <GenreGroupsSection initial={initialGenreGroups} />
      <GenresSection initial={initialGenres} groups={initialGenreGroups} />
      <ArtistsSection initial={initialArtists} />
      <PodcastCategoriesSection initial={initialPodcastCategories} />
      <PodcastShowsSection initial={initialPodcastShows} categories={initialPodcastCategories} />
    </div>
  );
}

// --- Genre groups ---------------------------------------------------------

function GenreGroupsSection({ initial }: { initial: GenreGroupWithCount[] }) {
  const [groups, setGroups] = useState(initial);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#64748b");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/genre-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      setGroups((prev) => [...prev, { ...body, genreCount: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
    } finally {
      setCreating(false);
    }
  }

  async function recolor(id: number, group: GenreGroupWithCount, newColor: string) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, color: newColor } : g)));
    await fetch(`/api/genre-groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: group.name, color: newColor }),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Genre groups</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Broad buckets (Rock, Pop, …) with a chart color — Spotify&rsquo;s own genre tags below get assigned to
          one of these by hand, since there&rsquo;s no API for that mapping.
        </p>
        <div className="flex flex-col gap-1.5">
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <input
                type="color"
                value={g.color ?? "#64748b"}
                onChange={(e) => recolor(g.id, g, e.target.value)}
                className="h-6 w-6 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0"
                aria-label={`Color for ${g.name}`}
              />
              <span className="flex-1">{g.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{g.genreCount}</span>
            </div>
          ))}
          {groups.length === 0 && <p className="text-sm text-muted-foreground">No genre groups yet.</p>}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="new-genre-group-name">New group</Label>
            <Input
              id="new-genre-group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Rock, Pop, Hip-Hop…"
            />
          </div>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-10 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0"
            aria-label="New group color"
          />
          <Button type="button" onClick={create} disabled={creating || !name.trim()}>
            Add
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

// --- Genres -----------------------------------------------------------------

function GenresSection({ initial, groups }: { initial: GenreWithCount[]; groups: GenreGroupWithCount[] }) {
  const [genres, setGenres] = useState(initial);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? genres : genres.filter((g) => g.groupId === null).slice(0, 20);

  async function assign(id: number, groupId: number | null) {
    setGenres((prev) => prev.map((g) => (g.id === id ? { ...g, groupId } : g)));
    await fetch(`/api/genres/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
  }

  const unassignedCount = genres.filter((g) => g.groupId === null).length;

  return (
    <Card id="genres" className="scroll-mt-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Genres</CardTitle>
          <span className="text-xs text-muted-foreground">{genres.length} from Spotify</span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{showAll ? "Showing all genres" : `Showing unassigned genres (${unassignedCount})`}</span>
          <button type="button" className="underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show unassigned only" : "Show all"}
          </button>
        </div>
        <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
          {visible.map((genre) => (
            <div key={genre.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
              <span className="flex-1">{genre.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{genre.artistCount}</span>
              <Select
                className="h-8 w-40 text-xs"
                value={genre.groupId ?? ""}
                onChange={(e) => assign(genre.id, e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Ungrouped</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          {visible.length === 0 && <p className="text-sm text-muted-foreground">Nothing to show yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Artists ------------------------------------------------------------

function ArtistsSection({ initial }: { initial: ArtistWithGenres[] }) {
  const [artists, setArtists] = useState(initial);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? artists.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))
    : artists.slice(0, 25);

  async function saveAliases(id: number) {
    const raw = drafts[id];
    if (raw === undefined) return;
    const aliases = raw
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const res = await fetch(`/api/artists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aliases }),
    });
    if (res.ok) {
      const updated = await res.json();
      setArtists((prev) => prev.map((a) => (a.id === id ? { ...a, aliases: updated.aliases } : a)));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Artists</CardTitle>
          <span className="text-xs text-muted-foreground">{artists.length} total</span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Input placeholder="Search artists…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {filtered.map((artist) => (
            <div key={artist.id} className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{artist.name}</span>
                {artist.genres.length > 0 && (
                  <span className="text-right text-xs text-muted-foreground">{artist.genres.join(", ")}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 flex-1 text-xs"
                  placeholder="Aliases, comma-separated…"
                  defaultValue={artist.aliases.join(", ")}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [artist.id]: e.target.value }))}
                />
                {drafts[artist.id] !== undefined && (
                  <Button type="button" size="sm" variant="outline" onClick={() => saveAliases(artist.id)}>
                    Save
                  </Button>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p className="text-sm text-muted-foreground">No artists match.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Podcast categories / shows -------------------------------------------

function PodcastCategoriesSection({ initial }: { initial: PodcastCategoryWithCount[] }) {
  const [categories, setCategories] = useState(initial);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setError(null);
    const res = await fetch("/api/podcast-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(typeof body?.error === "string" ? body.error : "Failed to create");
      return;
    }
    setCategories((prev) => [...prev, { ...body, showCount: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
    setName("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Podcast categories</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          A simple, hand-curated category list for podcast shows — unlike artist genres, Spotify&rsquo;s API
          doesn&rsquo;t expose podcast categories to fetch automatically.
        </p>
        <div className="flex flex-col gap-1.5">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <span>{c.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{c.showCount}</span>
            </div>
          ))}
          {categories.length === 0 && <p className="text-sm text-muted-foreground">No categories yet.</p>}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="new-podcast-category-name">New category</Label>
            <Input
              id="new-podcast-category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="News, Comedy, True Crime…"
            />
          </div>
          <Button type="button" onClick={create} disabled={!name.trim()}>
            Add
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function PodcastShowsSection({
  initial,
  categories,
}: {
  initial: PodcastShowItem[];
  categories: PodcastCategoryWithCount[];
}) {
  const [shows, setShows] = useState(initial);

  async function assign(id: number, categoryId: number | null) {
    setShows((prev) => prev.map((s) => (s.id === id ? { ...s, categoryId } : s)));
    await fetch(`/api/podcast-shows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId }),
    });
  }

  if (shows.length === 0) return null;

  return (
    <Card id="podcast-shows" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Podcast shows</CardTitle>
      </CardHeader>
      <CardContent className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
        {shows.map((show) => (
          <div key={show.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
            <span className="flex-1">{show.name}</span>
            <Select
              className="h-8 w-40 text-xs"
              value={show.categoryId ?? ""}
              onChange={(e) => assign(show.id, e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
