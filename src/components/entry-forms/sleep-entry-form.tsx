"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DurationInput } from "@/components/ui/duration-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DayPayload, SleepPayload } from "@/lib/days";

export function SleepEntryForm({ date, initial }: { date: string; initial: SleepPayload }) {
  const router = useRouter();
  const [sleep, setSleep] = useState<SleepPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function set<K extends keyof SleepPayload>(key: K, value: SleepPayload[K]) {
    setSavedAt(null);
    setSleep((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/days/${date}/sleep`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sleep),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setSleep({
        sleepTime: saved.sleepTime,
        wakeTime: saved.wakeTime,
        wakeCrossedMidnight: saved.wakeCrossedMidnight,
        sleepLocationType: saved.sleepLocationType,
        sleepLocationSubtype: saved.sleepLocationSubtype,
        napMinutes: saved.napMinutes,
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
          <CardTitle>Sleep</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="sleepTime">Sleep time</Label>
            <Input
              id="sleepTime"
              type="time"
              value={sleep.sleepTime ?? ""}
              onChange={(e) => set("sleepTime", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wakeTime">Wake time</Label>
            <Input
              id="wakeTime"
              type="time"
              value={sleep.wakeTime ?? ""}
              onChange={(e) => set("wakeTime", e.target.value || null)}
            />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={sleep.wakeCrossedMidnight}
              onChange={(e) => set("wakeCrossedMidnight", e.target.checked)}
            />
            Woke up the day after I fell asleep
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="sleepLocationType">Sleep location</Label>
            <Input
              id="sleepLocationType"
              placeholder="e.g. home"
              value={sleep.sleepLocationType ?? ""}
              onChange={(e) => set("sleepLocationType", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sleepLocationSubtype">Sleep location detail</Label>
            <Input
              id="sleepLocationSubtype"
              placeholder="e.g. own bed"
              value={sleep.sleepLocationSubtype ?? ""}
              onChange={(e) => set("sleepLocationSubtype", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="napMinutes-hours">Naps</Label>
            <DurationInput
              id="napMinutes"
              totalMinutes={sleep.napMinutes}
              onChange={(v) => set("napMinutes", v)}
            />
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
