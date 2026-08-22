"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DayPayload, TechnologyPayload } from "@/lib/days";

function parseNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function TechnologyEntryForm({
  date,
  initial,
}: {
  date: string;
  initial: TechnologyPayload;
}) {
  const router = useRouter();
  const [technology, setTechnology] = useState<TechnologyPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function set<K extends keyof TechnologyPayload>(key: K, value: TechnologyPayload[K]) {
    setSavedAt(null);
    setTechnology((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/days/${date}/technology`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(technology),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setTechnology({
        phoneUsageMinutes: saved.phoneUsageMinutes,
        laptopUsageMinutes: saved.laptopUsageMinutes,
        instagramUsageMinutes: saved.instagramUsageMinutes,
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
          <CardTitle>Technology</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="phoneUsageMinutes">Phone usage (minutes)</Label>
            <Input
              id="phoneUsageMinutes"
              type="number"
              step="1"
              min="0"
              value={technology.phoneUsageMinutes ?? ""}
              onChange={(e) => set("phoneUsageMinutes", parseNumber(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="laptopUsageMinutes">Laptop usage (minutes)</Label>
            <Input
              id="laptopUsageMinutes"
              type="number"
              step="1"
              min="0"
              value={technology.laptopUsageMinutes ?? ""}
              onChange={(e) => set("laptopUsageMinutes", parseNumber(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="instagramUsageMinutes">Instagram usage (minutes)</Label>
            <Input
              id="instagramUsageMinutes"
              type="number"
              step="1"
              min="0"
              value={technology.instagramUsageMinutes ?? ""}
              onChange={(e) => set("instagramUsageMinutes", parseNumber(e.target.value))}
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
