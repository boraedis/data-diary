"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DayPayload, HappinessPayload } from "@/lib/days";
import { PercentInput } from "../ui/percent-input";

const DAY_TYPES = [
  { value: "", label: "Not set" },
  { value: "work", label: "Work" },
  { value: "dayoff", label: "Day off" },
  { value: "vacation", label: "Vacation" },
  { value: "travel", label: "Travel" },
  { value: "sick", label: "Sick" },
  { value: "jobless", label: "Jobless" },
] as const;

export function HappinessEntryForm({ date, initial }: { date: string; initial: HappinessPayload }) {
  const router = useRouter();
  const [happiness, setHappinessState] = useState<HappinessPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function set<K extends keyof HappinessPayload>(key: K, value: HappinessPayload[K]) {
    setSavedAt(null);
    setHappinessState((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/days/${date}/happiness`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(happiness),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setHappinessState({
        happiness: saved.happiness,
        happinessReason: saved.happinessReason,
        journal: saved.journal,
        dayType: saved.dayType,
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
          <CardTitle>Happiness</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="happiness">Happiness</Label>
            </div>
            <PercentInput
              id="happiness"
              value={happiness.happiness}
              onChange={(value) => set("happiness", value)}
              step={1}
            ></PercentInput>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Input
              id="reason"
              value={happiness.happinessReason ?? ""}
              onChange={(e) => set("happinessReason", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="journal">Journal</Label>
            <Textarea
              id="journal"
              rows={4}
              value={happiness.journal ?? ""}
              onChange={(e) => set("journal", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dayType">Day type</Label>
            <Select
              id="dayType"
              value={happiness.dayType ?? ""}
              onChange={(e) => set("dayType", (e.target.value || null) as HappinessPayload["dayType"])}
            >
              {DAY_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
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
