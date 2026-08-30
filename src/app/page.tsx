import Link from "next/link";
import { getSql } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { TodayLink } from "@/components/today-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Never statically cache this — it's a live DB check.
export const dynamic = "force-dynamic";

type HealthResult = { ok: boolean; error?: string };

// Checks the database directly, in-process — no self-fetch over HTTP.
// A server component calling its own /api/health route via fetch() is
// fragile on Vercel (e.g. deployment protection intercepting the
// server-to-server request and returning an HTML page instead of JSON),
// and it's strictly slower than just querying here.
async function getHealth(): Promise<HealthResult> {
  try {
    const sql = getSql();
    await sql`select 1`;
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export default async function HomePage() {
  const health = await getHealth();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 px-4 py-12">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="font-heading text-4xl font-medium tracking-tight text-primary italic md:text-5xl">
          Data Diary
        </h1>
        <p className="text-muted-foreground">A little corner for tracking the shape of your days.</p>
      </div>

      <div className="grid w-full max-w-4xl grid-cols-1 gap-4 md:grid-cols-4">
        <Card className="md:col-span-4">
          <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3 text-sm">
              <span
                className={`size-2.5 rounded-full ${health.ok ? "bg-chart-3" : "bg-destructive"}`}
                aria-hidden
              />
              <span className="text-muted-foreground">
                {health.ok ? "Database connected" : `Connection failed: ${health.error ?? "unknown"}`}
              </span>
            </div>
            <TodayLink />
          </CardContent>
        </Card>

        <Link href="/charts">
          <Card className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <CardTitle>Charts</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              See the trends behind everything you&rsquo;ve logged.
            </CardContent>
          </Card>
        </Link>

        <Link href="/manage">
          <Card className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <CardTitle>Manage</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              People, places, exercises, entertainment — the catalog behind every entry.
            </CardContent>
          </Card>
        </Link>

        <Link href="/profile">
          <Card className="h-full transition-colors hover:bg-accent">
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Who you are — occupation, residence, and relationship history.
            </CardContent>
          </Card>
        </Link>

        <form action="/api/auth/logout" method="post" className="h-full">
          <Card className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent>
              <Button type="submit" variant="outline" className="w-full">
                Sign out
              </Button>
            </CardContent>
          </Card>
        </form>
      </div>
    </main>
  );
}
