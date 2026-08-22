"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { SearchCombobox } from "@/components/entry-forms/search-combobox";
import type { SearchItem } from "@/components/entry-forms/search-panel";
import type { EntertainmentKind } from "@/db/schema";

export type EntertainmentCatalogItem = {
  id: number;
  kind: EntertainmentKind;
  title: string;
  detail: string | null;
};

export const ENTERTAINMENT_KIND_LABELS: Record<EntertainmentKind, string> = {
  movie: "Movie",
  tvshow: "TV show",
  sport: "Sport",
  book: "Book",
  game: "Game",
};

/** Search-and-select-from-catalog + "+ New" modal for entertainment. Unlike
 * the plain CatalogPicker (exercise locations), a new entertainment entry
 * needs a kind picked alongside its title — the catalog's identity is
 * (kind, title), not title alone ("Dune" the book and "Dune" the movie are
 * different rows. `detail` is a free-text disambiguator (a year, an author,
 * a platform — whatever tells two same-titled entries apart) shown as each
 * result's secondary line alongside the kind; the legacy app got this for
 * free from TMDB/catalog lookups, this catalog isn't wired to an external
 * API so it's just typed in. */
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
  const [detail, setDetail] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchItems: SearchItem[] = items.map((item) => ({
    id: item.id,
    primary: item.title,
    secondary: item.detail
      ? `${ENTERTAINMENT_KIND_LABELS[item.kind]} · ${item.detail}`
      : ENTERTAINMENT_KIND_LABELS[item.kind],
  }));

  async function handleCreate() {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/entertainment-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title: title.trim(), detail: detail.trim() || null }),
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
      setDetail("");
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
        <SearchCombobox
          id={id}
          items={searchItems}
          valueId={valueId}
          onChange={onChange}
          placeholder="Search entertainment…"
        />
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
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-new-detail`}>Detail</Label>
            <Input
              id={`${id}-new-detail`}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="year, author, platform…"
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
