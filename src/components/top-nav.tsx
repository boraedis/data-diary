"use client";

import { usePathname } from "next/navigation";
import { BarChart3, CircleUser, Database, LogOut, Sparkles } from "lucide-react";
import { ConfirmLink } from "@/components/confirm-link";

// Persistent cross-site nav (#138 ask #1) — the legacy app had a top bar
// with tabs for its major sections; before this, the only way to move
// between them was clicking back through /home one hop at a time. Lives in
// src/app/(app)/layout.tsx, a route group that wraps only the authenticated
// pages — the public landing site (/, /about-*, /public-charts) is a
// different, curated surface (see AGENTS.md) and must not show this.
//
// The "Data Diary" wordmark doubles as the Home link (moved here from
// home/page.tsx's own h1, so it's one site-wide brand mark instead of a
// title that only existed on one page) — no separate "Home" nav item.
const NAV_ITEMS = [
  { href: "/manage", label: "Manage", icon: Database },
  { href: "/charts", label: "Charts", icon: BarChart3 },
  { href: "/recap", label: "Recap", icon: Sparkles },
  { href: "/profile", label: "Profile", icon: CircleUser },
] as const;

export function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-3 md:px-4">
        <ConfirmLink
          href="/home"
          className="shrink-0 py-3 font-heading text-lg font-medium tracking-tight text-primary italic transition-opacity hover:opacity-80 md:text-xl"
        >
          Data Diary
        </ConfirmLink>
        <div className="flex items-center gap-0.5 overflow-x-auto md:gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
            />
          ))}
          <form action="/api/auth/logout" method="post" className="shrink-0">
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg px-2 py-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground md:px-3"
            >
              <LogOut aria-hidden className="size-4" />
              <span className="hidden md:inline">Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Database;
  active: boolean;
}) {
  return (
    <ConfirmLink
      href={href}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-3 text-xs font-medium transition-colors md:px-3 ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon aria-hidden className="size-4" />
      <span className="hidden md:inline">{label}</span>
    </ConfirmLink>
  );
}
