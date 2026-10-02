import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { todayDateString } from "@/lib/date";
import { listRecapYears } from "@/lib/recap";
import {
  CHAPTER_KIND_LABELS,
  chapterSpanLabel,
  listRecapChapters,
  type RecapChapterSummary,
} from "@/lib/recap-chapters";
import { getUnseenRecaps } from "@/lib/recap-seen";

export const dynamic = "force-dynamic";

// The recap year index (issue #169, epic #130). Same card-grid shape as
// /charts, and deliberately not a curated list: the years come from the
// data itself, so every historical year is reachable the moment this ships
// rather than only years that happen to fall after it (#130's backfill
// requirement) — minus any year whose recap isn't published yet (#517), so
// the current year appears only once its period is complete.
//
// Below the years, the life chapters (#519): every finished job, home and
// relationship as its own recap, derived from the profile tables by the
// same rule. They aren't badged as new — #518's seen-set is keyed on
// calendar periods, and a chapter only appears when you record its end,
// which is a moment you already know about.

function NewBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
      {children}
    </span>
  );
}

export default async function RecapIndexPage() {
  const [years, unseen, chapters] = await Promise.all([
    listRecapYears(),
    getUnseenRecaps(),
    listRecapChapters(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Recap</h1>
        <Link href="/home" className="text-xs text-muted-foreground hover:text-foreground">
          Home
        </Link>
      </div>

      {years.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recap is ready yet — each one appears a few days after its month or year ends, once
          there are days to summarize.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
          {years.map((year) => {
            // Each unopened recap is marked individually (#518): the year
            // itself, and separately any of its months.
            const yearIsNew = unseen.years.includes(year.year);
            const newMonths = unseen.months.filter((m) => m.startsWith(`${year.year}-`)).length;
            return (
              <Link key={year.year} href={`/recap/${year.year}`}>
                <Card className="h-full transition-colors hover:bg-accent">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {year.year}
                      {yearIsNew ? <NewBadge>New</NewBadge> : null}
                      {newMonths > 0 ? (
                        <NewBadge>
                          {newMonths} new month{newMonths === 1 ? "" : "s"}
                        </NewBadge>
                      ) : null}
                    </CardTitle>
                    <CardDescription>
                      {year.loggedDays === 0
                        ? "No days logged this year."
                        : `${year.loggedDays} day${year.loggedDays === 1 ? "" : "s"} logged.`}
                      {year.published ? null : " Year in progress — months available."}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {chapters.length > 0 ? <ChaptersIndex chapters={chapters} /> : null}
    </main>
  );
}

/**
 * The chapters, grouped by kind and newest first within each — the same
 * order as the years above. A job's roles (promotions) are listed inside
 * its card rather than as cards of their own, since they're chapters of
 * that job; a role whose job isn't listed yet (an earlier role at the
 * current job) stands on its own under Work.
 */
function ChaptersIndex({ chapters }: { chapters: RecapChapterSummary[] }) {
  const today = todayDateString();
  const listed = new Set(chapters.map((chapter) => chapter.key));
  const nested = (chapter: RecapChapterSummary) =>
    chapter.kind === "role" && chapter.parentKey !== null && listed.has(chapter.parentKey);
  const rolesByJob = new Map<string, RecapChapterSummary[]>();
  for (const chapter of chapters) {
    if (!nested(chapter) || chapter.parentKey === null) continue;
    rolesByJob.set(chapter.parentKey, [...(rolesByJob.get(chapter.parentKey) ?? []), chapter]);
  }
  const groupOf = (chapter: RecapChapterSummary) => (chapter.kind === "role" ? "work" : chapter.kind);
  const topLevel = chapters.filter((chapter) => !nested(chapter)).reverse();

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-xl font-medium tracking-tight">Chapters</h2>
        <p className="text-sm text-muted-foreground">
          Each job, home and relationship as its own recap, once it has ended.
        </p>
      </div>
      {(Object.keys(CHAPTER_KIND_LABELS) as (keyof typeof CHAPTER_KIND_LABELS)[]).map((kind) => {
        const inGroup = topLevel.filter((chapter) => groupOf(chapter) === kind);
        if (inGroup.length === 0) return null;
        return (
          <div key={kind} className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-muted-foreground">{CHAPTER_KIND_LABELS[kind]}</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
              {inGroup.map((chapter) => (
                <ChapterCard
                  key={chapter.key}
                  chapter={chapter}
                  roles={rolesByJob.get(chapter.key) ?? []}
                  today={today}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** "312 of 1,580 days logged." Out of the chapter's length, not just a
 * count, because chapters that began before the diary did are listed too —
 * a bare "110 days" on an eight-year job hides that most of it predates
 * the log, and the report's insufficient-data states are about to say so. */
function loggedLine(chapter: RecapChapterSummary): string {
  return `${chapter.loggedDays.toLocaleString()} of ${chapter.lengthDays.toLocaleString()} days logged.`;
}

function ChapterCard({
  chapter,
  roles,
  today,
}: {
  chapter: RecapChapterSummary;
  roles: RecapChapterSummary[];
  today: string;
}) {
  const href = `/recap/chapters/${chapter.key}`;
  return (
    <Card className="relative h-full transition-colors hover:bg-accent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {/* The profile entry's own colour, as on the life-events card —
              identity, not a palette slot. */}
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: chapter.color ?? "var(--muted-foreground)" }}
          />
          {/* Stretched over the card so the whole card is the link, while
              the role links below stay their own targets (no nested <a>). */}
          <Link href={href} className="after:absolute after:inset-0">
            {chapter.title}
          </Link>
        </CardTitle>
        <CardDescription>
          {chapterSpanLabel(chapter, today)}
          <br />
          {loggedLine(chapter)}
        </CardDescription>
        {roles.length > 0 ? (
          <ul className="relative z-10 mt-2 flex flex-col gap-1 border-t pt-2">
            {roles.map((role) => (
              <li key={role.key} className="text-xs">
                <Link
                  href={`/recap/chapters/${role.key}`}
                  className="underline-offset-2 hover:underline"
                >
                  {role.detail ?? role.title}
                </Link>{" "}
                <span className="text-muted-foreground">· {chapterSpanLabel(role, today)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardHeader>
    </Card>
  );
}
