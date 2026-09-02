import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "About the project — Data Diary",
  description: "What Data Diary is, what gets logged, and why any of it is public.",
};

// Static, hand-authored content (#85) — deliberately not pulled from the
// DB. See the DB-vs-repo split locked in on #12: short structured facts
// like the tagline live in projectSettings for the hero to use, but a
// full essay like this one is copy, not data, and belongs in the repo
// where it can be reviewed and versioned like any other change.
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-xl font-medium tracking-tight text-primary">{title}</h2>
      <div className="flex flex-col gap-3 text-muted-foreground">{children}</div>
    </section>
  );
}

export default function AboutProjectPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-16 md:py-24">
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-4xl font-medium tracking-tight text-primary italic md:text-5xl">
          About the project
        </h1>
        <p className="text-lg text-muted-foreground">
          Data Diary is a statistical diary — one row per day, for as long as it&rsquo;s been kept.
        </p>
      </div>

      <Section title="What gets logged">
        <p>
          Every day gets its own entry: sleep and wake times, weight and body composition, a
          happiness score with a reason behind it, work and productivity, phone and laptop usage,
          the people spent time with, the places visited, and whatever was watched, read, or
          played. Some of it is a few taps; some of it is a short journal entry. Together, day
          after day, it adds up into something closer to a dataset than a diary in the usual
          sense.
        </p>
        <p>
          The charts linked from the front page are what that data looks like once there&rsquo;s enough
          of it to see a shape — trends in weight and happiness, sleep patterns over a year, who
          gets logged together most often, and more being added over time.
        </p>
      </Section>

      <Section title="A rebuild, not a rewrite of the idea">
        <p>
          This app has existed for years, first as an Express/EJS site backed by Firestore. This
          version is a from-scratch rebuild on Next.js and Postgres — same daily habit, same
          categories, a schema and a codebase built to actually hold up as the years of data keep
          growing rather than one more one-off script bolted onto the last one.
        </p>
      </Section>

      <Section title="Why any of this is public">
        <p>
          This project has always doubled as its owner&rsquo;s personal homepage, so the front
          page is a place for a visitor to get a sense of both the project and the person behind
          it — a curated, deliberately limited slice of the data (see the front page for the
          charts and numbers that are actually shared), not the whole diary.
        </p>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Back to the front page
        </Link>
        <Link href="/about-me" className={buttonVariants({ variant: "outline" })}>
          About me
        </Link>
        <Link href="/public-charts" className={buttonVariants({ variant: "outline" })}>
          Explore the charts
        </Link>
      </div>
    </main>
  );
}
