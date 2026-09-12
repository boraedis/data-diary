"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { RecentDay } from "@/lib/home";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortLabel(dateStr: string): { weekday: string; day: string; month: string } {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return { weekday: WEEKDAYS[d.getDay()], day: String(day), month: MONTHS[month - 1] };
}

function DayTab({ day, isToday }: { day: RecentDay; isToday: boolean }) {
  const label = shortLabel(day.date);
  const pct = (day.score / 10) * 100;
  return (
    <Link
      href={`/day/${day.date}`}
      className={`flex min-w-[52px] flex-shrink-0 flex-col items-center gap-1.5 rounded-lg border px-2 py-2 text-center transition-colors hover:bg-accent ${isToday ? "border-primary/50 bg-primary/5" : ""}`}
    >
      <span className="text-[10px] font-medium text-muted-foreground">{label.weekday}</span>
      <span className="text-sm font-semibold">{label.day}</span>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground">{label.month}</span>
    </Link>
  );
}

/** The "Recent days" strip on the home page (`recentDays` is oldest-first,
 * today last). On a narrow viewport the row overflows and starts scrolled
 * to its left edge — hiding today, and however many days before it don't
 * fit, off-screen to the right (#356). That's backwards for a page whose
 * whole point is jumping into the last day or two: logging typically
 * starts 1-3 days behind, only rarely further back, so the reachable end
 * should be the one usually needed without a swipe first.
 *
 * Scrolled to the end on mount rather than reversing the strip's order —
 * oldest-to-newest reading left-to-right is the natural timeline direction
 * (and matches DayNav's Prev=left/Next=right), so the fix is where the
 * view starts, not which way the strip reads. The scroll is smooth (a
 * quick scrub into place) rather than an instant jump, so it reads as
 * "here's what's fresh" instead of a jarring cut — except for
 * prefers-reduced-motion, which gets an instant jump instead. */
export function RecentDaysScroller({ days, todayDate }: { days: RecentDay[]; todayDate: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: el.scrollWidth, behavior: reduceMotion ? "auto" : "smooth" });
  }, []);

  return (
    <div ref={ref} className="flex gap-2 overflow-x-auto pb-1">
      {days.map((day) => (
        <DayTab key={day.date} day={day} isToday={day.date === todayDate} />
      ))}
    </div>
  );
}
