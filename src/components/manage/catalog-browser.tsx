"use client";

import { useRouter } from "next/navigation";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";

/**
 * Search-and-open list for a /manage/<catalog> page — every catalog's list
 * page is the same shape (search the already-loaded catalog, click through
 * to a detail/edit page), so this is the one genuinely shared piece; the
 * "+ New" trigger and the detail/edit page itself stay bespoke per catalog
 * since their fields differ (see the entry forms' own "+ New" modals for
 * the same reasoning). Reuses SearchPanel — same searchable-list widget the
 * entry forms use to pick a catalog item — just wired to navigate instead
 * of calling back into a form.
 */
export function CatalogBrowser({
  items,
  basePath,
  placeholder,
  emptyMessage,
}: {
  items: SearchItem[];
  basePath: string;
  placeholder?: string;
  emptyMessage?: string;
}) {
  const router = useRouter();
  return (
    <SearchPanel
      items={items}
      onSelect={(id) => router.push(`${basePath}/${id}`)}
      placeholder={placeholder ?? "Search…"}
      emptyMessage={emptyMessage ?? "No matches."}
    />
  );
}
