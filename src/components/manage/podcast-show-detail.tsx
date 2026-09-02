"use client";

import { useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { PodcastCategoryItem, PodcastShowItem } from "@/lib/catalog-admin";
import type { EpisodeListenSummary } from "@/lib/music";
import { formatDuration } from "@/lib/viz/format";

function msToHours(ms: number): number {
  return ms / 3_600_000;
}

export function PodcastShowDetail({
  show: initial,
  categories,
  episodes,
}: {
  show: PodcastShowItem;
  categories: (PodcastCategoryItem & { showCount: number })[];
  episodes: EpisodeListenSummary[];
}) {
  const [show, setShow] = useState(initial);

  async function assignCategory(categoryId: number | null) {
    setShow((prev) => ({ ...prev, categoryId }));
    await fetch(`/api/podcast-shows/${show.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId }),
    });
  }

  const totalMs = episodes.reduce((sum, e) => sum + e.totalMs, 0);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">{show.name}</h1>
        <Link href="/manage/entertainment/music/podcasts" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to Podcasts
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Details</CardTitle>
            <span className="font-mono text-sm text-muted-foreground">{formatDuration(msToHours(totalMs))} total</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <label className="text-sm text-muted-foreground" htmlFor="podcast-category">
            Category
          </label>
          <Select
            id="podcast-category"
            value={show.categoryId ?? ""}
            onChange={(e) => assignCategory(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Episodes</CardTitle>
            <span className="text-xs text-muted-foreground">{episodes.length}</span>
          </div>
        </CardHeader>
        <CardContent className="flex max-h-[32rem] flex-col gap-1.5 overflow-y-auto">
          {episodes.map((episode, i) => (
            <div
              key={`${episode.episodeName ?? " "}-${i}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 truncate">{episode.episodeName ?? "Unknown episode"}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {formatDuration(msToHours(episode.totalMs))} · {episode.playCount} plays
              </span>
            </div>
          ))}
          {episodes.length === 0 && <p className="text-sm text-muted-foreground">No listens yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
