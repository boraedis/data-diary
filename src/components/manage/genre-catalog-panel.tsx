"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { GenreGroupItem, GenreItem } from "@/lib/catalog-admin";

// Genre groups and genre-to-group assignment, stacked on the Artists page
// (genres are an artist attribute) rather than living on their own
// browse+detail pages — neither genres nor genre groups have enough
// per-row content to be worth a dedicated page the way an artist or
// podcast show does (see the `genres`/`genreGroups` table comments in
// schema.ts). Genres themselves are never hand-created here — they only
// ever come from the Spotify import pipeline (src/lib/music-import.ts).

type GenreGroupWithCount = GenreGroupItem & { genreCount: number };
type GenreWithCount = GenreItem & { artistCount: number };

export function GenreCatalogPanel({
  initialGenreGroups,
  initialGenres,
}: {
  initialGenreGroups: GenreGroupWithCount[];
  initialGenres: GenreWithCount[];
}) {
  const [groups, setGroups] = useState(initialGenreGroups);

  return (
    <>
      <GenreGroupsSection groups={groups} setGroups={setGroups} />
      <GenresSection initial={initialGenres} groups={groups} />
    </>
  );
}

function GenreGroupsSection({
  groups,
  setGroups,
}: {
  groups: GenreGroupWithCount[];
  setGroups: React.Dispatch<React.SetStateAction<GenreGroupWithCount[]>>;
}) {
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
