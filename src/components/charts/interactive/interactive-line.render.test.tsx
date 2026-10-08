// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { InteractiveLine } from "./interactive-line";
import { parseDate, toDateString } from "@/lib/date";
import { cycleReferenceDate, formatCyclePosition } from "@/lib/viz/bin";

// A mounted-DOM check of `xLabels` (#451): a seasonal fold's reference dates
// must reach the screen as weekday names, never as the year-2000 dates they
// sit on. jsdom does no layout, so this proves wiring, not appearance.

if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {}
  // @ts-expect-error -- a deliberately minimal stand-in, not a full PointerEvent
  globalThis.PointerEvent = PointerEventPolyfill;
}

const DAYS = [0, 1, 2, 3, 4, 5, 6].map((p) => parseDate(cycleReferenceDate("weekday", p)));
const X_LABELS = {
  tick: (d: Date) => formatCyclePosition("weekday", toDateString(d), true),
  title: (d: Date) => formatCyclePosition("weekday", toDateString(d)),
  tickValues: DAYS,
};

describe("InteractiveLine xLabels", () => {
  it("labels ticks and the tooltip title by weekday, not by reference date", () => {
    const { container } = render(
      <InteractiveLine
        series={[{ id: "h", label: "Happiness", points: DAYS.map((x, i) => ({ x, y: 50 + i })) }]}
        width={600}
        height={300}
        xLabels={X_LABELS}
      />,
    );
    const ticks = [...container.querySelectorAll("g.tick text")].map((t) => t.textContent);
    expect(ticks).toEqual(expect.arrayContaining(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]));
    expect(ticks.join(" ")).not.toMatch(/2000/);

    const overlay = container.querySelector('[role="img"]') as HTMLElement;
    fireEvent.focus(overlay); // focus lands on the last point
    expect(container.textContent).toContain("Sunday");
  });
});

// #110: on-chart labels and drag-to-select. jsdom has no layout, so text
// widths here are the component's character-count estimate and
// getBoundingClientRect is all zeros (clientX is then the plot-local x).
// These prove the wiring and the auto rules, not how the labels look.

const YEARS = [2019, 2020, 2021, 2022, 2023].map((y) => new Date(y, 0, 1));
const MONTHS = Array.from({ length: 60 }, (_, i) => new Date(2019, i, 1));

function lineLabels(container: HTMLElement) {
  return [...container.querySelectorAll("text[data-series-label]")].map((t) => t.textContent);
}

describe("InteractiveLine labels", () => {
  it("names each of a few lines at its end, and leaves a lone line to the title", () => {
    const two = render(
      <InteractiveLine
        series={[
          { id: "a", label: "Work days", points: YEARS.map((x, i) => ({ x, y: 60 + i })) },
          { id: "b", label: "Other days", points: YEARS.map((x, i) => ({ x, y: 40 - i * 3 })) },
        ]}
        width={800}
        height={400}
        pointLabels={false}
      />,
    );
    expect(lineLabels(two.container)).toEqual(["Work days", "Other days"]);

    const one = render(
      <InteractiveLine
        series={[{ id: "a", label: "Happiness", points: YEARS.map((x, i) => ({ x, y: 60 + i })) }]}
        width={800}
        height={400}
        pointLabels={false}
      />,
    );
    expect(lineLabels(one.container)).toEqual([]);
  });

  it("labels the points of a sparse series and not a dense one", () => {
    const sparse = render(
      <InteractiveLine
        series={[{ id: "a", label: "Happiness", points: YEARS.map((x, i) => ({ x, y: [70, 80, 65, 90, 75][i] })) }]}
        width={800}
        height={400}
        valueFormat={(v) => v.toFixed(1)}
      />,
    );
    const values = lineLabels(sparse.container);
    expect(values.length).toBeGreaterThan(0);
    // The last point and the extremes are placed first, so they survive.
    expect(values).toEqual(expect.arrayContaining(["75.0", "90.0", "65.0"]));

    const dense = render(
      <InteractiveLine
        series={[{ id: "a", label: "Happiness", points: MONTHS.map((x, i) => ({ x, y: 70 + (i % 7) })) }]}
        width={800}
        height={400}
      />,
    );
    expect(lineLabels(dense.container)).toEqual([]);
  });

  it("skips both kinds of label in series hover", () => {
    const { container } = render(
      <InteractiveLine
        series={[
          { id: "a", label: "A", points: YEARS.map((x, i) => ({ x, y: 60 + i })) },
          { id: "b", label: "B", points: YEARS.map((x, i) => ({ x, y: 40 - i })) },
        ]}
        width={800}
        height={400}
        hover="series"
      />,
    );
    expect(lineLabels(container)).toEqual([]);
  });
});

describe("InteractiveLine drag-to-select", () => {
  function setup() {
    const calls: ([Date, Date] | null)[] = [];
    const { container } = render(
      <InteractiveLine
        series={[{ id: "a", label: "Happiness", points: YEARS.map((x, i) => ({ x, y: 60 + i })) }]}
        width={800}
        height={400}
        onSelectRange={(range) => calls.push(range)}
      />,
    );
    return { overlay: container.querySelector('[role="img"]') as HTMLElement, calls };
  }

  it("reports the first and last points inside the dragged span", () => {
    const { overlay, calls } = setup();
    // Plot is 800 − 44 − 16 = 740px wide over five evenly spaced-ish years,
    // so ~185px each: 150–600 holds 2020, 2021 and 2022.
    fireEvent.pointerDown(overlay, { clientX: 150, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 400 });
    fireEvent.pointerUp(overlay, { clientX: 600 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.map((d) => d.getFullYear())).toEqual([2020, 2022]);
  });

  it("treats a short drag as a click, and a single-point span as nothing", () => {
    const { overlay, calls } = setup();
    fireEvent.pointerDown(overlay, { clientX: 300, button: 0 });
    fireEvent.pointerUp(overlay, { clientX: 302 });
    fireEvent.pointerDown(overlay, { clientX: 170, button: 0 });
    fireEvent.pointerUp(overlay, { clientX: 200 });
    expect(calls).toEqual([]);
  });

  it("resets on double-click", () => {
    const { overlay, calls } = setup();
    fireEvent.doubleClick(overlay);
    expect(calls).toEqual([null]);
  });
});
