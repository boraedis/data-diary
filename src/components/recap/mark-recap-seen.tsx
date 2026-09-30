"use client";

import { useEffect } from "react";

// Tells the server this recap has been opened (#518). Rendered only inside a
// published, non-preview recap, and fired from an effect rather than during
// the server render so a prefetch of the page never counts as reading it.
// Fire-and-forget: if it fails the recap simply stays badged until the next
// visit, which is the safe direction to be wrong in.

export function MarkRecapSeen({ periodKey }: { periodKey: string }) {
  useEffect(() => {
    fetch("/api/recap/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: periodKey }),
    }).catch(() => {});
  }, [periodKey]);

  return null;
}
