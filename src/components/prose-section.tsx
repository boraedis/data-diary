import type { ReactNode } from "react";

// A headed block of long-form copy for the public prose pages
// (/about-project, /about-me). Shared so the two essays keep one typographic
// rhythm instead of drifting apart as each gets rewritten on its own.
export function ProseSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-xl font-medium tracking-tight text-primary">{title}</h2>
      <div className="flex flex-col gap-3 text-muted-foreground">{children}</div>
    </section>
  );
}
