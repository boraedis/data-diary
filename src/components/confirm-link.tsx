"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useNavigationBlocker } from "@/components/navigation-blocker";

/** Drop-in replacement for next/link's `Link` that confirms before leaving
 * the page if `useNavigationBlocker`'s flag is set (see
 * navigation-blocker.tsx) — used by TopNav and DayNav (issue #143) so
 * clicking any site nav away from a dirty entry form doesn't silently
 * discard it. `onNavigate` only fires for client-side, same-origin
 * navigation (Next.js Link docs) — it doesn't cover the browser's own
 * back/forward buttons or a hard reload/tab close; useUnsavedChangesGuard
 * covers the latter with a `beforeunload` listener. Back/forward is a known
 * gap with no reliable fix in the App Router without fragile history-stack
 * tricks, so it's left alone rather than hacked around. */
export function ConfirmLink({ children, ...props }: ComponentProps<typeof Link>) {
  const { isBlocked } = useNavigationBlocker();

  return (
    <Link
      {...props}
      onNavigate={(e) => {
        if (isBlocked && !window.confirm("You have unsaved changes. Leave anyway?")) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </Link>
  );
}
