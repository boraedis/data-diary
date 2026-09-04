"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, CalendarDays, CircleUser, Database, Home, LogOut } from "lucide-react";
import { todayDateString } from "@/lib/date";

// Persistent cross-site nav (#138 ask #1) — the legacy app had a top bar
// with tabs for its major sections; before this, the only way to move
// between them was clicking back through /home one hop at a time. Lives in
// src/app/(app)/layout.tsx, a route group that wraps only the authenticated
// pages — the public landing site (/, /about-*, /public-charts) is a
// different, curated surface (see AGENTS.md) and must not show this.
const NAV_ITEMS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/manage", label: "Manage", icon: Database },
  { href: "/charts", label: "Charts", icon: BarChart3 },
  { href: "/profile", label: "Profile", icon: CircleUser },
] as const;

export function TopNav() {
  const pathname = usePathname();

  // "Today" has no server-side answer (see src/lib/date.ts — no fixed app
  // timezone), so it's resolved client-side after mount, same
  // hydration-safe pattern as today-link.tsx. Falls back to /home, which
  // has its own "Log today" entry point, until that resolves.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(todayDateString());
  }, []);
  const dayHref = today ? `/day/${today}` : "/home";
  const dayActive = pathname.startsWith("/day");

  return (
    <nav className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-2 md:px-4">
        <div className="flex items-center gap-0.5 overflow-x-auto md:gap-1">
          <NavLink href={dayHref} label="Day" icon={CalendarDays} active={dayActive} />
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
            />
          ))}
        </div>
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
  icon: typeof Home;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-3 text-xs font-medium transition-colors md:px-3 ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon aria-hidden className="size-4" />
      <span className="hidden md:inline">{label}</span>
    </Link>
  );
}
