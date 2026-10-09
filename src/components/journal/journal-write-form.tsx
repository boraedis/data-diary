"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import type { DayPayload } from "@/lib/days";

/** The "Write" half of the Journal section (#340). Same field and data as
 * the old journal box on the Happiness page, given room: a journal entry
 * is paragraphs, not a one-line reason. Writing is a first-class way to
 * journal, not a fallback for days without a recording (#338, 2026-10-08
 * decisions). */
export function JournalWriteForm({ date, initial }: { date: string; initial: string | null }) {
  const router = useRouter();
  const [journal, setJournal] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Easy to lose a paragraph of writing to an accidental nav click (#143).
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/days/${date}/journal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journal: journal || null }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      setJournal((body as DayPayload).journal ?? "");
      setDirty(false);
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 pb-20">
      <Label htmlFor="journal" className="sr-only">
        Journal
      </Label>
      <Textarea
        id="journal"
        rows={14}
        value={journal}
        placeholder="How was the day?"
        className="min-h-[40vh] leading-relaxed"
        onChange={(e) => {
          setJournal(e.target.value);
          setSavedAt(null);
          setDirty(true);
        }}
      />

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
