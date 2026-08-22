"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import type { EntertainmentKind } from "@/db/schema";

export type EntertainmentCatalogItem = { id: number; kind: EntertainmentKind; title: string };

export const ENTERTAINMENT_KIND_LABELS: Record<EntertainmentKind, string> = {
  movie: "Movie",
  tvshow: "TV show",
  sport: "Sport",
  book: "Book",
  game: "Game",
};

/** Select-from-catalog + "+ New" modal for entertainment. Unlike the plain
 * CatalogPicker (people/places), a new entertainment entry needs a kind
 * picked alongside its title — the catalog's identity is (kind, title), not
 * title alone ("Dune" the book and "Dune" the movie are different rows). */
export function EntertainmentPicker({
  id,
  items,
  valueId,
  onChange,
  onCreated,
}: {
  id: string;
  items: EntertainmentCatalogItem[];
  valueId: number | null;
  onChange: (id: number | null) => void;
  onCreated: (item: EntertainmentCatalogItem) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [kind, setKind] = useState<EntertainmentKind>("movie");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/entertainment-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title: title.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      const created = body as EntertainmentCatalogItem;
      onCreated(created);
      onChange(created.id);
      setTitle("");
      setModalOpen(false);
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Select
          id={id}
          className="flex-1"
          value={valueId ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">—</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} ({ENTERTAINMENT_KIND_LABELS[item.kind]})
            </option>
          ))}
        </Select>
        <Button type="button" variant="outline" size="xs" onClick={() => setModalOpen(true)}>
          + New
        </Button>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New entertainment">
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-new-kind`}>Kind</Label>
            <Select
              id={`${id}-new-kind`}
              value={kind}
              onChange={(e) => setKind(e.target.value as EntertainmentKind)}
            >
              {Object.entries(ENTERTAINMENT_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-new-title`}>Title</Label>
            <Input
              id={`${id}-new-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
          <Button type="button" onClick={handleCreate} disabled={creating || !title.trim()}>
            {creating ? "Adding…" : "Add"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
