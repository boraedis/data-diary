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
