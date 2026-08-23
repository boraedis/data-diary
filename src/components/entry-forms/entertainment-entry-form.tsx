"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { DurationInput } from "@/components/ui/duration-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import type { DayPayload, EntertainmentCatalogItem } from "@/lib/days";
import type { EntertainmentKind } from "@/db/schema";

export const ENTERTAINMENT_KIND_LABELS: Record<EntertainmentKind, string> = {
  movie: "Movie",
  tvshow: "TV show",
  sport: "Sport",
  book: "Book",
  game: "Game",
};

type Row = { entertainmentId: number; durationMinutes: number | null; notes: string | null };

function toSearchItem(item: EntertainmentCatalogItem): SearchItem {
  return {
    id: item.id,
    primary: item.title,
    secondary: item.detail
      ? `${ENTERTAINMENT_KIND_LABELS[item.kind]} · ${item.detail}`
      : ENTERTAINMENT_KIND_LABELS[item.kind],
  };
}

/** "+ New entertainment" catalog-creation modal — a new entry needs a kind
 * picked alongside its title, since the catalog's identity is (kind, title)
 * not title alone ("Dune" the book and "Dune" the movie are different
 * rows). `detail` (year/author/platform) is a free-text disambiguator
 * standing in for what a TMDB/book-catalog lookup would give for free. */
function NewEntertainmentModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: EntertainmentCatalogItem) => void;
}) {
  const [kind, setKind] = useState<EntertainmentKind>("movie");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setKind("movie");
    setTitle("");
    setDetail("");
    setError(null);
  }

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
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-entertainment-kind">Kind</Label>
          <Select
            id="new-entertainment-kind"
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
          <Label htmlFor="new-entertainment-title">Title</Label>
          <Input
            id="new-entertainment-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-entertainment-detail">Detail</Label>
          <Input
            id="new-entertainment-detail"
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
  );
}

/** The "inner details" modal — opens the moment you pick something in the
 * search panel (or right after creating a brand-new catalog entry), and is
 * also how an already-logged entry gets edited. Just the two things that
 * vary per viewing/reading/playing session, not per catalog item: how long,
 * and any notes. */
function EntertainmentDetailModal({
  open,
  item,
  initialDurationMinutes,
  initialNotes,
  onClose,
  onSave,
}: {
  open: boolean;
  item: EntertainmentCatalogItem | null;
  initialDurationMinutes: number | null;
  initialNotes: string | null;
  onClose: () => void;
  onSave: (durationMinutes: number | null, notes: string | null) => void;
}) {
  // This modal is reused for both "log a new entry" and "edit an existing
  // one" — the caller remounts it with a fresh `key` per item/edit-target
  // (see the render below) so these reset to the right initial values
  // instead of carrying over whatever was last typed.
  const [durationMinutes, setDurationMinutes] = useState<number | null>(initialDurationMinutes);
  const [notes, setNotes] = useState(initialNotes ?? "");

  return (
    <Modal open={open} onClose={onClose} title={item?.title ?? ""}>
      {item ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {item.detail
              ? `${ENTERTAINMENT_KIND_LABELS[item.kind]} · ${item.detail}`
              : ENTERTAINMENT_KIND_LABELS[item.kind]}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="entertainment-detail-duration-hours">Duration</Label>
            <DurationInput
              id="entertainment-detail-duration"
              totalMinutes={durationMinutes}
              onChange={setDurationMinutes}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entertainment-detail-notes">Notes</Label>
            <Input
              id="entertainment-detail-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button type="button" onClick={() => onSave(durationMinutes, notes.trim() || null)}>
            Save
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

export function EntertainmentEntryForm({
  date,
  initial,
  catalog,
}: {
  date: string;
  initial: DayPayload["entertainment"];
  catalog: EntertainmentCatalogItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<EntertainmentCatalogItem[]>(catalog);
  const [rows, setRows] = useState<Row[]>(
    initial.map((e) => ({
      entertainmentId: e.entertainmentId,
      durationMinutes: e.durationMinutes,
      notes: e.notes,
    }))
  );
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [detail, setDetail] = useState<{ item: EntertainmentCatalogItem; editIndex: number | null } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const editingRow = detail?.editIndex !== null && detail?.editIndex !== undefined ? rows[detail.editIndex] : null;

  function handleCreated(item: EntertainmentCatalogItem) {
    setItems((prev) => [...prev, item].sort((a, b) => a.title.localeCompare(b.title)));
    setDetail({ item, editIndex: null });
  }

  function openForPick(id: number) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setDetail({ item, editIndex: null });
  }

  function openForEdit(index: number) {
    const row = rows[index];
    const item = items.find((i) => i.id === row.entertainmentId);
    if (!item) return;
    setDetail({ item, editIndex: index });
  }

  function saveDetail(durationMinutes: number | null, notes: string | null) {
    if (!detail) return;
    setSavedAt(null);
    setRows((prev) => {
      if (detail.editIndex !== null) {
        const next = [...prev];
        next[detail.editIndex] = { entertainmentId: detail.item.id, durationMinutes, notes };
        return next;
      }
      return [...prev, { entertainmentId: detail.item.id, durationMinutes, notes }];
    });
    setDetail(null);
  }

  function removeRow(index: number) {
    setSavedAt(null);
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/days/${date}/entertainment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: rows }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setRows(
        saved.entertainment.map((e) => ({
          entertainmentId: e.entertainmentId,
          durationMinutes: e.durationMinutes,
          notes: e.notes,
        }))
      );
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
          <CardTitle>Entertainment</CardTitle>
          <CardDescription>
            {rows.length === 0 ? "None logged yet." : `${rows.length} logged.`} Search to pick something —
            it'll ask for duration and notes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rows.length > 0 ? (
            <div className="flex flex-col gap-2">
              {rows.map((row, i) => {
                const item = items.find((it) => it.id === row.entertainmentId);
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => openForEdit(i)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm">{item?.title ?? "Unknown"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item ? ENTERTAINMENT_KIND_LABELS[item.kind] : null}
                        {row.durationMinutes ? ` · ${row.durationMinutes} min` : ""}
                        {row.notes ? ` · ${row.notes}` : ""}
                      </p>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Remove"
                      onClick={() => removeRow(i)}
                    >
                      &times;
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Add entertainment</Label>
              <Button type="button" variant="outline" size="xs" onClick={() => setNewModalOpen(true)}>
                + New entertainment
              </Button>
            </div>
            <SearchPanel
              items={items.map(toSearchItem)}
              onSelect={openForPick}
              placeholder="Search entertainment…"
              emptyMessage="No matches — try “+ New entertainment”."
            />
          </div>
        </CardContent>
      </Card>

      <NewEntertainmentModal
        open={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        onCreated={handleCreated}
      />

      <EntertainmentDetailModal
        key={detail ? `${detail.item.id}-${detail.editIndex ?? "new"}` : "closed"}
        open={detail !== null}
        item={detail?.item ?? null}
        initialDurationMinutes={editingRow?.durationMinutes ?? null}
        initialNotes={editingRow?.notes ?? null}
        onClose={() => setDetail(null)}
        onSave={saveDetail}
      />

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
