// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { InteractiveCalendar, calendarLayout, type InteractiveCalendarPoint } from "./interactive-calendar";

// #450: below the horizontal grid's minimum width the calendar turns on its
// side, and a tap pins the tooltip instead of flashing it. jsdom does no
// layout, so this checks the geometry math and event wiring, not how it
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

// Two years, so the vertical layout has something to tile.
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
    expect(calendarLayout(569, 3).orientation).toBe("vertical");
  });

  it("fits two years side by side on a phone-width card, inside the width", () => {
    const layout = calendarLayout(320, 5);
    expect(layout.orientation).toBe("vertical");
    expect(layout.gridOrigin(0).y).toBe(layout.gridOrigin(1).y);
    expect(layout.gridOrigin(1).x).toBeGreaterThan(layout.gridOrigin(0).x);
    expect(layout.gridOrigin(2).y).toBeGreaterThan(layout.gridOrigin(0).y);
    expect(layout.gridOrigin(2).x).toBe(layout.gridOrigin(0).x);
    expect(layout.contentWidth).toBeLessThanOrEqual(320);
  });

  it("caps a lone year's cells so one year doesn't run past a screen", () => {
    const layout = calendarLayout(500, 1);
    expect(layout.cellSize).toBeLessThanOrEqual(16);
    expect(layout.contentWidth).toBeLessThanOrEqual(500);
  });

  it("still fits the narrowest ResponsiveChart width", () => {
    expect(calendarLayout(240, 1).contentWidth).toBeLessThanOrEqual(240);
  });
});

describe("InteractiveCalendar vertical layout", () => {
  it("runs weekdays across and weeks down when narrow", () => {
    const { container } = renderCalendar(360);
    const cells = cellByFill(container);
    expect(cells).toHaveLength(POINTS.length);
    const [mon, sun, lateDec] = cells.map(pos);
    // Same week, different weekday: same row, Sunday to the right.
    expect(sun.y).toBe(mon.y);
    expect(sun.x).toBeGreaterThan(mon.x);
    // Same weekday, later week: same column, further down.
    expect(lateDec.x).toBe(mon.x);
    expect(lateDec.y).toBeGreaterThan(mon.y);
  });

  it("runs weeks across and weekdays down when wide (desktop unchanged)", () => {
    const { container } = renderCalendar(1000);
    const [mon, sun, lateDec] = cellByFill(container).map(pos);
    expect(sun.x).toBe(mon.x);
    expect(sun.y).toBeGreaterThan(mon.y);
    expect(lateDec.y).toBe(mon.y);
    expect(lateDec.x).toBeGreaterThan(mon.x);
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
