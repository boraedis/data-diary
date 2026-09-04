"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DayPayload, WeightPayload } from "@/lib/days";
import { PercentInput } from "../ui/percent-input";

function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function WeightEntryForm({ date, initial }: { date: string; initial: WeightPayload }) {
  const router = useRouter();
  const [weight, setWeight] = useState<WeightPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function set<K extends keyof WeightPayload>(key: K, value: WeightPayload[K]) {
    setSavedAt(null);
    setWeight((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/days/${date}/weight`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(weight),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setWeight({
        weightKg: saved.weightKg,
        bodyFatPercent: saved.bodyFatPercent,
        muscleMassKg: saved.muscleMassKg,
      });
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
          <CardTitle>Weight</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-6">
          <div className="space-y-1.5">
            <Label htmlFor="weightKg">Weight (kg)</Label>
            <Input
              id="weightKg"
              type="number"
              step="0.05"
              min="0"
              value={weight.weightKg ?? ""}
              onChange={(e) => set("weightKg", parseNumber(e.target.value))}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bodyFatPercent">Body fat (%)</Label>
            <PercentInput
              id="bodyFatPercent"
              value={weight.bodyFatPercent}
              onChange={(value) => set("bodyFatPercent", value)}
              step={0.1}
            ></PercentInput>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="muscleMassKg">Muscle mass (kg)</Label>
            <Input
              id="muscleMassKg"
              type="number"
              step="0.05"
              min="0"
              value={weight.muscleMassKg ?? ""}
              onChange={(e) => set("muscleMassKg", parseNumber(e.target.value))}
            />
          </div>
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
