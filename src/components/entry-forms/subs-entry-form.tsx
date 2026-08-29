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
import { SUB_NAMES, type DayPayload, type SubsPayload } from "@/lib/days";

function hydrate(entries: SubsPayload["entries"]): (number | null)[] {
  const byName = new Map(entries.map((e) => [e.name, e.value]));
  return SUB_NAMES.map((name) => byName.get(name) ?? null);
}

function parseValue(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(0, Math.round(n)));
}

// Fixed set of nine subs, straight from the legacy Firestore config doc
// (`entry_structure/Subs`) that wasn't reachable during this migration — the
// user supplied the real names directly rather than guessing at them. See
// SUB_NAMES in src/lib/days.ts.
export function SubsEntryForm({ date, initial }: { date: string; initial: SubsPayload }) {
  const router = useRouter();
  const [values, setValues] = useState<(number | null)[]>(() => hydrate(initial.entries));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function setValue(index: number, value: number | null) {
    setSavedAt(null);
    setValues((prev) => prev.map((v, i) => (i === index ? value : v)));
  }

  function fillBlanksWithZero() {
    setSavedAt(null);
    setValues((prev) => prev.map((v) => v ?? 0));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const entries: SubsPayload["entries"] = SUB_NAMES.map((name, i) => ({ name, value: values[i] }))
      .filter((e): e is { name: (typeof SUB_NAMES)[number]; value: number } => e.value !== null);

    try {
      const res = await fetch(`/api/days/${date}/subs`, {
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
      setValues(hydrate(saved.subs));
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  }

  const blankCount = values.filter((v) => v === null).length;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-20">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Subs</CardTitle>
          <CardDescription>
            {blankCount === 0 ? "All filled in." : `${blankCount} still blank.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {SUB_NAMES.map((name, i) => (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={`sub-${name}`}>{name}</Label>
                <Input
                  id={`sub-${name}`}
                  type="number"
                  step="1"
                  min="0"
                  max="10"
                  value={values[i] ?? ""}
                  onChange={(e) => setValue(i, parseValue(e.target.value))}
                />
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="self-start"
            onClick={fillBlanksWithZero}
            disabled={blankCount === 0}
          >
            Fill blanks with 0
          </Button>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-3 md:max-w-2xl">
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
