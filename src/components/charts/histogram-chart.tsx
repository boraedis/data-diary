"use client";

import { useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { drawStandardAxes } from "@/components/charts/interactive/axis";
import { MARK_SPECS, attachMarkHover, roundedBarPath } from "@/components/charts/interactive/marks";
import { ChartTooltip } from "@/components/charts/interactive/tooltip";
import { categoricalColor } from "@/lib/viz/color";

const MARGIN = { top: 12, right: 16, bottom: 28, left: 36 };

type Bin = d3.Bin<number, number>;
type Hovered = { bin: Bin; clientPos: { x: number; y: number } };

function Histogram({
  values,
  width,
  height,
  onHover,
  onLeave,
}: {
  values: number[];
  width: number;
  height: number;
  onHover: (bin: Bin, clientPos: { x: number; y: number }) => void;
  onLeave: () => void;
}) {
  const ref = useD3<SVGSVGElement>(
    (svg) => {
      const innerWidth = width - MARGIN.left - MARGIN.right;
      const innerHeight = height - MARGIN.top - MARGIN.bottom;

      const x = d3.scaleLinear().domain([0, 100]).range([0, innerWidth]);
      // 10-wide buckets over the fixed 0-100 happiness scale, rather than
      // d3.bin()'s default Sturges rule — a domain-meaningful bucket width
      // (one bucket per 10 points) reads better here than an
      // auto-picked one.
      const bins = d3
        .bin()
        .domain([0, 100])
        .thresholds(d3.range(0, 101, 10))(values);

      const y = d3
        .scaleLinear()
        .domain([0, d3.max(bins, (b) => b.length) ?? 0])
        .nice()
        .range([innerHeight, 0]);

      const g = svg
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

      drawStandardAxes({ g, x, y, innerWidth, innerHeight, xTicks: 10, yTicks: 5 });

      const bars = g
        .selectAll("path")
        .data(bins)
        .join("path")
        .attr("d", (d) => {
          const slotX0 = x(d.x0 ?? 0);
          const slotX1 = x(d.x1 ?? 0);
          // Cap thickness rather than filling the slot — the leftover
          // width becomes air on both sides, not a wider bar.
          const slotWidth = Math.max(0, slotX1 - slotX0 - MARK_SPECS.bar.surfaceGap);
          const barWidth = Math.min(slotWidth, MARK_SPECS.bar.maxThickness);
          const barX = slotX0 + (slotX1 - slotX0 - barWidth) / 2;
          const barHeight = innerHeight - y(d.length);
          return roundedBarPath(barX, y(d.length), barWidth, barHeight, "up");
        })
        .attr("fill", categoricalColor(0));

      attachMarkHover<Bin>(bars, {
        onHover: (d, clientPos) => onHover(d, clientPos),
        onLeave,
      });
    },
    [values, width, height, onHover, onLeave],
  );

  return <svg ref={ref} />;
}

export function HistogramChart({ values }: { values: number[] }) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRect = containerEl?.getBoundingClientRect();

  return (
    <ResponsiveChart height={260} wrapperRef={setContainerEl}>
      {({ width, height }) => (
        <>
          <Histogram
            values={values}
            width={width}
            height={height}
            onHover={(bin, clientPos) => setHovered({ bin, clientPos })}
            onLeave={() => setHovered(null)}
          />
          {hovered && containerRect ? (
            <ChartTooltip
              x={hovered.clientPos.x - containerRect.left}
              y={hovered.clientPos.y - containerRect.top}
              rows={[
                {
                  label: `${hovered.bin.x0}–${hovered.bin.x1}`,
                  value: `${hovered.bin.length}`,
                  color: categoricalColor(0),
                },
              ]}
              containerWidth={width}
            />
          ) : null}
        </>
      )}
    </ResponsiveChart>
  );
}
