"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { BookCatalogItem } from "@/lib/days";
import type { GoogleBooksSearchResult } from "@/lib/google-books";

/** Standalone (extracted from the old day-entry book-entry-form.tsx, issue
 * #61) since both the day-entry books section and the Manage books list's
 * own "+ New" flow need it. Debounced live Google Books search — picking a
 * result upserts it into the local `books` catalog server-side (see
 * src/app/api/books/route.ts) so its real metadata is cached for every
 * future session. Mirrors TmdbMovieSearchModal/TmdbTvSearchModal exactly. */
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
