"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CatalogPicker, type CatalogItem } from "@/components/entry-forms/catalog-picker";
import { PLACE_SLOTS, type DayPayload, type PlacesPayload } from "@/lib/days";

function hydrate(entries: { slot: number; placeId: number }[]): (number | null)[] {
  const arr: (number | null)[] = Array(PLACE_SLOTS).fill(null);
  for (const e of entries) {
    if (e.slot < PLACE_SLOTS) arr[e.slot] = e.placeId;
  }
  return arr;
}

export function PlacesEntryForm({
  date,
  initial,
  catalog,
}: {
  date: string;
  initial: PlacesPayload;
  catalog: CatalogItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>(catalog);
  const [slots, setSlots] = useState<(number | null)[]>(() => hydrate(initial.entries));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function handleCreated(item: CatalogItem) {
    setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
  }

  function setSlot(slot: number, placeId: number | null) {
    setSavedAt(null);
    setSlots((prev) => prev.map((v, i) => (i === slot ? placeId : v)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const entries: PlacesPayload["entries"] = slots
      .map((placeId, slot) => (placeId !== null ? { slot, placeId } : null))
      .filter((e): e is PlacesPayload["entries"][number] => e !== null);

    try {
      const res = await fetch(`/api/days/${date}/places`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setSlots(hydrate(saved.places));
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-20">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Places</CardTitle>
          <CardDescription>
            {PLACE_SLOTS} places — pick from your places list, or add somewhere new.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {slots.map((placeId, slot) => (
            <CatalogPicker
              key={slot}
              id={`place-${slot}`}
              itemLabel="Place"
              items={items}
              valueId={placeId}
              onChange={(id) => setSlot(slot, id)}
              onCreated={handleCreated}
              createApiPath="/api/places"
              addLabel="New place"
            />
          ))}
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3">
          <span className="text-sm">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : savedAt ? (
              <span className="text-muted-foreground">Saved.</span>
            ) : null}
          </span>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
