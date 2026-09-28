// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { InteractiveCalendar, calendarLayout, type InteractiveCalendarPoint } from "./interactive-calendar";

// #450: below the horizontal grid's minimum width the calendar switches to
// a month grid, and a tap pins the tooltip instead of flashing it. jsdom
// does no layout, so this checks the geometry math and event wiring, not how it
// looks on a real phone.

// The hover handler branches on `event instanceof PointerEvent`, and the
// tap-pin on `pointerType`, so the stand-in has to carry that.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  // @ts-expect-error -- a deliberately minimal stand-in, not a full PointerEvent
  globalThis.PointerEvent = PointerEventPolyfill;
}

// Two years, so the month grid has more than one year to stack.
const POINTS: InteractiveCalendarPoint[] = [
  { date: "2025-01-06", value: 1 }, // Monday, week 1
  { date: "2025-01-12", value: 2 }, // Sunday, week 1
  { date: "2025-12-29", value: 3 }, // Monday, week 52
  { date: "2024-03-01", value: 4 },
];

function renderCalendar(width: number) {
  return render(<InteractiveCalendar points={POINTS} width={width} formatValue={String} />);
}

const cellByFill = (container: HTMLElement) => [...container.querySelectorAll<SVGRectElement>("rect.cell")];
const pos = (el: Element) => ({ x: Number(el.getAttribute("x")), y: Number(el.getAttribute("y")) });

describe("calendarLayout", () => {
  it("keeps the horizontal layout wherever it already fit", () => {
    expect(calendarLayout(570, 3).orientation).toBe("horizontal");
    expect(calendarLayout(1200, 3).orientation).toBe("horizontal");
    expect(calendarLayout(569, 3).orientation).toBe("months");
  });

  it("puts three months across on a phone-width card, inside the width", () => {
    const layout = calendarLayout(311, 4);
    if (layout.orientation !== "months") throw new Error("expected months");
    expect(layout.columns).toBe(3);
    expect(layout.monthOrigin(1).y).toBe(layout.monthOrigin(0).y);
    expect(layout.monthOrigin(1).x).toBeGreaterThan(layout.monthOrigin(0).x);
    expect(layout.monthOrigin(3).x).toBe(layout.monthOrigin(0).x);
    expect(layout.monthOrigin(3).y).toBeGreaterThan(layout.monthOrigin(0).y);
    expect(layout.yearOrigin(1).y).toBeGreaterThan(layout.monthOrigin(11).y);
    expect(layout.contentWidth).toBeLessThanOrEqual(311);
  });

  it("uses more months per row, with capped cells, when there's room", () => {
    const layout = calendarLayout(560, 1);
    if (layout.orientation !== "months") throw new Error("expected months");
    expect(layout.columns).toBe(4);
    expect(layout.cellSize).toBeLessThanOrEqual(16);
    expect(layout.contentWidth).toBeLessThanOrEqual(560);
  });

  it("still fits the narrowest ResponsiveChart width", () => {
    expect(calendarLayout(240, 1).contentWidth).toBeLessThanOrEqual(240);
  });
});

describe("InteractiveCalendar month grid", () => {
  it("runs weekdays across and each month's weeks down when narrow", () => {
    const { container } = renderCalendar(360);
    const cells = cellByFill(container);
    expect(cells).toHaveLength(POINTS.length);
    const [mon, sun, lateDec] = cells.map(pos);
    // Same week, different weekday: same row, Sunday to the right.
    expect(sun.y).toBe(mon.y);
    expect(sun.x).toBeGreaterThan(mon.x);
    // December sits in the bottom-right month.
    expect(lateDec.x).toBeGreaterThan(mon.x);
    expect(lateDec.y).toBeGreaterThan(mon.y);
  });

  it("draws a placeholder for every day of each year", () => {
    const { container } = renderCalendar(360);
    expect(container.querySelectorAll("rect.blank")).toHaveLength(365 + 366);
  });

  it("runs weeks across and weekdays down when wide (desktop unchanged)", () => {
    const { container } = renderCalendar(1000);
    const [mon, sun, lateDec] = cellByFill(container).map(pos);
    expect(sun.x).toBe(mon.x);
    expect(sun.y).toBeGreaterThan(mon.y);
    expect(lateDec.y).toBe(mon.y);
    expect(lateDec.x).toBeGreaterThan(mon.x);
    expect(container.querySelectorAll("rect.blank")).toHaveLength(0);
  });
});

describe("InteractiveCalendar tap", () => {
  const tooltipShown = (container: HTMLElement) => container.textContent?.includes("value") ?? false;

  it("keeps a tapped day's tooltip after the finger lifts, until the next tap elsewhere", () => {
    const { container } = renderCalendar(360);
    const hit = container.querySelector("rect.hit")!;
    act(() => {
      fireEvent.pointerEnter(hit, { pointerType: "touch" });
      fireEvent.pointerDown(hit, { pointerType: "touch" });
      fireEvent.pointerLeave(hit, { pointerType: "touch" });
    });
    expect(tooltipShown(container)).toBe(true);
    act(() => {
      fireEvent.pointerDown(document.body, { pointerType: "touch" });
    });
    expect(tooltipShown(container)).toBe(false);
  });

  it("still clears on mouse leave", () => {
    const { container } = renderCalendar(360);
    const hit = container.querySelector("rect.hit")!;
    act(() => {
      fireEvent.pointerEnter(hit, { pointerType: "mouse" });
    });
    expect(tooltipShown(container)).toBe(true);
    act(() => {
      fireEvent.pointerLeave(hit, { pointerType: "mouse" });
    });
    expect(tooltipShown(container)).toBe(false);
  });
});
