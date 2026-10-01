import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

// The read-only overview of every entertainment ranking and watchlist (#549).
// Pure presentation over plain rows: the page maps each type's own list
// readers into this shape, so adding a type that gets a ranking or watchlist
// is one more section there, not a change here. Nothing on this page edits
// anything — every entry and every section header links through to the
// existing per-type page.

export type ListEntry = {
  id: number;
  title: string;
  /** Year, authors, "added <date>" — whatever the type has to tell two
   * entries apart. */
  detail?: string | null;
  href: string;
};

export type ListSection = {
  /** "Top 10", "Watchlist". */
  label: string;
  /** The type's own editor for this list. */
  editHref: string;
  entries: ListEntry[];
  /** Ranked lists number their rows; a watchlist is just ordered. */
  ranked: boolean;
};

export type EntertainmentTypeLists = {
  type: string;
  lists: ListSection[];
};

function ListBlock({ section }: { section: ListSection }) {
  const ListTag = section.ranked ? "ol" : "ul";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{section.label}</h3>
        <Link href={section.editHref} className={buttonVariants({ variant: "outline", size: "xs" })}>
          Edit
        </Link>
      </div>
      {section.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ListTag className="flex flex-col divide-y divide-border rounded-md border border-border">
          {section.entries.map((entry, i) => (
            <li key={entry.id} className="flex items-baseline gap-3 px-3 py-2">
              {section.ranked ? (
                <span className="w-6 shrink-0 text-right font-mono text-sm text-muted-foreground">{i + 1}</span>
              ) : null}
              <Link href={entry.href} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate text-sm">{entry.title}</span>
                {entry.detail ? <span className="block truncate text-xs text-muted-foreground">{entry.detail}</span> : null}
              </Link>
            </li>
          ))}
        </ListTag>
      )}
    </div>
  );
}

export function EntertainmentListsView({ types }: { types: EntertainmentTypeLists[] }) {
  return (
    <div className="flex flex-col gap-6">
      {types.map((t) => (
        <Card key={t.type}>
          <CardHeader>
            <CardTitle>{t.type}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {t.lists.map((section) => (
              <ListBlock key={section.label} section={section} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
