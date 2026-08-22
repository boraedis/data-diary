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
import type { DayPayload, SubEntry, SubsPayload } from "@/lib/days";

function emptySub(): SubEntry {
  return { name: "", value: 0 };
}

function parseInt10(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function SubsEntryForm({ date, initial }: { date: string; initial: SubsPayload }) {
  const router = useRouter();
  const [subs, setSubs] = useState<SubsPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function updateEntry(index: number, patch: Partial<SubEntry>) {
    setSavedAt(null);
    setSubs((prev) => {
      const next = [...prev.entries];
      next[index] = { ...next[index], ...patch };
      return { entries: next };
    });
  }

  function addEntry() {
    setSavedAt(null);
    setSubs((prev) => ({ entries: [...prev.entries, emptySub()] }));
  }

  function removeEntry(index: number) {
    setSavedAt(null);
    setSubs((prev) => ({ entries: prev.entries.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/days/${date}/subs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subs),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setSubs({ entries: saved.subs });
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
          <CardTitle>Subscriptions</CardTitle>
          <CardDescription>
            {subs.entries.length === 0 ? "None logged yet." : `${subs.entries.length} logged.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {subs.entries.map((entry, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`sub-name-${i}`}>Name</Label>
                <Input
                  id={`sub-name-${i}`}
                  value={entry.name}
                  onChange={(e) => updateEntry(i, { name: e.target.value })}
                />
              </div>
              <div className="w-24 space-y-1.5">
                <Label htmlFor={`sub-value-${i}`}>Value (0-10)</Label>
                <Input
                  id={`sub-value-${i}`}
                  type="number"
                  step="1"
                  min="0"
                  max="10"
                  value={entry.value}
                  onChange={(e) => updateEntry(i, { value: parseInt10(e.target.value) })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Remove subscription"
                onClick={() => removeEntry(i)}
              >
                &times;
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={addEntry}>
            + Add subscription
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
