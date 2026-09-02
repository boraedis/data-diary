"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { GoogleBooksSearchModal } from "@/components/entry-forms/google-books-search-modal";
import type { BookCatalogItem } from "@/lib/days";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(book: BookCatalogItem): SearchItem {
  return { id: book.id, primary: book.title, secondary: book.authors.length > 0 ? book.authors.join(", ") : null };
}

// Reuses the entry form's live-Google-Books-search modal rather than a
// hand-typed "+ New" modal like the other catalogs — a book's fields are
// never typed in, only fetched (see src/lib/google-books.ts), same reasoning
// as MoviesManageList.
export function BooksManageList({ initial }: { initial: BookCatalogItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment/books"
        placeholder="Search books…"
        emptyMessage="No matches."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + Add from Google Books
          </Button>
        }
      />
      <GoogleBooksSearchModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={(item) => {
          setItems((prev) =>
            prev.some((b) => b.id === item.id) ? prev : [...prev, item].sort((a, b) => a.title.localeCompare(b.title))
          );
          setModalOpen(false);
        }}
      />
    </div>
  );
}
