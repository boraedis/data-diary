"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { PodcastCategoryItem, PodcastCategoryUsage } from "@/lib/catalog-admin";

export function PodcastCategoryDetail({
  category: initial,
  usage,
}: {
  category: PodcastCategoryItem;
  usage: PodcastCategoryUsage;
}) {
  const router = useRouter();
  const [category, setCategory] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setName(category.name);
    setError(null);
    setEditing(false);
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/podcast-categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setCategory(body as PodcastCategoryItem);
      setEditing(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <Link
          href="/manage/entertainment/music/podcast-categories"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          &larr; Podcast categories
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit category" : category.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="podcast-category-name">Name</Label>
                <Input id="podcast-category-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              {error ? <span className="text-sm text-destructive">{error}</span> : null}
              <div className="flex gap-2">
                <Button type="button" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{usage.shows.length} shows</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={category.name}
                  isBlocked={false}
                  afterDeleteHref="/manage/entertainment/music/podcast-categories"
                  onDelete={async () => {
                    const res = await fetch(`/api/podcast-categories/${category.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={null}
                  warningContent={
                    usage.shows.length > 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {usage.shows.length} show{usage.shows.length === 1 ? "" : "s"} will become
                        uncategorized, not deleted.
                      </p>
                    ) : undefined
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Shows</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {usage.shows.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {usage.shows.map((show) => (
            <Link
              key={show.id}
              href={`/manage/entertainment/music/podcasts/${show.id}`}
              className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              {show.name}
            </Link>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
