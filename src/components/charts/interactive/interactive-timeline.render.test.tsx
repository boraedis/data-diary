// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import * as d3 from "d3";
import { InteractiveTimeline } from "./interactive-timeline";
import type { LaidOutInterval, TimelineInterval } from "@/lib/viz/timeline";

// A mounted-DOM pass over what the pure tests in src/lib/viz/timeline.test.ts
// can't reach: that the layout's rows actually become distinct y positions,
// that an ongoing interval is marked as such on the mark itself, that every
// bar is focusable and named for a screen reader, and that the tooltip reads
// the hovered bar rather than a stale one.
//
// jsdom does no layout, so this proves geometry and wiring, not appearance —
// bar paths are pure math. See the PR for what was verified visually.

class StubResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 900, height: 400 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver;

// jsdom has no PointerEvent implementation (see
// https://github.com/jsdom/jsdom/issues/2527), and `attachMarkHover`
// (marks.ts) branches on `event instanceof PointerEvent` — so the bare
// identifier throws a ReferenceError on the first hover without this.
// Same minimal polyfill interactive-bar-race.render.test.tsx already
// carries; duplicated rather than shared because hoisting it into
// vitest.setup.ts would silently change the environment for every suite,
// which is a bigger decision than this file should make on its own.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {}
  // @ts-expect-error -- a deliberately minimal stand-in, not a full PointerEvent
  globalThis.PointerEvent = PointerEventPolyfill;
}

// jsdom implements SVG elements as DOM nodes but none of their text
// metrics, so `getComputedTextLength` — which the component uses to decide
// whether a label fits inside its bar — simply isn't there. This returns a
// rough width so the truncation loop actually executes rather than being
// skipped or throwing; jsdom does no layout, so no real measurement is
// available to be faithful to. Local to this file rather than the shared
// setup: it's the only test that renders text into bars.
if (!("getComputedTextLength" in SVGElement.prototype)) {
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value(this: SVGElement) {
      return (this.textContent ?? "").length * 6;
    },
  });
}

const OPEN_END = "2026-06-30";

const ITEMS: TimelineInterval[] = [
  { id: "j1", lane: "Work", label: "First job", start: "2018-01-01", end: "2021-06-30" },
  { id: "j2", lane: "Work", label: "Side project", start: "2020-01-01", end: "2020-12-31" },
  { id: "h1", lane: "Home", label: "Atlanta", start: "2018-01-01", end: "2022-05-01" },
  { id: "h2", lane: "Home", label: "Washington", start: "2022-05-01", end: null },
];

function renderTimeline(props?: Partial<React.ComponentProps<typeof InteractiveTimeline>>) {
  return render(
    <InteractiveTimeline items={ITEMS} width={900} height={400} openEnd={OPEN_END} {...props} />,
  );
}

function bars(container: HTMLElement): SVGGElement[] {
  return [...container.querySelectorAll<SVGGElement>("g.timeline-bar")];
}

function datumOf(bar: SVGGElement): LaidOutInterval {
  return d3.select(bar).datum() as LaidOutInterval;
}

function barFor(container: HTMLElement, id: string): SVGGElement {
  const match = bars(container).find((b) => datumOf(b).id === id);
  if (!match) throw new Error(`no bar for "${id}"`);
  return match;
}

/** The tooltip's contents. Scoped through ChartTooltip's own live region
 * rather than queried off the whole document, because a bar wide enough to
 * hold its label renders that same label inside the SVG too — an unscoped
 * getByText would match both and fail as ambiguous. */
function tooltip() {
  return within(screen.getByRole("status"));
}

/** The y of a bar's own shape path, parsed out of its `d`. */
function barTop(bar: SVGGElement): number {
  const d = bar.querySelector("path.timeline-bar-shape")!.getAttribute("d")!;
  // roundedBarPath starts with "M<x>,<y>".
  return Number(d.slice(1).split(" ")[0].split(",")[1]);
}

describe("InteractiveTimeline", () => {
  it("draws one bar per interval", () => {
    const { container } = renderTimeline();
    expect(bars(container)).toHaveLength(4);
  });

  it("puts overlapping intervals in the same lane on different rows", () => {
    const { container } = renderTimeline();
    // First job and Side project overlap through 2020, so they must not
    // paint at the same height.
    expect(barTop(barFor(container, "j1"))).not.toBe(barTop(barFor(container, "j2")));
  });

  it("keeps a later lane below the one above it, stacked rows included", () => {
    const { container } = renderTimeline();
    // Work needed two rows, so Home starts below both of them.
    const workBottom = Math.max(barTop(barFor(container, "j1")), barTop(barFor(container, "j2")));
    expect(barTop(barFor(container, "h1"))).toBeGreaterThan(workBottom);
  });

  it("labels each lane once, down the left", () => {
    const { container } = renderTimeline();
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts.filter((t) => t === "Work")).toHaveLength(1);
    expect(texts.filter((t) => t === "Home")).toHaveLength(1);
  });

  it("colours by lane, not by item", () => {
    const { container } = renderTimeline();
    const fillOf = (id: string) =>
      barFor(container, id).querySelector("path.timeline-bar-shape")!.getAttribute("fill");
    // Two intervals in one lane share a colour; a different lane doesn't.
    expect(fillOf("j1")).toBe(fillOf("j2"));
    expect(fillOf("h1")).not.toBe(fillOf("j1"));
  });

  it("takes a colour override the way the other primitives do", () => {
    const { container } = renderTimeline({ color: "#123456" });
    for (const bar of bars(container)) {
      expect(bar.querySelector("path.timeline-bar-shape")!.getAttribute("fill")).toBe("#123456");
    }
  });

  it("marks an ongoing interval on the bar itself, not only in the tooltip", () => {
    const { container } = renderTimeline();
    // "Washington" has no end date; the others do.
    expect(barFor(container, "h2").querySelector("rect")).toBeTruthy();
    expect(barFor(container, "h1").querySelector("rect")).toBeNull();
  });

  it("gives every bar a focusable, named handle for a screen reader", () => {
    const { container } = renderTimeline();
    for (const bar of bars(container)) {
      expect(bar.getAttribute("tabindex")).toBe("0");
      expect(bar.getAttribute("aria-label")).toBeTruthy();
    }
    expect(barFor(container, "h2").getAttribute("aria-label")).toMatch(/ongoing/);
    expect(barFor(container, "h1").getAttribute("aria-label")).toMatch(/to /);
  });

  it("shows the hovered interval's own dates and length", () => {
    const { container } = renderTimeline();
    fireEvent.pointerEnter(barFor(container, "h1"));

    expect(tooltip().getByText("Atlanta")).toBeTruthy();
    // Jan 2018 to May 2022 — a little over four years.
    expect(tooltip().getByText(/4 yrs/)).toBeTruthy();
  });

  it("says an ongoing interval is still running rather than inventing an end", () => {
    const { container } = renderTimeline();
    fireEvent.pointerEnter(barFor(container, "h2"));
    expect(tooltip().getByText(/now/)).toBeTruthy();
  });

  it("swaps the tooltip when the pointer moves to another bar", () => {
    const { container } = renderTimeline();
    fireEvent.pointerEnter(barFor(container, "h1"));
    expect(tooltip().getByText("Atlanta")).toBeTruthy();

    fireEvent.pointerLeave(barFor(container, "h1"));
    fireEvent.pointerEnter(barFor(container, "j1"));
    expect(tooltip().queryByText("Atlanta")).toBeNull();
    expect(tooltip().getByText("First job")).toBeTruthy();
  });

  it("measures an ongoing entry against today when no openEnd is given", () => {
    // Regression: with `openEnd` omitted, the tooltip used to fall back to
    // the entry's own start date while the layout separately defaulted to
    // today — so a job that began months ago reported "0 days". Every
    // other test here passes `openEnd` explicitly, which hid it.
    const { container } = renderTimeline({
      openEnd: undefined,
      items: [{ id: "x", lane: "Work", label: "Current job", start: "2020-01-01", end: null }],
    });
    fireEvent.pointerEnter(bars(container)[0]);
    expect(tooltip().queryByText("0 days")).toBeNull();
    expect(tooltip().getByText(/yrs/)).toBeTruthy();
  });

  it("offers no reset control until the view is actually zoomed", () => {
    renderTimeline();
    expect(screen.queryByRole("button", { name: /reset zoom/i })).toBeNull();
  });

  it("renders an honest empty state rather than an empty axis", () => {
    const { container } = renderTimeline({ items: [] });
    expect(bars(container)).toHaveLength(0);
    expect(screen.getByText(/nothing to plot/i)).toBeTruthy();
  });

  it("survives a single zero-length interval without dividing by zero", () => {
    const { container } = renderTimeline({
      items: [{ id: "x", lane: "Work", label: "One day", start: "2020-01-01", end: "2020-01-01" }],
    });
    // A degenerate domain would otherwise make every bar NaN-wide.
    const d = bars(container)[0].querySelector("path.timeline-bar-shape")!.getAttribute("d")!;
    expect(d).not.toMatch(/NaN/);
  });
});
