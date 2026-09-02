import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getPublicLandingData } from "@/lib/public-profile";

// Placeholder on purpose (#86) — the point of this issue is the page's own
// shell and link existing, not final copy. "To be filled out eventually"
// per the issue thread; replace the paragraph below when that's written,
// nothing structural needs to change to do so.
export const dynamic = "force-dynamic";

export default async function AboutMePage() {
  const { ownerName } = await getPublicLandingData();
  const name = ownerName ?? "the person behind this project";

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 px-4 py-16 text-center md:py-24">
      <h1 className="font-heading text-4xl font-medium tracking-tight text-primary italic md:text-5xl">
        About me
      </h1>
      <p className="text-balance text-lg text-muted-foreground">
        Hi, I&rsquo;m {name}. A proper introduction — who I am, what I do, and how to find me
        elsewhere — is still being written.
      </p>
      <p className="text-sm text-muted-foreground">Check back soon, or start with the project itself.</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Back to the front page
        </Link>
        <Link href="/about-project" className={buttonVariants({ variant: "outline" })}>
          About the project
        </Link>
      </div>
    </main>
  );
}
