"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { GameCatalogItem, GameUsage } from "@/lib/days";
import type { GameCategoryItem, GameSubcategoryItem } from "@/lib/catalog-admin";

export function GameDetail({
  game: initial,
  usage,
  categories,
}: {
  game: GameCatalogItem;
  usage: GameUsage;
  categories: (GameCategoryItem & { subcategories: GameSubcategoryItem[] })[];
}) {
  const router = useRouter();
  const [game, setGame] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [type, setType] = useState(initial.type ?? "");
  const [subtype, setSubtype] = useState(initial.subtype ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeNames = categories.map((c) => c.name);
  const subtypeNames = categories.flatMap((c) => c.subcategories.map((s) => s.name));

  function cancelEdit() {
    setName(game.name);
    setType(game.type ?? "");
    setSubtype(game.subtype ?? "");
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
      const res = await fetch(`/api/games/${game.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type: type.trim() || null, subtype: subtype.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setGame(body as GameCatalogItem);
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
        <Link href="/manage/entertainment/games" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Games
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit game" : game.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="game-detail-name">Name</Label>
                <Input id="game-detail-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="game-detail-type">Category</Label>
                <Input id="game-detail-type" list="game-detail-type-options" value={type} onChange={(e) => setType(e.target.value)} />
                <datalist id="game-detail-type-options">
                  {typeNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="game-detail-subtype">Subcategory</Label>
                <Input
                  id="game-detail-subtype"
                  list="game-detail-subtype-options"
                  value={subtype}
                  onChange={(e) => setSubtype(e.target.value)}
                />
                <datalist id="game-detail-subtype-options">
                  {subtypeNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
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
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Category</dt>
                <dd>{game.type ?? "—"}</dd>
                <dt className="text-muted-foreground">Subcategory</dt>
                <dd>{game.subtype ?? "—"}</dd>
                <dt className="text-muted-foreground">Logged sessions</dt>
                <dd>{usage.sessionCount}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={game.name}
                  isBlocked={usage.sessionCount > 0}
                  afterDeleteHref="/manage/entertainment/games"
                  onDelete={async () => {
                    const res = await fetch(`/api/games/${game.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <p>{usage.sessionCount} session{usage.sessionCount === 1 ? "" : "s"} still use this game.</p>
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
