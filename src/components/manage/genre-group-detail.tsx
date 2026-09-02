"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { GenreGroupItem, GenreGroupUsage } from "@/lib/catalog-admin";

export function GenreGroupDetail({
  group: initial,
  usage,
}: {
  group: GenreGroupItem;
  usage: GenreGroupUsage;
}) {
  const router = useRouter();
  const [group, setGroup] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color ?? "#64748b");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setName(group.name);
    setColor(group.color ?? "#64748b");
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
      const res = await fetch(`/api/genre-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setGroup(body as GenreGroupItem);
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
        <Link href="/manage/entertainment/music/genre-groups" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Genre groups
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit genre group" : group.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="genre-group-name">Name</Label>
                <Input id="genre-group-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="genre-group-color">Color</Label>
                <input
                  id="genre-group-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-16 cursor-pointer rounded border border-input bg-transparent p-0"
                />
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
              <div className="flex items-center gap-2">
                <span
                  className="h-4 w-4 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: group.color ?? "#64748b" }}
                />
                <span className="text-sm text-muted-foreground">{usage.genres.length} genres</span>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={group.name}
                  isBlocked={false}
                  afterDeleteHref="/manage/entertainment/music/genre-groups"
                  onDelete={async () => {
                    const res = await fetch(`/api/genre-groups/${group.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={null}
                  warningContent={
                    usage.genres.length > 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {usage.genres.length} genre{usage.genres.length === 1 ? "" : "s"} will become ungrouped,
                        not deleted.
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
          <CardTitle>Genres in this group</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {usage.genres.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {usage.genres.map((genre) => (
            <Link
              key={genre.id}
              href={`/manage/entertainment/music/genres/${genre.id}`}
              className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              {genre.name}
            </Link>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
