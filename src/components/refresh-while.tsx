"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the current server page every `intervalMs` while `active`,
 * then stops. For pages showing work that finishes in the background, such
 * as a video log uploading or transcribing (#342), so the status moves on
 * without a manual reload. Gives up after `maxMs` so a stuck job doesn't
 * poll forever; a reload starts it again.
 */
export function RefreshWhile({
  active,
  intervalMs = 5000,
  maxMs = 20 * 60 * 1000,
}: {
  active: boolean;
  intervalMs?: number;
  maxMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - started > maxMs) {
        window.clearInterval(id);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs, maxMs, router]);
  return null;
}
