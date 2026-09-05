"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { SavedColorItem } from "@/lib/catalog-admin";

/** Manage page for the shared color palette (issue #45) — a flat list, no
 * detail/id page, mirroring genre-catalog-panel.tsx's inline-edit shape
 * rather than the CatalogBrowser+detail-page pattern most catalogs use:
 * each row is small enough (a swatch, a hex, an optional name) that a
 * click-through page would just be an extra hop for no reason. No usage
 * check on delete — see the savedColors table comment in schema.ts, this
 * is never referenced by id anywhere. */
export function ColorsManagePanel({ initial }: { initial: SavedColorItem[] }) {
  const [colors, setColors] = useState(initial);
  const [newHex, setNewHex] = useState("#64748b");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/colors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hex: newHex, name: newName.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      setColors((prev) => [...prev, body as SavedColorItem]);
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  async function recolor(id: number, current: SavedColorItem, hex: string) {
    setColors((prev) => prev.map((c) => (c.id === id ? { ...c, hex } : c)));
    await fetch(`/api/colors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hex, name: current.name }),
    });
  }

  async function rename(id: number, current: SavedColorItem, name: string) {
    setColors((prev) => prev.map((c) => (c.id === id ? { ...c, name: name || null } : c)));
    await fetch(`/api/colors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hex: current.hex, name: name || null }),
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Saved colors</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          A shared fill-option list, not a linked reference — every color field elsewhere (tags, places, sports
          teams, genre groups, profile timeline entries) keeps its own independent hex value. Picking one of these
          from that field&rsquo;s picker just copies the hex in; editing or deleting a color here never changes
          anything that already used it.
        </p>
        <div className="flex flex-col gap-1.5">
          {colors.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <input
                type="color"
                value={c.hex}
                onChange={(e) => recolor(c.id, c, e.target.value)}
                className="h-6 w-6 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0"
                aria-label={`Edit color ${c.name ?? c.hex}`}
              />
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.hex}</span>
              <Input
                value={c.name ?? ""}
                onChange={(e) => rename(c.id, c, e.target.value)}
                placeholder="Unnamed"
                className="h-8 flex-1 text-sm"
                aria-label="Color name"
              />
              <DeleteCatalogItem
                itemLabel={c.name ?? c.hex}
                isBlocked={false}
                blockedContent={null}
                size="sm"
                onDelete={async () => {
                  const res = await fetch(`/api/colors/${c.id}`, { method: "DELETE" });
                  if (!res.ok) throw new Error("Failed to delete");
                  setColors((prev) => prev.filter((x) => x.id !== c.id));
                }}
              />
            </div>
          ))}
          {colors.length === 0 ? <p className="text-sm text-muted-foreground">No saved colors yet.</p> : null}
        </div>
        <div className="flex items-end gap-2">
          <input
            type="color"
            value={newHex}
            onChange={(e) => setNewHex(e.target.value)}
            className="h-10 w-10 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-0"
            aria-label="New color"
          />
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name (optional)"
            className="flex-1"
          />
          <Button type="button" onClick={create} disabled={creating}>
            {creating ? "Adding…" : "Add"}
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
