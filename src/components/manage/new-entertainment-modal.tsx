"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { EntertainmentCatalogItem } from "@/lib/days";
import type { EntertainmentKindItem } from "@/lib/catalog-admin";

// Kind choices are restricted to custom (non-system) kinds — Movie/TV
// show/Sport/Book/Game each have their own dedicated catalog and entry
// flow (TMDB, Google Books, the sport/league/team hierarchy); creating one
// through this generic modal instead would fragment the data (see the
// entertainmentKinds table comment in schema.ts). The server enforces this
// too (createEntertainmentCatalogEntry in src/lib/days.ts) — filtering the
// dropdown here is just so the rejection never has to happen.
export function NewEntertainmentModal({
  open,
  onClose,
  onCreated,
  kinds,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: EntertainmentCatalogItem) => void;
  kinds: EntertainmentKindItem[];
}) {
  const customKinds = kinds.filter((k) => !k.isSystem);
  const [kindId, setKindId] = useState<number | null>(customKinds[0]?.id ?? null);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setKindId(customKinds[0]?.id ?? null);
    setTitle("");
    setDetail("");
    setError(null);
  }

  async function handleCreate() {
    if (!title.trim() || kindId === null) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/entertainment-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kindId, title: title.trim(), detail: detail.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as EntertainmentCatalogItem);
      reset();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New entertainment"
    >
      {customKinds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Movie/TV show/Sport/Book/Game each have their own page — add it from there instead. To log something
          else, add a custom kind first (the &ldquo;+ New kind&rdquo; button above).
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="manage-new-entertainment-kind">Kind</Label>
            <Select
              id="manage-new-entertainment-kind"
              value={kindId ?? ""}
              onChange={(e) => setKindId(e.target.value ? Number(e.target.value) : null)}
            >
              {customKinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manage-new-entertainment-title">Title</Label>
            <Input
              id="manage-new-entertainment-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manage-new-entertainment-detail">Detail</Label>
            <Input
              id="manage-new-entertainment-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="year, author, platform…"
            />
          </div>
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
          <Button type="button" onClick={handleCreate} disabled={creating || !title.trim() || kindId === null}>
            {creating ? "Adding…" : "Add"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
