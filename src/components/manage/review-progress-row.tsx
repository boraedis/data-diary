import Link from "next/link";

// Same "X/N filled" progress-bar visual as the day-entry dashboard
// (src/app/day/[date]/page.tsx) — reused across the Music hub and the
// Artists/Podcasts pages for the catalogs the Spotify import pipeline
// populates automatically but can never finish curating on its own
// (getMusicCurationStats in src/lib/music.ts).
export function ReviewProgressRow({
  label,
  href,
  done,
  total,
}: {
  label: string;
  href: string;
  done: number;
  total: number;
}) {
  const pct = total > 0 ? (done / total) * 100 : 100;
  return (
    <Link href={href} className="flex flex-col gap-1.5 rounded-lg px-1 py-1 transition-colors hover:bg-accent">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {done}/{total}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </Link>
  );
}
