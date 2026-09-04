"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import { GoogleBooksSearchModal } from "@/components/entry-forms/google-books-search-modal";
import type { BookCatalogItem, BookWatchlistItem } from "@/lib/days";

function toSearchItem(book: BookCatalogItem): SearchItem {
  return { id: book.id, primary: book.title, secondary: book.authors.length > 0 ? book.authors.join(", ") : null };
}

/** "Want to read" list — mirrors MovieWatchlistManage exactly (see that
 * file's comment for the reasoning); the legacy books watchlist itself had
 * no data worth migrating (issue #124 — its own edit UI was broken), so
 * this always starts empty for a fresh install. */
export function BookWatchlistManage({ initial, allBooks }: { initial: BookWatchlistItem[]; allBooks: BookCatalogItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onWatchlistIds = new Set(items.map((i) => i.bookId));
  const pickableBooks = allBooks.filter((b) => !onWatchlistIds.has(b.id));

  async function addBook(book: BookCatalogItem) {
    setError(null);
    try {
      const res = await fetch("/api/books/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: book.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(typeof body?.error === "string" ? body.error : "Failed to add");
        return;
      }
      setItems((prev) => [
        { bookId: book.id, title: book.title, thumbnailUrl: book.thumbnailUrl, authors: book.authors, addedAt: new Date().toISOString().slice(0, 10) },
        ...prev,
      ]);
    } catch {
      setError("Network error");
    }
  }

  async function removeBook(bookId: number) {
    setError(null);
    const previous = items;
    setItems((prev) => prev.filter((i) => i.bookId !== bookId));
    const res = await fetch(`/api/books/watchlist/${bookId}`, { method: "DELETE" });
    if (!res.ok) {
      setItems(previous);
      setError("Failed to remove");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SearchPanel
        items={pickableBooks.map(toSearchItem)}
        onSelect={(id) => {
          const book = allBooks.find((b) => b.id === id);
          if (book) void addBook(book);
        }}
        placeholder="Search books…"
        emptyMessage="No matches."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + Add from Google Books
          </Button>
        }
      />
      {error ? <span className="text-sm text-destructive">{error}</span> : null}

      <Card size="sm">
        <CardContent className="flex flex-col gap-2">
          {items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing on the watchlist.</p> : null}
          {items.map((item) => (
            <div key={item.bookId} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              {item.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external Google Books CDN image
                <img src={item.thumbnailUrl} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
              ) : (
                <div className="h-14 w-10 shrink-0 rounded bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[item.authors.length > 0 ? item.authors.join(", ") : null, item.addedAt ? `added ${item.addedAt}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => removeBook(item.bookId)}>
                &times;
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <GoogleBooksSearchModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={(book) => {
          setModalOpen(false);
          void addBook(book);
        }}
      />
    </div>
  );
}
