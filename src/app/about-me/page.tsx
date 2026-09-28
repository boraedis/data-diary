import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ProseSection as Section } from "@/components/prose-section";
import { buttonVariants } from "@/components/ui/button";
import { getPublicLandingData } from "@/lib/public-profile";

export const metadata: Metadata = {
  title: "About me — Data Diary",
  description: "A short introduction to the person behind Data Diary.",
};

// Hand-authored copy, same DB-vs-repo split as /about-project (#12): the
// owner's name comes from profileSettings via the public data layer, but
// everything else here is prose and lives in the repo (#455).
export const dynamic = "force-dynamic";

// Portrait for the header. Binary media lives on Vercel Blob, not in git
// (see AGENTS.md's static asset strategy, #163), so this is a Blob URL
// rather than a file under public/. Empty means no photo: the header falls
// back to the plain text layout instead of an empty frame.
const PORTRAIT_URL = "";

// Off-site profiles for the "Elsewhere" section. An entry with an empty
// href is skipped rather than rendered as a dead link, so the list can be
// filled in one profile at a time.
const ELSEWHERE_LINKS: { label: string; href: string; note?: string }[] = [
  {
    label: "GitHub",
    href: "https://github.com/boraedis",
    note: "including this project's source",
  },
  { label: "LinkedIn", href: "" },
  { label: "Email", href: "" },
];

export default async function AboutMePage() {
  const { ownerName } = await getPublicLandingData();
  const name = ownerName ?? "the person behind this project";
  const links = ELSEWHERE_LINKS.filter((link) => link.href);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-16 md:py-24">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        {PORTRAIT_URL && (
          <Image
            src={PORTRAIT_URL}
            alt={`Portrait of ${name}`}
            width={160}
            height={160}
            priority
            className="size-32 shrink-0 rounded-full object-cover ring-2 ring-primary/40 md:size-40"
          />
        )}
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-4xl font-medium tracking-tight text-primary italic md:text-5xl">
            About me
          </h1>
          <p className="text-lg text-muted-foreground">Hi, I&rsquo;m {name}.</p>
        </div>
      </div>

      <Section title="What I do">
        <p>I&rsquo;m currently a Software Engineer III at Capital One.</p>
      </Section>

      <Section title="Where I've been">
        <p>
          I was born in Istanbul but moved to Dubai in the UAE at a young age. I
          studied Industrial Engineering at Georgia Tech before moving to the
          Washington, DC area.
        </p>
      </Section>

      <Section title="Why I keep a data diary">
        <p>
          I started this project at 15 because I wanted some data to do cool
          things with. Since its inception, the goals and benefits of the
          project have grown quite significantly but this still remains as the
          core tenet of the project. I can now use this data to gain insights
          into my life, remember prior days and activities, reflect on my time,
          and just have a better understanding of myself.
        </p>
      </Section>

      {links.length > 0 && (
        <Section title="Elsewhere">
          <ul className="flex flex-col gap-2">
            {links.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  className="text-foreground underline underline-offset-4 hover:text-primary"
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.label}
                </a>
                {link.note && <span> — {link.note}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Back to the front page
        </Link>
        <Link
          href="/about-project"
          className={buttonVariants({ variant: "outline" })}
        >
          About the project
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
