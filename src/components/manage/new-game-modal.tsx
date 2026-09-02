"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { GameCatalogItem } from "@/lib/days";
import type { GameCategoryItem, GameSubcategoryItem } from "@/lib/catalog-admin";

/** Same fields as the games entry form's own "+ New game" modal — kept as a
 * separate copy rather than importing that one, since it's private to that
 * file and the entry-form and manage contexts are reasonable to let drift
 * independently (same call already made for people/places/entertainment). */
export function NewGameModal({
  open,
  onClose,
  onCreated,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: GameCatalogItem) => void;
  categories: (GameCategoryItem & { subcategories: GameSubcategoryItem[] })[];
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [subtype, setSubtype] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeNames = categories.map((c) => c.name);
  const subtypeNames = categories.flatMap((c) => c.subcategories.map((s) => s.name));

  function reset() {
    setName("");
    setType("");
    setSubtype("");
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type: type.trim() || null, subtype: subtype.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as GameCatalogItem);
      reset();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New game"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-game-name">Name</Label>
          <Input id="manage-new-game-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-game-type">Category</Label>
          <Input
            id="manage-new-game-type"
            list="manage-new-game-type-options"
            value={type}
            onChange={(e) => setType(e.target.value)}
          />
          <datalist id="manage-new-game-type-options">
            {typeNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-game-subtype">Subcategory</Label>
          <Input
            id="manage-new-game-subtype"
            list="manage-new-game-subtype-options"
            value={subtype}
            onChange={(e) => setSubtype(e.target.value)}
          />
          <datalist id="manage-new-game-subtype-options">
            {subtypeNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}
