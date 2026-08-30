"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProfileSettingsItem } from "@/lib/profile";

/**
 * Owner identity — name, birthdate, diary start date. See #11's
 * scope-expansion comment: these were previously hardcoded literals
 * scattered across the legacy app (duplicated, occasionally
 * inconsistently formatted) rather than stored anywhere. A simple form
 * above the three timelines on the same profile page, not a separate
 * settings page — per the issue thread's explicit design call. Timezone
 * was deliberately cut from this record's scope (see that thread).
 */
export function OwnerIdentityForm({ initial }: { initial: ProfileSettingsItem }) {
  const [name, setName] = useState(initial.name ?? "");
  const [birthdate, setBirthdate] = useState(initial.birthdate ?? "");
  const [diaryStartDate, setDiaryStartDate] = useState(initial.diaryStartDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/profile/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || null,
          birthdate: birthdate.trim() || null,
          diaryStartDate: diaryStartDate.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setSaved(true);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>About you</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="owner-name">Name</Label>
          <Input id="owner-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="owner-birthdate">Birthdate</Label>
            <Input
              id="owner-birthdate"
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner-diary-start">Diary start date</Label>
            <Input
              id="owner-diary-start"
              type="date"
              value={diaryStartDate}
              onChange={(e) => setDiaryStartDate(e.target.value)}
            />
          </div>
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <div className="flex items-center gap-3">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
