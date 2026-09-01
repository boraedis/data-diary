"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { DurationInput } from "@/components/ui/duration-input";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import { EntertainmentLocationTypeField } from "@/components/entry-forms/entertainment-location-type-field";
import type { EntertainmentLocationTypeItem } from "@/lib/catalog-admin";
import type { BookCatalogItem, BooksPayload, DayPayload } from "@/lib/days";
import type { GoogleBooksSearchResult } from "@/lib/google-books";

type Row = {
  bookId: number;
  startPage: number | null;
  endPage: number | null;
  completed: boolean;
  locationType: string | null;
  durationMinutes: number | null;
};

function toSearchItem(book: BookCatalogItem): SearchItem {
  return { id: book.id, primary: book.title, secondary: book.authors.length > 0 ? book.authors.join(", ") : null };
}

/** Debounced live Google Books search — the one flow in this form that hits
 * the network per keystroke (everything else searches the already-loaded
 * local catalog in memory, same as every other entry form). Picking a
 * result upserts it into the local `books` catalog server-side (see
 * src/app/api/books/route.ts) so its real metadata is cached for every
 * future session — the client never types in a title or author by hand for
 * books. Mirrors TmdbSearchModal in movie-entry-form.tsx exactly. */
export function GoogleBooksSearchModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (item: BookCatalogItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GoogleBooksSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) return;
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/google-books/search?q=${encodeURIComponent(trimmed)}`);
        const body = await res.json();
        if (!res.ok) {
          setError(typeof body?.error === "string" ? body.error : "Search failed");
          setResults([]);
          return;
        }
        setError(null);
        setResults(body as GoogleBooksSearchResult[]);
      } catch {
        setError("Network error");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, open]);

  // Query was cleared (or a previous search's results are still sitting in
  // state) — derive the "nothing to show" case at render time instead of
  // resetting `results`/`searching` synchronously from the effect above.
  const trimmedQuery = query.trim();
  const displayResults = trimmedQuery ? results : [];
  const isSearching = trimmedQuery ? searching : false;

  async function handlePick(result: GoogleBooksSearchResult) {
    setAddingId(result.googleBooksId);
    setError(null);
    try {
      const res = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleBooksId: result.googleBooksId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to add");
        return;
      }
      onAdded(body as BookCatalogItem);
      setQuery("");
      setResults([]);
    } catch {
      setError("Network error");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setQuery("");
        setResults([]);
        setError(null);
        onClose();
      }}
      title="Add from Google Books"
    >
      <div className="flex flex-col gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles or authors…"
          autoFocus
        />
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border md:max-h-96">
          {isSearching ? (
            <p className="p-4 text-sm text-muted-foreground">Searching…</p>
          ) : displayResults.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {trimmedQuery ? "No matches." : "Start typing a title or author."}
            </p>
          ) : (
            displayResults.map((r) => (
              <button
                key={r.googleBooksId}
                type="button"
                onClick={() => handlePick(r)}
                disabled={addingId !== null}
                className="flex w-full items-center gap-3 border-b border-border px-3.5 py-2.5 text-left last:border-b-0 hover:bg-accent disabled:opacity-50"
              >
                {r.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumbnailUrl} alt="" className="h-12 w-8 shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-12 w-8 shrink-0 rounded bg-muted" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-base">{r.title}</p>
                  {r.authors.length > 0 ? (
                    <p className="truncate text-sm text-muted-foreground">{r.authors.join(", ")}</p>
                  ) : null}
                </div>
                {addingId === r.googleBooksId ? (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">Adding…</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

/** The "log this session" modal — opens the moment a book is picked (either
 * from the local catalog via search, or freshly added from Google Books),
 * and is also how an already-logged session gets edited. Mirrors
 * MovieDetailModal's reuse-for-both-add-and-edit pattern. */
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
  initial: Omit<Row, "bookId"> | null;
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  onClose: () => void;
  onSave: (value: Omit<Row, "bookId">) => void;
}) {
  const [startPage, setStartPage] = useState<string>(initial?.startPage !== null && initial?.startPage !== undefined ? String(initial.startPage) : "");
  const [endPage, setEndPage] = useState<string>(initial?.endPage !== null && initial?.endPage !== undefined ? String(initial.endPage) : "");
  const [completed, setCompleted] = useState(initial?.completed ?? false);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(initial?.durationMinutes ?? null);
  const [locationType, setLocationType] = useState(initial?.locationType ?? "");

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
            <Label htmlFor="book-detail-duration">Duration</Label>
            <DurationInput id="book-detail-duration" totalMinutes={durationMinutes} onChange={setDurationMinutes} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="book-detail-location">Where</Label>
            <EntertainmentLocationTypeField
              id="book-detail-location"
              value={locationType || null}
              onChange={(value) => setLocationType(value ?? "")}
              items={locationTypes}
              onCreated={onLocationTypeCreated}
            />
          </div>

          <Button
            type="button"
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

export function BookEntryForm({
  date,
  initial,
  catalog,
  locationTypes: initialLocationTypes,
}: {
  date: string;
  initial: DayPayload["bookSessions"];
  catalog: BookCatalogItem[];
  locationTypes: EntertainmentLocationTypeItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<BookCatalogItem[]>(catalog);
  const [rows, setRows] = useState<Row[]>(
    initial.map((s) => ({
      bookId: s.bookId,
      startPage: s.startPage,
      endPage: s.endPage,
      completed: s.completed,
      locationType: s.locationType,
      durationMinutes: s.durationMinutes,
    }))
  );
  const [locationTypes, setLocationTypes] = useState(initialLocationTypes);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [detail, setDetail] = useState<{ book: BookCatalogItem; editIndex: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const editingRow = detail?.editIndex !== null && detail?.editIndex !== undefined ? rows[detail.editIndex] : null;

  function handleAdded(item: BookCatalogItem) {
    setItems((prev) => (prev.some((b) => b.id === item.id) ? prev : [...prev, item].sort((a, b) => a.title.localeCompare(b.title))));
    setSearchModalOpen(false);
    setDetail({ book: item, editIndex: null });
  }

  function openForPick(id: number) {
    const book = items.find((b) => b.id === id);
    if (!book) return;
    setDetail({ book, editIndex: null });
  }

  function openForEdit(index: number) {
    const row = rows[index];
    const book = items.find((b) => b.id === row.bookId);
    if (!book) return;
    setDetail({ book, editIndex: index });
  }

  function saveDetail(value: Omit<Row, "bookId">) {
    if (!detail) return;
    setSavedAt(null);
    setRows((prev) => {
      if (detail.editIndex !== null) {
        const next = [...prev];
        next[detail.editIndex] = { bookId: detail.book.id, ...value };
        return next;
      }
      return [...prev, { bookId: detail.book.id, ...value }];
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

    const payload: BooksPayload = { entries: rows };

    try {
      const res = await fetch(`/api/days/${date}/books`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setRows(
        saved.bookSessions.map((s) => ({
          bookId: s.bookId,
          startPage: s.startPage,
          endPage: s.endPage,
          completed: s.completed,
          locationType: s.locationType,
          durationMinutes: s.durationMinutes,
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
          <CardTitle>Books</CardTitle>
          <CardDescription>
            {rows.length === 0 ? "None logged yet." : `${rows.length} logged.`} Search something you&apos;ve read
            before, or add a new one from Google Books.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rows.length > 0 ? (
            <div className="flex flex-col gap-2">
              {rows.map((row, i) => {
                const book = items.find((b) => b.id === row.bookId);
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <button type="button" onClick={() => openForEdit(i)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm">{book?.title ?? "Unknown"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.startPage !== null || row.endPage !== null
                          ? `p. ${row.startPage ?? "?"}–${row.endPage ?? "?"}`
                          : null}
                        {row.completed ? " · finished" : ""}
                        {row.locationType ? ` · ${row.locationType}` : ""}
                      </p>
                    </button>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => removeRow(i)}>
                      &times;
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Add a book</Label>
              <Button type="button" variant="outline" size="xs" onClick={() => setSearchModalOpen(true)}>
                + Add from Google Books
              </Button>
            </div>
            <SearchPanel
              items={items.map(toSearchItem)}
              onSelect={openForPick}
              placeholder="Search books you've logged before…"
              emptyMessage="No matches — try “+ Add from Google Books”."
            />
          </div>
        </CardContent>
      </Card>

      <GoogleBooksSearchModal open={searchModalOpen} onClose={() => setSearchModalOpen(false)} onAdded={handleAdded} />

      <BookSessionDetailModal
        key={detail ? `${detail.book.id}-${detail.editIndex ?? "new"}` : "closed"}
        open={detail !== null}
        book={detail?.book ?? null}
        initial={editingRow ?? null}
        locationTypes={locationTypes}
        onLocationTypeCreated={(item) =>
          setLocationTypes((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))
        }
        onClose={() => setDetail(null)}
        onSave={saveDetail}
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
