// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InteractiveHist, type HistSeries } from "./interactive-hist";

// A mounted-DOM pass over what src/lib/viz/hist.test.ts can't reach: that
// each mode actually draws per-series marks, that the legend toggles a
// series off without moving the buckets, and that hover reads every series
// in the bucket. jsdom does no layout, so this proves wiring and geometry
// math, not appearance.

// Same minimal PointerEvent stand-in the other render tests carry — the
// hover handler branches on `event instanceof PointerEvent`.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {}
  // @ts-expect-error -- a deliberately minimal stand-in, not a full PointerEvent
  globalThis.PointerEvent = PointerEventPolyfill;
}

const SERIES: HistSeries[] = [
  { id: "work", label: "Work days", color: "red", values: [1, 1, 2, 3] },
  { id: "off", label: "Days off", color: "blue", values: [2, 3, 3] },
];
const EDGES = { domain: [0, 4] as [number, number], thresholds: [0, 1, 2, 3, 4] };

function renderHist(props: Partial<Parameters<typeof InteractiveHist>[0]> = {}) {
  return render(<InteractiveHist series={SERIES} width={400} height={300} {...EDGES} {...props} />);
}

const bars = (container: HTMLElement, id: string) => container.querySelectorAll(`path[data-series="${id}"]`);

describe("InteractiveHist (multi-series)", () => {
  it("draws one bar per non-empty bucket per series, with an outline each when overlaid", () => {
    const { container } = renderHist({ mode: "overlaid" });
    expect(bars(container, "work")).toHaveLength(3); // buckets 1, 2, 3
    expect(bars(container, "off")).toHaveLength(2); // buckets 2, 3
    expect(container.querySelectorAll("path[data-outline]")).toHaveLength(2);
  });

  it("stacks without outlines", () => {
    const { container } = renderHist({ mode: "stacked" });
    expect(bars(container, "work")).toHaveLength(3);
    expect(bars(container, "off")).toHaveLength(2);
    expect(container.querySelectorAll("path[data-outline]")).toHaveLength(0);
  });

  it("hides a series from the legend without changing the buckets", () => {
    const { container } = renderHist();
    const bucketsBefore = container.querySelectorAll("rect[data-bucket]").length;
    fireEvent.click(screen.getByRole("button", { name: /Days off/ }));
    expect(bars(container, "off")).toHaveLength(0);
    expect(bars(container, "work")).toHaveLength(3);
    expect(container.querySelectorAll("rect[data-bucket]")).toHaveLength(bucketsBefore);
  });

  it("draws a mean line per visible series", () => {
    const { container } = renderHist({ showMeans: true });
    expect(container.querySelectorAll("line[data-mean]")).toHaveLength(2);
  });

  it("lists every series in the hovered bucket, as shares in share mode", () => {
    const { container } = renderHist({ mode: "share" });
    const bucket = container.querySelector('rect[data-bucket="3"]') as Element;
    fireEvent.pointerEnter(bucket);
    const status = screen.getByRole("status");
    // Bucket [3, 4]: work has 1 of 4 values, off has 2 of 3.
    expect(status.textContent).toContain("25.0%");
    expect(status.textContent).toContain("Work days (1)");
    expect(status.textContent).toContain("66.7%");
    expect(status.textContent).toContain("Days off (2)");
  });
});

describe("InteractiveHist (single series)", () => {
  it("renders from values with no legend and no outlines", () => {
    const { container } = render(<InteractiveHist values={[1, 2, 2]} width={400} height={300} {...EDGES} />);
    expect(container.querySelectorAll("path[data-series]")).toHaveLength(2);
    expect(container.querySelectorAll("path[data-outline]")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
