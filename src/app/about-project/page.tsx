import type { Metadata } from "next";
import Link from "next/link";
import { ProseSection as Section } from "@/components/prose-section";
import { ProjectVersionTimeline } from "@/components/project-version-timeline";
import { buttonVariants } from "@/components/ui/button";
import { PROJECT_VERSIONS } from "@/lib/project-versions";
import { formatDate } from "@/lib/viz/format";

export const metadata: Metadata = {
  title: "About the project — Data Diary",
  description:
    "What Data Diary is, what gets logged, and why any of it is public.",
};

// Static, hand-authored content (#85) — deliberately not pulled from the
// DB. See the DB-vs-repo split locked in on #12: short structured facts
// like the tagline live in projectSettings for the hero to use, but a
// full essay like this one is copy, not data, and belongs in the repo
// where it can be reviewed and versioned like any other change. The
// version timeline (#454) follows the same rule: its data is a typed
// constant in src/lib/project-versions.ts, not a table.

/** "Feb 2016", or "c. 2019" for a start that's only a best guess. */
function formatVersionStart(start: string, approximate?: boolean): string {
  return approximate ? `c. ${start.slice(0, 4)}` : formatDate(start, "monthYear");
}

export default function AboutProjectPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-16 md:py-24">
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-4xl font-medium tracking-tight text-primary italic md:text-5xl">
          About the project
        </h1>
        <p className="text-lg text-muted-foreground">
          Data Diary is a statistical diary — one row per day, for as long as
          it&rsquo;s been kept.
        </p>
      </div>

      <Section title="What gets logged">
        <p>
          Every day gets its own entry: sleep and wake times, weight, a
          happiness score and a reason behind it, work, productivity, phone and
          laptop usage, the people spent time with, the places visited, and
          whatever was watched, read, or played. Some of it is a few taps; some
          of it is a short journal entry. Together, day after day, it adds up
          into something closer to a dataset than a diary in the usual sense.
        </p>
        <p>
          The charts linked from the front page are what that data looks like
          once there&rsquo;s enough of it to see a shape — trends in weight and
          happiness, sleep patterns over a year, who gets logged together most
          often, and more being added over time.
        </p>
      </Section>

      <Section title="A rebuild, not a rewrite of the idea">
        <p>
          This app has existed in one form or another since 2016: a
          spreadsheet, then a command-line tool, then an Express/EJS site
          backed by Firestore. This version is a from-scratch rebuild on
          Next.js and Postgres — same daily habit, same categories, a schema
          and a codebase built to actually hold up as the years of data keep
          growing rather than one more one-off script bolted onto the last
          one.
        </p>
        <ProjectVersionTimeline />
        <ol className="flex flex-col gap-3">
          {PROJECT_VERSIONS.map((version, i) => {
            const next = PROJECT_VERSIONS[i + 1];
            return (
              <li key={version.id} className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">
                  {version.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {formatVersionStart(version.start, version.approximateStart)} –{" "}
                    {next ? formatVersionStart(next.start, next.approximateStart) : "now"}
                  </span>
                </span>
                <span>{version.description}</span>
              </li>
            );
          })}
        </ol>
      </Section>

      <Section title="Why any of this is public">
        <p>
          This project has doubled as my homepage for several years, so the
          front page is a place for a visitor to get a sense of both the project
          and about me — a curated slice of the data that you can interact with
          to explore my life and interests.
        </p>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Back to the front page
        </Link>
        <Link
          href="/about-me"
          className={buttonVariants({ variant: "outline" })}
        >
          About me
        </Link>
        <Link
          href="/public-charts"
          className={buttonVariants({ variant: "outline" })}
        >
          Explore the charts
        </Link>
      </div>
    </main>
  );
}
