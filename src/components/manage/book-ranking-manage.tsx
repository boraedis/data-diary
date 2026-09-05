"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import type { BookCatalogItem, BookRankingItem } from "@/lib/days";
import { RANKING_SIZE } from "@/lib/days";

function toSearchItem(book: BookCatalogItem): SearchItem {
  return { id: book.id, primary: book.title, secondary: book.authors.length > 0 ? book.authors.join(", ") : null };
}

/** Top-10 ranked list — mirrors MovieRankingManage exactly, see that file's
 * comment for the reasoning (position-as-data replace-all writes, plain
 * up/down reordering). */
export function BookRankingManage({ initial, allBooks }: { initial: BookRankingItem[]; allBooks: BookCatalogItem[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rankedIds = new Set(items.map((i) => i.bookId));
  const pickableBooks = allBooks.filter((b) => !rankedIds.has(b.id));

  async function commit(next: BookRankingItem[]) {
    const previous = items;
    setItems(next);
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/books/ranking", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookIds: next.map((i) => i.bookId) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setItems(previous);
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
      }
    } catch {
      setItems(previous);
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  function addBook(book: BookCatalogItem) {
    if (items.length >= RANKING_SIZE) return;
    void commit([
      ...items,
      { rank: items.length + 1, bookId: book.id, title: book.title, thumbnailUrl: book.thumbnailUrl, authors: book.authors },
    ]);
  }

  function removeBook(bookId: number) {
    void commit(items.filter((i) => i.bookId !== bookId).map((i, idx) => ({ ...i, rank: idx + 1 })));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    void commit(next.map((i, idx) => ({ ...i, rank: idx + 1 })));
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length < RANKING_SIZE ? (
        <SearchPanel
          items={pickableBooks.map(toSearchItem)}
          onSelect={(id) => {
            const book = allBooks.find((b) => b.id === id);
            if (book) addBook(book);
          }}
          placeholder="Search books to add…"
          emptyMessage="No matches."
        autoFocus
      />
      ) : (
        <p className="text-sm text-muted-foreground">Ranking is full ({RANKING_SIZE}/{RANKING_SIZE}) — remove one to add another.</p>
      )}
      {error ? <span className="text-sm text-destructive">{error}</span> : null}

      <Card size="sm">
        <CardContent className="flex flex-col gap-2">
          {items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing ranked yet.</p> : null}
          {items.map((item, i) => (
            <div key={item.bookId} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <span className="w-5 shrink-0 text-center text-sm font-medium text-muted-foreground">{item.rank}</span>
              {item.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external Google Books CDN image
                <img src={item.thumbnailUrl} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
              ) : (
                <div className="h-14 w-10 shrink-0 rounded bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.title}</p>
                <p className="truncate text-xs text-muted-foreground">{item.authors.length > 0 ? item.authors.join(", ") : null}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Move up" disabled={saving || i === 0} onClick={() => move(i, -1)}>
                  &uarr;
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Move down"
                  disabled={saving || i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  &darr;
                </Button>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" disabled={saving} onClick={() => removeBook(item.bookId)}>
                  &times;
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
