"use client";

import { useMemo } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import type { SleepDay } from "@/lib/charts";

const CELL_GAP = 2;
const YEAR_LABEL_HEIGHT = 18;
const YEAR_GAP = 14;
const LEFT_LABEL_WIDTH = 30;
const DAY_LABELS = ["Sun", "", "Tue", "", "Thu", "", "Sat"];

type YearGroup = { year: number; days: Map<string, number> }; // date -> durationMinutes

function CalendarYears({
  years,
  width,
  cellSize,
}: {
  years: YearGroup[];
  width: number;
  cellSize: number;
}) {
  const rowHeight = cellSize + CELL_GAP;
  const yearBlockHeight = 7 * rowHeight;
  const totalHeight = years.length * (yearBlockHeight + YEAR_LABEL_HEIGHT + YEAR_GAP);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      svg.attr("width", width).attr("height", totalHeight);

      const allDurations = years.flatMap((y) => [...y.days.values()]);
      const extent = d3.extent(allDurations) as [number, number];
      // Fixed low/high teal stops rather than a CSS var — d3's color
      // interpolators need an actual rgb/hex value to blend between, and
      // the app's --chart-1 token is defined in oklch (not directly
      // interpolatable here); these two stops were picked to sit within
      // the same dark-teal family as --chart-1.
      const color = d3
        .scaleSequential(d3.interpolateRgb("#123b39", "#2dd4bf"))
        .domain(extent[0] === extent[1] ? [extent[0] - 1, extent[0] + 1] : extent);

      years.forEach((yearGroup, yi) => {
        const yearStart = new Date(yearGroup.year, 0, 1);
        const g = svg
          .append("g")
          .attr(
            "transform",
            `translate(${LEFT_LABEL_WIDTH},${yi * (yearBlockHeight + YEAR_LABEL_HEIGHT + YEAR_GAP) + YEAR_LABEL_HEIGHT})`,
          );

        g.append("text")
          .attr("x", -LEFT_LABEL_WIDTH + 2)
          .attr("y", -6)
          .attr("fill", "var(--foreground)")
          .style("font-size", "12px")
          .style("font-weight", 500)
          .text(String(yearGroup.year));

        g.selectAll(".daylabel")
          .data(DAY_LABELS)
          .join("text")
          .attr("x", -LEFT_LABEL_WIDTH + 2)
          .attr("y", (_, i) => i * rowHeight + cellSize - 1)
          .attr("fill", "var(--muted-foreground)")
          .style("font-size", "8px")
          .text((d) => d);

        const cells = [...yearGroup.days.entries()].map(([dateStr, minutes]) => {
          const date = new Date(`${dateStr}T00:00:00`);
          const week = d3.timeSunday.count(yearStart, date);
          const dow = date.getDay();
          return { dateStr, minutes, week, dow };
        });

        g.selectAll("rect")
          .data(cells)
          .join("rect")
          .attr("x", (d) => d.week * rowHeight)
          .attr("y", (d) => d.dow * rowHeight)
          .attr("width", cellSize)
          .attr("height", cellSize)
          .attr("rx", 2)
          .attr("fill", (d) => color(d.minutes))
          .append("title")
          .text((d) => `${d.dateStr}: ${(d.minutes / 60).toFixed(1)}h sleep`);
      });
    },
    [years, width, cellSize, totalHeight],
  );

  return <svg ref={ref} />;
}

/** GitHub-style calendar heatmap of sleep duration, one strip per year —
 * the legacy app's `Calendar`/`MultiCalendar` pattern (functions/views/vis/
 * charts/sleep_calendar.js). Cell size scales down as more years' worth of
 * data comes in, so a multi-decade history stays a fixed width instead of
 * scrolling horizontally forever. */
export function SleepCalendarChart({ data }: { data: SleepDay[] }) {
  const years = useMemo<YearGroup[]>(() => {
    const byYear = new Map<number, Map<string, number>>();
    for (const d of data) {
      const year = parseInt(d.date.slice(0, 4), 10);
      if (!byYear.has(year)) byYear.set(year, new Map());
      byYear.get(year)!.set(d.date, d.durationMinutes);
    }
    return [...byYear.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, days]) => ({ year, days }));
  }, [data]);

  const guessRowHeight = 12;
  const guessedHeight =
    years.length * (7 * guessRowHeight + YEAR_LABEL_HEIGHT + YEAR_GAP) || 200;

  return (
    <ResponsiveChart height={guessedHeight} minWidth={320}>
      {({ width }) => {
        const cellSize = Math.min(
          14,
          Math.max(6, Math.floor((width - LEFT_LABEL_WIDTH) / 54) - CELL_GAP),
        );
        return <CalendarYears years={years} width={width} cellSize={cellSize} />;
      }}
    </ResponsiveChart>
  );
}
