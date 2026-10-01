// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InteractiveBump, type InteractiveBumpSeries } from "./interactive-bump";

// A mounted-DOM pass over InteractiveBump: ribbons and dots are drawn from
// the ranks, a gap splits a ribbon, end labels show on a wide chart and are
// dropped on a narrow one, and keyboard focus highlights one ribbon. jsdom
// does no layout, so this proves structure and wiring, not appearance.

const COLUMNS = ["2022", "2023", "Now"];
const SERIES: InteractiveBumpSeries[] = [
  { id: "a", label: "Heat", color: "red", ranks: [1, 2, 1] },
  { id: "b", label: "Ran", color: "blue", ranks: [2, 1, null] },
  // Out, then back: two separate runs, so no ribbon through the gap.
  { id: "c", label: "Stalker", color: "green", ranks: [3, null, 3] },
];

function renderBump(width = 800) {
  return render(<InteractiveBump columns={COLUMNS} series={SERIES} maxRank={10} width={width} height={400} ariaLabel="ribbons" />);
}

describe("InteractiveBump", () => {
  it("draws a dot for every ranked point and a ribbon for every run of two or more", () => {
    const { container } = renderBump();
    // 3 + 2 + 2 ranked points.
    expect(container.querySelectorAll("circle")).toHaveLength(7);
    // a: one run, b: one run, c: two single-point runs, so no ribbon.
    expect(container.querySelectorAll("path")).toHaveLength(2);
  });

  it("labels the first and last column on a wide chart", () => {
    const { container } = renderBump(800);
    const labels = [...container.querySelectorAll("text.bump-series")].map((t) => t.textContent);
    // First column: all three. Last column: Heat and Stalker (Ran dropped out).
    expect(labels.sort()).toEqual(["Heat", "Heat", "Ran", "Stalker", "Stalker"]);
  });

  it("drops the end labels on a narrow chart", () => {
    const { container } = renderBump(360);
    expect(container.querySelectorAll("text.bump-series")).toHaveLength(0);
  });

  it("keyboard focus highlights one ribbon and fades the rest", () => {
    const { container } = renderBump();
    const region = screen.getByRole("img", { name: "ribbons" });
    fireEvent.focus(region);
    const opacity = (id: string) => (container.querySelector(`g[data-series="${id}"]`) as SVGElement).style.opacity;
    expect(opacity("a")).toBe("1");
    expect(opacity("b")).toBe("0.15");
    fireEvent.keyDown(region, { key: "ArrowDown" });
    expect(opacity("b")).toBe("1");
    expect(opacity("a")).toBe("0.15");
    fireEvent.keyDown(region, { key: "Escape" });
    expect(opacity("a")).toBe("1");
  });

  it("shows the ribbon's rank in each year it was ranked", () => {
    renderBump();
    fireEvent.focus(screen.getByRole("img", { name: "ribbons" }));
    const tip = screen.getByRole("status");
    expect(tip.textContent).toContain("Heat");
    expect(tip.textContent).toContain("2022");
    expect(tip.textContent).toContain("#1");
    expect(tip.textContent).toContain("#2");
  });
});
