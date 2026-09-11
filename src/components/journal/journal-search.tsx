"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { journalHref } from "@/lib/journal-href";

/** Debounced search box for /journal (issue #288).
 *
 * The only client component on the page — the year chips and pagination
 * are plain server-rendered links, since they're a single navigation each
 * and need no local state. This one exists because search-as-you-type
 * against the URL needs to hold the in-progress text somewhere and not
 * navigate on every keystroke.
 *
 * Current values arrive as props from the server page rather than through
 * `useSearchParams`, so this component stays a leaf with no dependency on
 * the request's own search params.
 */
export function JournalSearch({ search, year }: { search: string; year: string }) {
  const router = useRouter();
  const [value, setValue] = useState(search);

  useEffect(() => {
    // Already showing what's typed (including right after a navigation
    // this box itself triggered) — nothing to push.
    if (value.trim() === search) return;
    const timer = setTimeout(() => {
      // Deliberately drops the page param: a changed search means the
      // old page number points into a different result set. `replace`
      // rather than `push` so back doesn't walk through every keystroke.
      router.replace(journalHref({ search: value, year }));
    }, 250);
    return () => clearTimeout(timer);
  }, [value, search, year, router]);

  return (
    <Input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Search journal…"
      aria-label="Search journal entries"
    />
  );
}
