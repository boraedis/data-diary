import { getSql } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { TodayLink } from "@/components/today-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Data Diary</CardTitle>
          <CardDescription>Phase 2: day entries are live.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3 text-sm">
            <span>Database connection</span>
            <span className={health.ok ? "text-green-600" : "text-destructive"}>
              {health.ok ? "Connected" : `Failed: ${health.error ?? "unknown"}`}
            </span>
          </div>
          <TodayLink />
          <form action="/api/auth/logout" method="post">
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
