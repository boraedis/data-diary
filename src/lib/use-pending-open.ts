"use client";

import { useState } from "react";
import type { EntertainmentKind } from "@/lib/entertainment-search";

export type PendingOpen = { kind: EntertainmentKind; id: number; nonce: number } | null;

/** Render-phase-derived "does this section's pendingOpen target just
 * change" check — React's own documented alternative to a useEffect that
 * merely mirrors a prop into local state ("Adjusting state when a prop
 * changes" in the React docs), used here so the unified search's pick can
 * open the right section's detail modal without an effect at all (an
 * effect that both reads and writes state on every pendingOpen change trips
 * the react-hooks/set-state-in-effect rule). `nonce` is a fresh value every
 * time the parent's search selects something (even reselecting the same
 * item), so each section only needs to track the last nonce it already
 * reacted to — no "tell the parent to clear it" callback needed, since a
 * closed modal simply won't reopen until a new nonce arrives. */
export function usePendingOpenMatch(pendingOpen: PendingOpen, kind: EntertainmentKind): number | null {
  const [lastNonce, setLastNonce] = useState<number | null>(null);
  if (pendingOpen?.kind === kind && pendingOpen.nonce !== lastNonce) {
    setLastNonce(pendingOpen.nonce);
    return pendingOpen.id;
  }
  return null;
}
