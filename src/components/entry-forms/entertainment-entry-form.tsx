"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DayPayload, EntertainmentEntry, EntertainmentPayload } from "@/lib/days";

function emptyEntry(): EntertainmentEntry {
  return { kind: "movie", title: "", notes: null };
}

const KIND_LABELS: Record<EntertainmentEntry["kind"], string> = {
  movie: "Movie",
  tvshow: "TV show",
  sport: "Sport",
  book: "Book",
  game: "Game",
};

export function EntertainmentEntryForm({
  date,
  initial,
}: {
  date: string;
  initial: EntertainmentPayload;
}) {
  const router = useRouter();
  const [entertainment, setEntertainment] = useState<EntertainmentPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function updateEntry(index: number, patch: Partial<EntertainmentEntry>) {
    setSavedAt(null);
    setEntertainment((prev) => {
      const next = [...prev.entries];
      next[index] = { ...next[index], ...patch };
      return { entries: next };
    });
  }

  function addEntry() {
    setSavedAt(null);
    setEntertainment((prev) => ({ entries: [...prev.entries, emptyEntry()] }));
  }

  function removeEntry(index: number) {
    setSavedAt(null);
    setEntertainment((prev) => ({ entries: prev.entries.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/days/${date}/entertainment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entertainment),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setEntertainment({ entries: saved.entertainment });
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
          <CardTitle>Entertainment</CardTitle>
          <CardDescription>
            {entertainment.entries.length === 0
              ? "None logged yet."
              : `${entertainment.entries.length} logged.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {entertainment.entries.map((entry, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`ent-kind-${i}`}>Kind</Label>
                  <Select
                    id={`ent-kind-${i}`}
                    value={entry.kind}
                    onChange={(e) =>
                      updateEntry(i, { kind: e.target.value as EntertainmentEntry["kind"] })
                    }
                  >
                    {Object.entries(KIND_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`ent-title-${i}`}>Title</Label>
                  <Input
                    id={`ent-title-${i}`}
                    value={entry.title}
                    onChange={(e) => updateEntry(i, { title: e.target.value })}
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor={`ent-notes-${i}`}>Notes</Label>
                  <Input
                    id={`ent-notes-${i}`}
                    value={entry.notes ?? ""}
                    onChange={(e) => updateEntry(i, { notes: e.target.value || null })}
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                className="mt-3"
                onClick={() => removeEntry(i)}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={addEntry}>
            + Add entry
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
