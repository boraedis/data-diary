"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DurationInput } from "@/components/ui/duration-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DayPayload, WorkPayload } from "@/lib/days";

const WORK_LOCATIONS = ["home", "office", "cafe", "travel", "other"] as const;
const COMMUTES = ["car", "carpool", "taxi", "public_transit", "bike", "walk", "other"] as const;

function TogglePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs capitalize transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

export function WorkEntryForm({ date, initial }: { date: string; initial: WorkPayload }) {
  const router = useRouter();
  const [work, setWork] = useState<WorkPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function set<K extends keyof WorkPayload>(key: K, value: WorkPayload[K]) {
    setSavedAt(null);
    setWork((prev) => ({ ...prev, [key]: value }));
  }

  function toggleWorkLocation(value: (typeof WORK_LOCATIONS)[number]) {
    setSavedAt(null);
    setWork((prev) => {
      const next = prev.workLocation.includes(value)
        ? prev.workLocation.filter((v) => v !== value)
        : [...prev.workLocation, value];
      return { ...prev, workLocation: next };
    });
  }

  function toggleCommute(value: (typeof COMMUTES)[number]) {
    setSavedAt(null);
    setWork((prev) => {
      const next = prev.commute.includes(value)
        ? prev.commute.filter((v) => v !== value)
        : [...prev.commute, value];
      return { ...prev, commute: next };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/days/${date}/work`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(work),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setWork({
        productivity: saved.productivity,
        workDurationMinutes: saved.workDurationMinutes,
        workLocation: saved.workLocation,
        commute: saved.commute,
      });
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  }

  const awayFromHome = work.workLocation.some((loc) => loc !== "home");

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-20">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Work</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="productivity">Productivity</Label>
              <span className="font-mono text-sm text-muted-foreground">
                {work.productivity ?? "—"}%
              </span>
            </div>
            <input
              id="productivity"
              type="range"
              min={0}
              max={100}
              step={1}
              value={work.productivity ?? 50}
              onChange={(e) => set("productivity", Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workDurationMinutes-hours">Work duration</Label>
            <DurationInput
              id="workDurationMinutes"
              totalMinutes={work.workDurationMinutes}
              onChange={(v) => set("workDurationMinutes", v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Work location</Label>
            <div className="flex flex-wrap gap-2">
              {WORK_LOCATIONS.map((loc) => (
                <TogglePill key={loc} active={work.workLocation.includes(loc)} onClick={() => toggleWorkLocation(loc)}>
                  {loc.replace("_", " ")}
                </TogglePill>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Commute{awayFromHome ? " (required)" : ""}</Label>
            <div className="flex flex-wrap gap-2">
              {COMMUTES.map((c) => (
                <TogglePill key={c} active={work.commute.includes(c)} onClick={() => toggleCommute(c)}>
                  {c.replace("_", " ")}
                </TogglePill>
              ))}
            </div>
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
