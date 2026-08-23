"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { PlaceCatalogItem, PlaceUsage } from "@/lib/days";

export function PlaceDetail({ place: initial, usage }: { place: PlaceCatalogItem; usage: PlaceUsage }) {
  const router = useRouter();
  const [place, setPlace] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [alias, setAlias] = useState(initial.alias ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [category, setCategory] = useState(initial.category ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setName(place.name);
    setAlias(place.alias ?? "");
    setAddress(place.address ?? "");
    setCategory(place.category ?? "");
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
      const res = await fetch(`/api/places/${place.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          alias: alias.trim() || null,
          address: address.trim() || null,
          category: category.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setPlace(body as PlaceCatalogItem);
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
        <Link href="/manage/places" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Places
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit place" : place.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="place-name">Name</Label>
                <Input id="place-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-alias">Alias</Label>
                <Input id="place-alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-address">Address</Label>
                <Input id="place-address" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-category">Category</Label>
                <Input id="place-category" value={category} onChange={(e) => setCategory(e.target.value)} />
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
                <dt className="text-muted-foreground">Alias</dt>
                <dd>{place.alias ?? "—"}</dd>
                <dt className="text-muted-foreground">Address</dt>
                <dd>{place.address ?? "—"}</dd>
                <dt className="text-muted-foreground">Category</dt>
                <dd>{place.category ?? "—"}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={place.name}
                  isBlocked={usage.dayDates.length > 0}
                  afterDeleteHref="/manage/places"
                  onDelete={async () => {
                    const res = await fetch(`/api/places/${place.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <ul className="list-inside list-disc">
                      {usage.dayDates.map((date) => (
                        <li key={date}>
                          <Link href={`/day/${date}/places`} className="text-primary hover:underline">
                            {date}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  }
                  warningContent={
                    usage.workoutDates.length > 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Also used as a workout location on {usage.workoutDates.length}{" "}
                        {usage.workoutDates.length === 1 ? "day" : "days"} — deleting will clear the
                        location on those workouts, not block the delete.
                      </p>
                    ) : null
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
