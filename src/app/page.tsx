import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getPublicLandingData } from "@/lib/public-profile";
import { parseDate } from "@/lib/date";

// Never statically cache this — it's live data, same reasoning as
// src/app/home/page.tsx's own dynamic dashboard.
export const dynamic = "force-dynamic";

const DEFAULT_TAGLINE = "A statistical diary of one life, logged one day at a time.";
const DEFAULT_GOALS =
  "Every day gets a row here — sleep, mood, work, the people and places that filled it — and this site is where the shape of that adds up over time.";

// getPublicLandingData is wrapped in React's cache() (see public-profile.ts)
// so this and the page component below only hit the DB once per request,
// not twice (#87).
export async function generateMetadata(): Promise<Metadata> {
  const { project } = await getPublicLandingData();
  const title = project.name ?? "Data Diary";
  const description = project.tagline ?? DEFAULT_TAGLINE;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

function formatLifePct(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(1)}%`;
}

function formatDaysSinceLastLog(n: number | null): string {
  if (n === null) return "—";
  if (n <= 0) return "Today";
  if (n === 1) return "1 day ago";
  return `${n} days ago`;
}

// Whole years + months since diaryStartDate, e.g. "2 years, 4 months" —
// hand-rolled rather than pulled from src/lib/viz/format.ts, which formats
// chart axis/tooltip values, not this kind of "how long has this been
// running" prose.
function formatRunningFor(diaryStartDate: string | null): string {
  if (!diaryStartDate) return "a while";
  const start = parseDate(diaryStartDate);
  const today = new Date();
  let years = today.getFullYear() - start.getFullYear();
  let months = today.getMonth() - start.getMonth();
  if (today.getDate() < start.getDate()) months--;
  if (months < 0) {
    years--;
    months += 12;
  }
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (months > 0 || years === 0) parts.push(`${months} month${months === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl border bg-card/70 px-6 py-5 text-center shadow-sm backdrop-blur-sm">
      <span className="text-3xl font-semibold tabular-nums text-primary md:text-4xl">{value}</span>
      <span className="text-xs font-medium tracking-widest text-muted-foreground uppercase">{label}</span>
    </div>
  );
}

export default async function LandingPage() {
  const { project, ownerName, diaryStartDate, stats } = await getPublicLandingData();

  const projectName = project.name ?? "Data Diary";
  const tagline = project.tagline ?? DEFAULT_TAGLINE;
  const goals = project.goalsSummary ?? DEFAULT_GOALS;
  const intro = ownerName
    ? `Written and logged by ${ownerName}, running for ${formatRunningFor(diaryStartDate)} now.`
    : `Running for ${formatRunningFor(diaryStartDate)} now.`;

  return (
    <main className="relative flex min-h-svh flex-col items-center overflow-hidden px-4 py-16 md:py-24">
      {/* Facelapse (see #12): a rotating self-portrait timelapse was floated
          for this hero but has no photo pipeline yet, so it's explicitly
          out of scope here (#83). This gradient band is left as the visual
          slot it would eventually sit in — not empty space, but nothing
          that assumes a specific future layout either. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-br from-primary/10 via-transparent to-chart-3/10"
      />

      <div className="flex w-full max-w-3xl flex-col items-center gap-5 text-center">
        <h1 className="font-heading text-5xl font-medium tracking-tight text-primary italic md:text-6xl">
          {projectName}
        </h1>
        <p className="text-lg text-muted-foreground md:text-xl">{tagline}</p>
        <p className="max-w-2xl text-balance text-muted-foreground">{goals}</p>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </div>

      <div className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Days logged" value={String(stats.daysLogged)} />
        <StatTile label="% of life logged" value={formatLifePct(stats.percentOfLifeLogged)} />
        <StatTile label="Last log" value={formatDaysSinceLastLog(stats.daysSinceLastLog)} />
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link href="/public-charts" className={buttonVariants({ size: "lg" })}>
          Explore the charts
        </Link>
        <Link href="/about-project" className={buttonVariants({ variant: "outline", size: "lg" })}>
          About the project
        </Link>
        <Link href="/about-me" className={buttonVariants({ variant: "outline", size: "lg" })}>
          About me
        </Link>
      </div>

      <Link
        href="/login"
        className="mt-12 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Owner? Sign in
      </Link>
    </main>
  );
}
