"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { DurationInput } from "@/components/ui/duration-input";
import { NameCatalogField } from "@/components/entry-forms/name-catalog-field";
import { GoogleBooksSearchModal } from "@/components/entry-forms/google-books-search-modal";
import { usePendingOpenMatch, type PendingOpen } from "@/lib/use-pending-open";
import type { EntertainmentLocationTypeItem } from "@/lib/catalog-admin";
import type { BookCatalogItem, BookProgress } from "@/lib/days";

export type BookRow = {
  bookId: number;
  startPage: number | null;
  endPage: number | null;
  completed: boolean;
  locationType: string | null;
  durationMinutes: number | null;
};

/** The "log this session" modal — opens the moment a book is picked (either
 * from the unified search, "+ Add from Google Books", or an already-logged
 * row being edited). A genuinely new pick (no row for it yet today) prefills
 * Start Page from the book's computed bookmark (issue #61) — an already-open
 * or edited row keeps its own saved value instead. "Mark complete" needs no
 * extra wiring: the bookmark/completions are fully computed from session
 * history (see getBookProgress in src/lib/days.ts), so checking Finished
 * here is the entire "remove the bookmark, increment completions" behavior. */
function BookSessionDetailModal({
  open,
  book,
  initial,
  locationTypes,
  onLocationTypeCreated,
  onClose,
  onSave,
}: {
  open: boolean;
  book: BookCatalogItem | null;
  initial: Omit<BookRow, "bookId"> | null;
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  onClose: () => void;
  onSave: (value: Omit<BookRow, "bookId">) => void;
}) {
  const [startPage, setStartPage] = useState<string>(
    initial?.startPage !== null && initial?.startPage !== undefined ? String(initial.startPage) : ""
  );
  const [endPage, setEndPage] = useState<string>(
    initial?.endPage !== null && initial?.endPage !== undefined ? String(initial.endPage) : ""
  );
  const [completed, setCompleted] = useState(initial?.completed ?? false);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(initial?.durationMinutes ?? null);
  const [locationType, setLocationType] = useState(initial?.locationType ?? "");

  useEffect(() => {
    if (!open || !book || initial !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/books/${book.id}/progress`);
        if (!res.ok || cancelled) return;
        const progress = (await res.json()) as BookProgress;
        if (!cancelled && progress.currentPage !== null) {
          setStartPage(String(progress.currentPage));
        }
      } catch {
        // Bookmark prefill is a convenience, not required — leave blank on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-run when the modal opens for a genuinely new book pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, book?.id]);

  return (
    <Modal open={open} onClose={onClose} title={book?.title ?? ""}>
      {book ? (
        <div className="flex flex-col gap-3">
          {book.authors.length > 0 ? (
            <p className="text-xs text-muted-foreground">{book.authors.join(", ")}</p>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="book-detail-start">Start page</Label>
              <Input
                id="book-detail-start"
                type="number"
                min={0}
                step={1}
                value={startPage}
                onChange={(e) => setStartPage(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="book-detail-end">End page</Label>
              <Input
                id="book-detail-end"
                type="number"
                min={0}
                step={1}
                max={book.pageCount ?? undefined}
                value={endPage}
                onChange={(e) => setEndPage(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={completed}
              onChange={(e) => setCompleted(e.target.checked)}
            />
            Finished the book
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="book-detail-duration">Time read</Label>
            <DurationInput id="book-detail-duration" totalMinutes={durationMinutes} onChange={setDurationMinutes} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="book-detail-location">Where</Label>
            <NameCatalogField
              id="book-detail-location"
              value={locationType || null}
              onChange={(value) => setLocationType(value ?? "")}
              items={locationTypes}
              onCreated={onLocationTypeCreated}
              apiPath="/api/entertainment-location-types"
              modalTitle="New location type"
            />
          </div>

          <Button
            type="button"
            disabled={!locationType.trim() || durationMinutes === null}
            onClick={() => {
              const parsedStart = startPage.trim() ? Number(startPage) : null;
              const parsedEnd = endPage.trim() ? Number(endPage) : null;
              onSave({
                startPage: parsedStart !== null && Number.isFinite(parsedStart) ? Math.round(parsedStart) : null,
                endPage: parsedEnd !== null && Number.isFinite(parsedEnd) ? Math.round(parsedEnd) : null,
                completed,
                durationMinutes,
                locationType: locationType.trim() || null,
              });
            }}
          >
            Save
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

export function BooksSection({
  catalog,
  locationTypes,
  onLocationTypeCreated,
  rows,
  onRowsChange,
  pendingOpen,
}: {
  catalog: BookCatalogItem[];
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  rows: BookRow[];
  onRowsChange: (rows: BookRow[]) => void;
  pendingOpen: PendingOpen;
}) {
  const [items, setItems] = useState<BookCatalogItem[]>(catalog);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [detail, setDetail] = useState<{ book: BookCatalogItem; editIndex: number | null } | null>(null);

  const editingRow = detail?.editIndex !== null && detail?.editIndex !== undefined ? rows[detail.editIndex] : null;

  const pendingBookId = usePendingOpenMatch(pendingOpen, "book");
  if (pendingBookId !== null) {
    const book = items.find((b) => b.id === pendingBookId);
    if (book) setDetail({ book, editIndex: null });
  }

  function handleAdded(item: BookCatalogItem) {
    setItems((prev) => (prev.some((b) => b.id === item.id) ? prev : [...prev, item].sort((a, b) => a.title.localeCompare(b.title))));
    setSearchModalOpen(false);
    setDetail({ book: item, editIndex: null });
  }

  function openForEdit(index: number) {
    const row = rows[index];
    const book = items.find((b) => b.id === row.bookId);
    if (!book) return;
    setDetail({ book, editIndex: index });
  }

  function saveDetail(value: Omit<BookRow, "bookId">) {
    if (!detail) return;
    if (detail.editIndex !== null) {
      const next = [...rows];
      next[detail.editIndex] = { bookId: detail.book.id, ...value };
      onRowsChange(next);
    } else {
      onRowsChange([...rows, { bookId: detail.book.id, ...value }]);
    }
    setDetail(null);
  }

  function removeRow(index: number) {
    onRowsChange(rows.filter((_, i) => i !== index));
  }

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Books</CardTitle>
          <Button type="button" variant="outline" size="xs" onClick={() => setSearchModalOpen(true)}>
            + Add from Google Books
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">None logged yet.</p> : null}
        {rows.map((row, i) => {
          const book = items.find((b) => b.id === row.bookId);
          return (
            <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <button type="button" onClick={() => openForEdit(i)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm">{book?.title ?? "Unknown"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.startPage !== null || row.endPage !== null ? `p. ${row.startPage ?? "?"}–${row.endPage ?? "?"}` : null}
                  {row.completed ? " · finished" : ""}
                  {row.durationMinutes ? ` · ${row.durationMinutes} min` : ""}
                  {row.locationType ? ` · ${row.locationType}` : ""}
                </p>
              </button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => removeRow(i)}>
                &times;
              </Button>
            </div>
          );
        })}
      </CardContent>

      <GoogleBooksSearchModal open={searchModalOpen} onClose={() => setSearchModalOpen(false)} onAdded={handleAdded} />

      <BookSessionDetailModal
        key={detail ? `${detail.book.id}-${detail.editIndex ?? "new"}` : "closed"}
        open={detail !== null}
        book={detail?.book ?? null}
        initial={editingRow ?? null}
        locationTypes={locationTypes}
        onLocationTypeCreated={onLocationTypeCreated}
        onClose={() => setDetail(null)}
        onSave={saveDetail}
      />
    </Card>
  );
}
