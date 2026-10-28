import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FindingActions, RunScanButton } from "@/components/manage/inconsistency-actions";
import type { InconsistencyStatus } from "@/db/schema";
import {
  FINDING_STATUSES,
  FINDING_TYPES,
  TYPE_LABELS,
  findingHref,
  parseFindingStatus,
  partialFieldLinks,
} from "@/lib/inconsistency-scan/links";
import {
  countFindingsByStatus,
  getLastScanRun,
  listFindings,
  type ReviewFinding,
} from "@/lib/inconsistency-scan/review";
import { formatDate } from "@/lib/viz/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// The data-inconsistency scan's review page (#672, epic #13): what the
// scan flagged, grouped by kind, each linking to the day section where
// it's fixed. Under Manage because that's where you go to fix data, not
// log it. The status tabs live in the URL (?status=…) so a refresh after
// an action keeps you on the same list.

const STATUS_LABELS: Record<InconsistencyStatus, string> = {
  open: "Open",
  dismissed: "Dismissed",
  resolved: "Resolved",
};

const EMPTY: Record<InconsistencyStatus, string> = {
  open: "Nothing to review.",
  dismissed: "Nothing dismissed.",
  resolved: "Nothing resolved yet.",
};

function lastScanLine(run: Awaited<ReturnType<typeof getLastScanRun>>): string {
  if (!run) return "Never scanned. Run a scan to find inconsistencies.";
  const when = run.startedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const how = run.trigger === "scheduled" ? "monthly run" : "manual run";
  return `Last scanned ${when} (${how}): ${run.added} new, ${run.resolved} resolved.`;
}

// Only the scan resolves findings (#685), when they stop reproducing, so
// the Resolved tab is a read-only history. Dismissed ones say when.
function reviewNote(f: ReviewFinding): string | null {
  if (f.status === "resolved") return "No longer detected";
  if (f.status === "dismissed" && f.reviewedAt) {
    return `Dismissed ${f.reviewedAt.toLocaleDateString(undefined, { dateStyle: "medium" })}`;
  }
  return null;
}

// A partially filled day lists several fields; each links to the section
// that fixes it (#685) instead of one link to the whole day.
function Detail({ f }: { f: ReviewFinding }) {
  const links = f.type === "partial" ? partialFieldLinks(f) : [];
  if (links.length === 0) return <span className="text-sm text-muted-foreground">{f.detail}</span>;
  return (
    <span className="text-sm text-muted-foreground">
      Missing:{" "}
      {links.map((l, i) => (
        <span key={l.label}>
          {i > 0 ? ", " : null}
          {l.href ? (
            <Link href={l.href} className="underline underline-offset-4 hover:text-foreground">
              {l.label}
            </Link>
          ) : (
            l.label
          )}
        </span>
      ))}
    </span>
  );
}

export default async function InconsistenciesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const raw = (await searchParams).status;
  const status = parseFindingStatus(Array.isArray(raw) ? raw[0] : raw) ?? "open";
  const [findings, counts, lastRun] = await Promise.all([
    listFindings(status),
    countFindingsByStatus(),
    getLastScanRun(),
  ]);

  const groups = FINDING_TYPES.map((type) => ({
    type,
    items: findings.filter((f) => f.type === type),
  })).filter((g) => g.items.length > 0);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-3xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Inconsistencies</h1>
        <Link href="/manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Manage Home
        </Link>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted-foreground">{lastScanLine(lastRun)}</p>
        <RunScanButton />
      </div>

      <nav className="flex gap-1 border-b" aria-label="Status">
        {FINDING_STATUSES.map((s) => (
          <Link
            key={s}
            href={s === "open" ? "/manage/inconsistencies" : `/manage/inconsistencies?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              s === status
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {STATUS_LABELS[s]} <span className="font-mono text-xs">{counts[s]}</span>
          </Link>
        ))}
      </nav>

      {groups.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{EMPTY[status]}</p>
      ) : (
        groups.map(({ type, items }) => (
          <Card key={type}>
            <CardHeader>
              <div className="flex items-baseline justify-between gap-4">
                <CardTitle>{TYPE_LABELS[type].title}</CardTitle>
                <span className="font-mono text-sm text-muted-foreground">{items.length}</span>
              </div>
              <p className="text-sm text-muted-foreground">{TYPE_LABELS[type].blurb}</p>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y">
                {items.map((f) => {
                  const href = findingHref(f);
                  const note = reviewNote(f);
                  return (
                    <li key={f.id} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-col">
                        {href && f.date ? (
                          <Link href={href} className="text-sm font-medium underline-offset-4 hover:underline">
                            {formatDate(f.date, "weekdayYear")}
                          </Link>
                        ) : null}
                        <Detail f={f} />
                        {note ? <span className="text-xs text-muted-foreground/80">{note}</span> : null}
                      </div>
                      {f.status === "resolved" ? null : <FindingActions id={f.id} status={f.status} />}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </main>
  );
}
