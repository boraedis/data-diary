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
import type { DayPayload, PeoplePayload, PersonEntry } from "@/lib/days";

function emptyPerson(sortOrder: number): PersonEntry {
  return { name: "", valence: "positive", sortOrder };
}

export function PeopleEntryForm({ date, initial }: { date: string; initial: PeoplePayload }) {
  const router = useRouter();
  const [people, setPeople] = useState<PeoplePayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function updateEntry(index: number, patch: Partial<PersonEntry>) {
    setSavedAt(null);
    setPeople((prev) => {
      const next = [...prev.people];
      next[index] = { ...next[index], ...patch };
      return { people: next };
    });
  }

  function addEntry() {
    setSavedAt(null);
    setPeople((prev) => ({ people: [...prev.people, emptyPerson(prev.people.length)] }));
  }

  function removeEntry(index: number) {
    setSavedAt(null);
    setPeople((prev) => ({
      people: prev.people
        .filter((_, i) => i !== index)
        .map((p, i) => ({ ...p, sortOrder: i })),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/days/${date}/people`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(people),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setPeople({ people: saved.people });
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
            {people.people.length === 0 ? "None logged yet." : `${people.people.length} logged.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {people.people.map((entry, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`person-name-${i}`}>Name</Label>
                <Input
                  id={`person-name-${i}`}
                  value={entry.name}
                  onChange={(e) => updateEntry(i, { name: e.target.value })}
                />
              </div>
              <div className="w-32 space-y-1.5">
                <Label htmlFor={`person-valence-${i}`}>Valence</Label>
                <Select
                  id={`person-valence-${i}`}
                  value={entry.valence}
                  onChange={(e) =>
                    updateEntry(i, { valence: e.target.value as PersonEntry["valence"] })
                  }
                >
                  <option value="positive">Positive</option>
                  <option value="negative">Negative</option>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Remove person"
                onClick={() => removeEntry(i)}
              >
                &times;
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={addEntry}>
            + Add person
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
