"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PodcastCategoryItem } from "@/lib/catalog-admin";

type PodcastCategoryWithCount = PodcastCategoryItem & { showCount: number };

// A simple, hand-curated category list, stacked on the Podcasts page —
// same reasoning as GenreCatalogPanel on the Artists page: not enough
// per-row content to be worth its own browse+detail flow.
export function PodcastCategoryPanel({ initial }: { initial: PodcastCategoryWithCount[] }) {
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
          doesn&rsquo;t expose podcast categories to fetch automatically. Assign a show to one from its own page.
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
