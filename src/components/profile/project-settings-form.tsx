"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PROJECT_DEFAULTS } from "@/lib/project-defaults";
import type { ProjectSettingsItem } from "@/lib/project";

/**
 * The public landing page's project name / tagline / goals summary (#452) —
 * the `projectSettings` row #82 added with an API but no UI. Lives on
 * /profile beside the owner-identity form rather than its own /manage page:
 * it's one singleton row of the same "about this diary" kind, not a
 * catalog. Each field's placeholder is the fallback copy `/` renders when
 * it's blank, so clearing a field visibly means "use the default" rather
 * than "show nothing".
 */
export function ProjectSettingsForm({ initial }: { initial: ProjectSettingsItem }) {
  const [name, setName] = useState(initial.name ?? "");
  const [tagline, setTagline] = useState(initial.tagline ?? "");
  const [goalsSummary, setGoalsSummary] = useState(initial.goalsSummary ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/project-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || null,
          tagline: tagline.trim() || null,
          goalsSummary: goalsSummary.trim() || null,
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
        <CardTitle>Public site</CardTitle>
        <CardDescription>
          What visitors see at the top of the public landing page. Leave a field blank to use the default shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="project-name">Project name</Label>
          <Input
            id="project-name"
            value={name}
            placeholder={PROJECT_DEFAULTS.name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-tagline">Tagline</Label>
          <Input
            id="project-tagline"
            value={tagline}
            placeholder={PROJECT_DEFAULTS.tagline}
            onChange={(e) => setTagline(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-goals">Goals summary</Label>
          <Textarea
            id="project-goals"
            rows={4}
            value={goalsSummary}
            placeholder={PROJECT_DEFAULTS.goalsSummary}
            onChange={(e) => setGoalsSummary(e.target.value)}
          />
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <div className="flex items-center gap-3">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
          <a
            href="/"
            target="_blank"
            rel="noopener"
            className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            View public site
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
