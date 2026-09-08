"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ChartEntry } from "@/lib/charts-catalog";

// Client-side filter over the full chart list — matches title or
// description, case-insensitive substring. The catalog is small (~30
// entries) so there's no case for a server round-trip or debouncing.
export function ChartsCatalogSearch({ charts }: { charts: ChartEntry[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return charts;
    return charts.filter(
      (chart) => chart.title.toLowerCase().includes(q) || chart.description.toLowerCase().includes(q)
    );
  }, [charts, query]);

  return (
    <div className="flex flex-col gap-6">
      <Input
        type="search"
        placeholder="Search charts…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="max-w-sm"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No charts match &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
          {filtered.map((chart) => (
            <Link key={chart.href} href={chart.href}>
              <Card className="h-full transition-colors hover:bg-accent">
                <CardHeader>
                  <CardTitle>{chart.title}</CardTitle>
                  <CardDescription>{chart.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
