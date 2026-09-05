"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { useNavigationBlocker } from "@/components/navigation-blocker";

/** Drop-in replacement for next/link's `Link` that confirms before leaving
 * the page if `useNavigationBlocker`'s flag is set (issue #143) — used by
 * TopNav and DayNav so clicking any site nav away from a dirty entry form
 * doesn't silently discard it.
 *
 * `href` is narrowed to a plain string (not next/link's full `Url` union)
 * since every real caller in this app already passes one and
 * NavigationBlockerProvider's `requestNavigation` hands it straight to
 * `router.push`, which only accepts a string anyway.
 *
 * Intercepts the click itself and calls `requestNavigation` rather than
 * using Link's `onNavigate` — see navigation-blocker.tsx's header comment
 * for why: onNavigate fires through Next's transition machinery, and a
 * `window.confirm()` called from there isn't a reliable-enough "direct
 * user gesture" for iOS Safari, which was silently suppressing it. A plain
 * onClick handler is a real synchronous gesture, so the Modal-based
 * confirmation in the provider works everywhere.
 *
 * Modifier-clicks (Cmd/Ctrl/Shift/middle-click, opening in a new tab) are
 * left alone — those don't navigate the current tab away from the dirty
 * page, so there's nothing to confirm. */
export function ConfirmLink({
  children,
  href,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & { href: string }) {
  const { requestNavigation } = useNavigationBlocker();

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    requestNavigation(href);
  }

  return (
    <Link href={href} onClick={handleClick} {...props}>
      {children}
    </Link>
  );
}
