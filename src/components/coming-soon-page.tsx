import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// Temporary stub for a public landing-page destination that's linked from
// the hero (#83) but not built yet (#84/#85/#86). Without a real page here,
// proxy.ts's auth gate treats the path as protected and redirects visitors
// to /login instead of a normal 404 — confusing for someone who was never
// meant to log in at all. This renders something honest instead; each of
// these route files gets replaced with real content once its own issue
// lands, not extended in place.
export function ComingSoonPage({ title, description }: { title: string; description: string }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="font-heading text-3xl font-medium tracking-tight text-primary italic md:text-4xl">
        {title}
      </h1>
      <p className="max-w-md text-balance text-muted-foreground">{description}</p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        Back to the front page
      </Link>
    </main>
  );
}
