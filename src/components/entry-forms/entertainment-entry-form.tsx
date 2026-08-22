"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DurationInput } from "@/components/ui/duration-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  EntertainmentPicker,
  type EntertainmentCatalogItem,
} from "@/components/entry-forms/entertainment-picker";
import type { DayPayload } from "@/lib/days";

type Row = { entertainmentId: number | null; durationMinutes: number | null; notes: string | null };

export function EntertainmentEntryForm({
  date,
  initial,
  catalog,
}: {
  date: string;
  initial: DayPayload["entertainment"];
  catalog: EntertainmentCatalogItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<EntertainmentCatalogItem[]>(catalog);
  const [rows, setRows] = useState<Row[]>(
    initial.map((e) => ({
      entertainmentId: e.entertainmentId,
      durationMinutes: e.durationMinutes,
      notes: e.notes,
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function handleCreated(item: EntertainmentCatalogItem) {
    setItems((prev) => [...prev, item].sort((a, b) => a.title.localeCompare(b.title)));
  }

  function updateRow(index: number, patch: Partial<Row>) {
    setSavedAt(null);
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setSavedAt(null);
    setRows((prev) => [...prev, { entertainmentId: null, durationMinutes: null, notes: null }]);
  }

  function removeRow(index: number) {
    setSavedAt(null);
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const entries = rows.filter(
      (r): r is { entertainmentId: number; durationMinutes: number | null; notes: string | null } =>
        r.entertainmentId !== null
    );

    try {
      const res = await fetch(`/api/days/${date}/entertainment`, {
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
      setRows(
        saved.entertainment.map((e) => ({
          entertainmentId: e.entertainmentId,
          durationMinutes: e.durationMinutes,
          notes: e.notes,
        }))
      );
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
            {rows.length === 0 ? "None logged yet." : `${rows.length} logged.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rows.map((row, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="space-y-1.5">
                <Label htmlFor={`entertainment-${i}`}>Title</Label>
                <EntertainmentPicker
                  id={`entertainment-${i}`}
                  items={items}
                  valueId={row.entertainmentId}
                  onChange={(id) => updateRow(i, { entertainmentId: id })}
                  onCreated={handleCreated}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`entertainment-duration-${i}-hours`}>Duration</Label>
                <DurationInput
                  id={`entertainment-duration-${i}`}
                  totalMinutes={row.durationMinutes}
                  onChange={(v) => updateRow(i, { durationMinutes: v })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`entertainment-notes-${i}`}>Notes</Label>
                <Input
                  id={`entertainment-notes-${i}`}
                  value={row.notes ?? ""}
                  onChange={(e) => updateRow(i, { notes: e.target.value || null })}
                />
              </div>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                className="self-start"
                onClick={() => removeRow(i)}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={addRow}>
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
