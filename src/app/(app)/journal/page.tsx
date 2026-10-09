import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { JournalSearch } from "@/components/journal/journal-search";
import { getJournalPage, splitOnMatches, type JournalEntry } from "@/lib/journal";
import { journalHref } from "@/lib/journal-href";
import { formatDate } from "@/lib/viz/format";

// Reads the journal corpus live on every request, like every other page
// in the authenticated app.
export const dynamic = "force-dynamic";

/** `searchParams` hands back `string | string[]` for a repeated param
 * (`?q=a&q=b`). Nothing in this UI produces one, but a hand-edited URL
 * can, and the first value is the sane reading of it. */
function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function Highlighted({ text, query }: { text: string; query: string }) {
  // `whitespace-pre-wrap` keeps the paragraph breaks the entry was
  // written with — a journal entry is prose, not a single-line field.
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {splitOnMatches(text, query).map((segment, i) =>
        segment.match ? (
          <mark key={i} className="rounded-sm bg-primary/25 px-0.5 text-foreground">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

function EntryCard({ entry, query }: { entry: JournalEntry; query: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        <div className="flex items-center justify-between gap-3">
          {/* Links to the day as a whole rather than straight to the
              journal section that owns the field: reading an old
              entry, the usual next question is what the rest of that day
              looked like, and the day hub is one hop from the editor. */}
          <Link
            href={`/day/${entry.date}`}
            className="text-xs font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
          >
            {formatDate(entry.date, "weekdayYear")}
          </Link>
          {/* The day's finalized video log (#343). Straight to the Record
              pane, where it plays; the date link above goes to the day hub. */}
          {entry.hasVideo ? (
            <Link
              href={`/day/${entry.date}/journal?mode=record`}
              className="shrink-0 rounded-full border border-primary/40 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              ▶ {entry.videoLogNumber !== null ? `Video log #${entry.videoLogNumber}` : "Video log"}
            </Link>
          ) : null}
        </div>
        <Highlighted text={entry.journal} query={query} />
      </CardContent>
    </Card>
  );
}

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const query = first(params.q);
  const year = first(params.year);
  const requestedPage = Number.parseInt(first(params.page), 10);
  const video = first(params.video) === "1";

  const data = await getJournalPage({
    search: query,
    year,
    video,
    page: Number.isNaN(requestedPage) ? 1 : requestedPage,
  });

  const searching = query.trim().length > 0;
  const summary = data.total === 1 ? "1 entry" : `${data.total.toLocaleString()} entries`;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Journal</h1>
        <p className="shrink-0 text-sm text-muted-foreground">
          {summary}
          {searching ? " matching" : null}
        </p>
      </div>

      <JournalSearch search={query.trim()} year={year} video={video} />

      <div className="flex flex-wrap gap-1.5">
        {/* Days with a finalized video log only (#343). A toggle, kept
            across year changes and searches. */}
        <YearChip
          label="▶ With video"
          href={journalHref({ search: query, year, video: !video })}
          active={video}
        />
        {data.years.length > 0 ? (
          <>
            <YearChip label="All years" href={journalHref({ search: query, video })} active={!year} />
            {data.years.map((facet) => (
              <YearChip
                key={facet.year}
                label={`${facet.year} (${facet.entryCount})`}
                href={journalHref({ search: query, year: facet.year, video })}
                active={year === facet.year}
              />
            ))}
          </>
        ) : null}
      </div>

      {data.entries.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {searching
              ? `No entries matching “${query.trim()}”${video ? " with a video log" : ""}.`
              : video
                ? "No entries with a video log yet."
                : "No journal entries yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {data.entries.map((entry) => (
            <EntryCard key={entry.date} entry={entry} query={query} />
          ))}
        </div>
      )}

      {data.pageCount > 1 ? (
        <div className="flex items-center justify-between gap-4">
          <PageLink
            label="← Newer"
            href={journalHref({ search: query, year, video, page: data.page - 1 })}
            disabled={data.page <= 1}
          />
          <span className="text-sm text-muted-foreground">
            Page {data.page} of {data.pageCount}
          </span>
          <PageLink
            label="Older →"
            href={journalHref({ search: query, year, video, page: data.page + 1 })}
            disabled={data.page >= data.pageCount}
          />
        </div>
      ) : null}
    </main>
  );
}

function YearChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}

function PageLink({ label, href, disabled }: { label: string; href: string; disabled: boolean }) {
  if (disabled) {
    return (
      <span className={buttonVariants({ variant: "outline", size: "sm", className: "pointer-events-none opacity-40" })}>
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
      {label}
    </Link>
  );
}
