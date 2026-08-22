"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DayPayload, PlaceEntry, PlacesPayload } from "@/lib/days";

function emptyPlace(sortOrder: number): PlaceEntry {
  return { name: "", sortOrder };
}

export function PlacesEntryForm({ date, initial }: { date: string; initial: PlacesPayload }) {
  const router = useRouter();
  const [places, setPlaces] = useState<PlacesPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function updateEntry(index: number, patch: Partial<PlaceEntry>) {
    setSavedAt(null);
    setPlaces((prev) => {
      const next = [...prev.places];
      next[index] = { ...next[index], ...patch };
      return { places: next };
    });
  }

  function addEntry() {
    setSavedAt(null);
    setPlaces((prev) => ({ places: [...prev.places, emptyPlace(prev.places.length)] }));
  }

  function removeEntry(index: number) {
    setSavedAt(null);
    setPlaces((prev) => ({
      places: prev.places
        .filter((_, i) => i !== index)
        .map((p, i) => ({ ...p, sortOrder: i })),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/days/${date}/places`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(places),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setPlaces({ places: saved.places });
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
            {places.places.length === 0 ? "None logged yet." : `${places.places.length} logged.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {places.places.map((entry, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`place-name-${i}`}>Name</Label>
                <Input
                  id={`place-name-${i}`}
                  value={entry.name}
                  onChange={(e) => updateEntry(i, { name: e.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Remove place"
                onClick={() => removeEntry(i)}
              >
                &times;
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={addEntry}>
            + Add place
          </Button>
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
