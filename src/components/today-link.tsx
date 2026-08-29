"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { todayDateString } from "@/lib/date";

/**
 * "Today" has no server-side answer here — there's deliberately no fixed
 * app timezone (see src/lib/date.ts) — so this is computed client-side,
 * after mount, from the visitor's own clock. Computing it during the first
 * render would use whatever timezone the server happened to render in and
 * risk a hydration mismatch against the browser's actual local date.
 */
export function TodayLink() {
  const [date, setDate] = useState<string | null>(null);

  useEffect(() => {
    // Deliberately synchronous: this is the standard client-only hydration
    // guard (compute after mount, from the browser's own clock, instead of
    // whatever the server rendered) — not a value that can be derived
    // during render without risking a hydration mismatch. Known false
    // positive for this pattern, see facebook/react#35377 and
    // pacocoursey/next-themes#374.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(todayDateString());
  }, []);

  if (!date) {
    return (
      <span className={buttonVariants({ className: "w-full opacity-50" })}>
        Log today
      </span>
    );
  }

  return (
    <Link href={`/day/${date}`} className={buttonVariants({ className: "w-full" })}>
      Log today
    </Link>
  );
}
