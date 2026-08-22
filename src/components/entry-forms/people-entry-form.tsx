"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CatalogPicker, type CatalogItem } from "@/components/entry-forms/catalog-picker";
import { NEGATIVE_PEOPLE_SLOTS, POSITIVE_PEOPLE_SLOTS, type DayPayload, type PeoplePayload } from "@/lib/days";

type SlotEntries = { slot: number; valence: "positive" | "negative"; personId: number }[];

function hydrate(entries: SlotEntries, valence: "positive" | "negative", count: number): (number | null)[] {
  const arr: (number | null)[] = Array(count).fill(null);
  for (const e of entries) {
    if (e.valence === valence && e.slot < count) arr[e.slot] = e.personId;
  }
  return arr;
}

export function PeopleEntryForm({
  date,
  initial,
  catalog,
}: {
  date: string;
  initial: PeoplePayload;
  catalog: CatalogItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>(catalog);
  const [positive, setPositive] = useState<(number | null)[]>(() =>
    hydrate(initial.entries, "positive", POSITIVE_PEOPLE_SLOTS)
  );
  const [negative, setNegative] = useState<(number | null)[]>(() =>
    hydrate(initial.entries, "negative", NEGATIVE_PEOPLE_SLOTS)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function handleCreated(item: CatalogItem) {
    setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
  }

  function setSlot(valence: "positive" | "negative", slot: number, personId: number | null) {
    setSavedAt(null);
    if (valence === "positive") {
      setPositive((prev) => prev.map((v, i) => (i === slot ? personId : v)));
    } else {
      setNegative((prev) => prev.map((v, i) => (i === slot ? personId : v)));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const entries: PeoplePayload["entries"] = [
      ...positive.map((personId, slot) =>
        personId !== null ? { slot, valence: "positive" as const, personId } : null
      ),
      ...negative.map((personId, slot) =>
        personId !== null ? { slot, valence: "negative" as const, personId } : null
      ),
    ].filter((e): e is PeoplePayload["entries"][number] => e !== null);

    try {
      const res = await fetch(`/api/days/${date}/people`, {
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
      setPositive(hydrate(saved.people, "positive", POSITIVE_PEOPLE_SLOTS));
      setNegative(hydrate(saved.people, "negative", NEGATIVE_PEOPLE_SLOTS));
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
          <CardTitle>People</CardTitle>
          <CardDescription>
            {POSITIVE_PEOPLE_SLOTS} positive, {NEGATIVE_PEOPLE_SLOTS} negative — pick from your people
            list, or add someone new.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label>Positive</Label>
            {positive.map((personId, slot) => (
              <CatalogPicker
                key={`positive-${slot}`}
                id={`person-positive-${slot}`}
                itemLabel="Person"
                items={items}
                valueId={personId}
                onChange={(id) => setSlot("positive", slot, id)}
                onCreated={handleCreated}
                createApiPath="/api/people"
                addLabel="New person"
              />
            ))}
          </div>
          <div className="space-y-2">
            <Label>Negative</Label>
            {negative.map((personId, slot) => (
              <CatalogPicker
                key={`negative-${slot}`}
                id={`person-negative-${slot}`}
                itemLabel="Person"
                items={items}
                valueId={personId}
                onChange={(id) => setSlot("negative", slot, id)}
                onCreated={handleCreated}
                createApiPath="/api/people"
                addLabel="New person"
              />
            ))}
          </div>
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
