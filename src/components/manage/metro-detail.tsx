"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { MetroItem, MetroUsage } from "@/lib/catalog-admin";

export function MetroDetail({ metro: initial, usage }: { metro: MetroItem; usage: MetroUsage }) {
  const router = useRouter();
  const [metro, setMetro] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [country, setCountry] = useState(initial.country ?? "");
  const [alias, setAlias] = useState(initial.alias ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setName(metro.name);
    setCountry(metro.country ?? "");
    setAlias(metro.alias ?? "");
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
      const res = await fetch(`/api/metros/${metro.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          country: country.trim() || null,
          alias: alias.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setMetro(body as MetroItem);
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
        <Link href="/manage/places/metros" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Metros
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit metro" : metro.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="metro-name">Name</Label>
                <Input id="metro-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="metro-country">Country</Label>
                <Input id="metro-country" value={country} onChange={(e) => setCountry(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="metro-alias">Alias</Label>
                <Input id="metro-alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
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
                <dt className="text-muted-foreground">Country</dt>
                <dd>{metro.country ?? "—"}</dd>
                <dt className="text-muted-foreground">Alias</dt>
                <dd>{metro.alias ?? "—"}</dd>
                <dt className="text-muted-foreground">Places</dt>
                <dd>{usage.placeCount}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={metro.name}
                  isBlocked={false}
                  afterDeleteHref="/manage/places/metros"
                  onDelete={async () => {
                    const res = await fetch(`/api/metros/${metro.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={null}
                  warningContent={
                    usage.placeCount > 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {usage.placeCount} place{usage.placeCount === 1 ? "" : "s"} will lose this metro (kept, just
                        unassigned).
                      </p>
                    ) : undefined
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
