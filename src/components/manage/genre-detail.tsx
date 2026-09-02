"use client";

import { useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { GenreGroupItem, GenreItem, GenreUsage } from "@/lib/catalog-admin";

export function GenreDetail({
  genre: initial,
  groups,
  usage,
}: {
  genre: GenreItem & { artistCount: number };
  groups: (GenreGroupItem & { genreCount: number })[];
  usage: GenreUsage;
}) {
  const [genre, setGenre] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function assignGroup(groupId: number | null) {
    setGenre((prev) => ({ ...prev, groupId }));
    setSaving(true);
    try {
      await fetch(`/api/genres/${genre.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">{genre.name}</h1>
        <Link href="/manage/entertainment/music/genres" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to Genres
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            The name comes straight from Spotify and can&rsquo;t be edited here — renaming would stop future
            imports from matching this genre back to this row.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="genre-group-select">Group</Label>
            <Select
              id="genre-group-select"
              value={genre.groupId ?? ""}
              onChange={(e) => assignGroup(e.target.value ? Number(e.target.value) : null)}
              disabled={saving}
            >
              <option value="">Ungrouped</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Artists</CardTitle>
            <span className="text-xs text-muted-foreground">{usage.artists.length}</span>
          </div>
        </CardHeader>
        <CardContent className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
          {usage.artists.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {usage.artists.map((artist) => (
            <Link
              key={artist.id}
              href={`/manage/entertainment/music/artists/${artist.id}`}
              className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              {artist.name}
            </Link>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
