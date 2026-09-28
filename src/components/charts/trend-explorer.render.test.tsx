// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TrendExplorer } from "./trend-explorer";
import { addDays } from "@/lib/date";

// A mounted-DOM pass over TrendExplorer's Bucket by row (#451): the three
// seasonal folds sit beside the calendar periods, and Day of Year alone
// brings up its Smoothing picker. jsdom does no layout, so this proves the
// controls are wired, not how the row looks.

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

type Row = { date: string; value: number };
const DATA: Row[] = Array.from({ length: 800 }, (_, i) => ({ date: addDays("2024-01-01", i), value: i % 10 }));

function renderExplorer() {
  return render(
    <TrendExplorer<Row>
      data={DATA}
      title="Test"
      description="Test chart"
      seriesId="v"
      label="Value"
      color="red"
      getValue={(r) => r.value}
      aggregate="mean"
      valueFormat={String}
      ariaLabel="Test chart"
    />,
  );
}

describe("TrendExplorer Bucket by", () => {
  it("offers the seasonal folds beside the periods", () => {
    renderExplorer();
    for (const name of ["Week", "Month", "Quarter", "Year", "Day of Week", "Month of Year", "Day of Year"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("shows the Smoothing picker only for Day of Year", () => {
    renderExplorer();
    expect(screen.queryByRole("group", { name: "Smoothing" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Day of Year" }));
    const smoothing = screen.getByRole("group", { name: "Smoothing" });
    expect([...smoothing.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "None",
      "±1 day",
      "±3 days",
      "±7 days",
    ]);
    expect(screen.getByRole("button", { name: "None" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "±3 days" }));
    expect(screen.getByRole("button", { name: "±3 days" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Month of Year" }));
    expect(screen.queryByRole("group", { name: "Smoothing" })).toBeNull();
  });
});
