"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type { BookCatalogItem, BookProgress, BookUsage } from "@/lib/days";

// No edit mode here (unlike every other catalog) — every field is Google
// Books metadata, refreshed by re-adding rather than typed in. This is just
// a read-only detail view, computed reading progress, the session history,
// and delete. Mirrors MovieDetail's shape closely.
export function BookDetail({
  book,
  usage,
  progress,
}: {
  book: BookCatalogItem;
  usage: BookUsage;
  progress: BookProgress;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <Link href="/manage/entertainment/books" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Books
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{book.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Authors</dt>
            <dd>{book.authors.length > 0 ? book.authors.join(", ") : "—"}</dd>
            <dt className="text-muted-foreground">Publisher</dt>
            <dd>{book.publisher ?? "—"}</dd>
            <dt className="text-muted-foreground">Published</dt>
            <dd>{book.publishedDate ?? "—"}</dd>
            <dt className="text-muted-foreground">Pages</dt>
            <dd>{book.pageCount ?? "—"}</dd>
            <dt className="text-muted-foreground">Categories</dt>
            <dd>{book.categories.length > 0 ? book.categories.join(", ") : "—"}</dd>
            <dt className="text-muted-foreground">Progress</dt>
            <dd>
              {progress.currentPage !== null
                ? `p. ${progress.currentPage}${book.pageCount ? ` / ${book.pageCount}` : ""}`
                : "Not started"}
            </dd>
            <dt className="text-muted-foreground">Completions</dt>
            <dd>{progress.completions}</dd>
          </dl>

          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {usage.sessions.length === 0 ? "No sessions logged" : `${usage.sessions.length} session${usage.sessions.length === 1 ? "" : "s"} logged`}
            </p>
            {usage.sessions.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {usage.sessions.map((s, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <Link href={`/day/${s.date}/entertainment/books`} className="text-primary hover:underline">
                      {s.date}
                    </Link>
                    <span className="text-muted-foreground">
                      {[
                        s.startPage !== null || s.endPage !== null ? `p. ${s.startPage ?? "?"}–${s.endPage ?? "?"}` : null,
                        s.completed ? "finished" : null,
                        s.locationType,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <DeleteCatalogItem
            itemLabel={book.title}
            isBlocked={usage.sessions.length > 0}
            afterDeleteHref="/manage/entertainment/books"
            onDelete={async () => {
              const res = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
              if (!res.ok) throw new Error("Failed to delete");
            }}
            blockedContent={
              <ul className="list-inside list-disc">
                {usage.sessions.map((s, i) => (
                  <li key={i}>
                    <Link href={`/day/${s.date}/entertainment/books`} className="text-primary hover:underline">
                      {s.date}
                    </Link>
                  </li>
                ))}
              </ul>
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
