// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { InteractiveBarRace, readableTextColor } from "./interactive-bar-race";
import type { RaceFrame } from "@/lib/viz/race";

// A mounted-DOM pass over what race.test.ts's pure math can't reach: that
// the d3 scaffolding actually renders, that the transport controls move
// the clock, and — the thing most worth pinning — that playback goes
// through direct DOM writes rather than React state, since that's the one
// design decision in this component a future refactor could quietly undo
// (see the file header, and AGENTS.md on useD3's deps).
//
// jsdom does no layout, so this proves structure and wiring, not
// appearance — bar geometry is pure math against the scales, but nothing
// here says the race *looks* right or animates smoothly. See the PR for
// what was verified visually.

const FRAMES: RaceFrame[] = [
  {
    date: new Date(2024, 0, 1),
    entries: [
      { label: "Ana", value: 10 },
      { label: "Bo", value: 4 },
    ],
  },
  {
    date: new Date(2024, 1, 1),
    entries: [
      { label: "Ana", value: 12 },
      { label: "Bo", value: 40 },
      { label: "Cy", value: 6 },
    ],
  },
];

function rows(container: HTMLElement): SVGGElement[] {
  return [...container.querySelectorAll<SVGGElement>("g.race-row")];
}

/** Labels in drawn rank order — rows are positioned by a transform, not by
 * document order, so ranking has to be read off the geometry. */
function orderedLabels(container: HTMLElement): string[] {
  return rows(container)
    .map((row) => ({
      label: row.querySelector("text.race-name")?.textContent ?? "",
      y: Number(/translate\(0,([-\d.]+)\)/.exec(row.getAttribute("transform") ?? "")?.[1] ?? 0),
    }))
    .sort((a, b) => a.y - b.y)
    .map((r) => r.label);
}

function valueFor(container: HTMLElement, label: string): string {
  const row = rows(container).find((r) => r.querySelector("text.race-name")?.textContent === label);
  return row?.querySelector("text.race-value")?.textContent ?? "";
}

function renderRace(props: Partial<React.ComponentProps<typeof InteractiveBarRace>> = {}) {
  return render(
    <InteractiveBarRace frames={FRAMES} width={600} height={400} autoPlay={false} {...props} />,
  );
}

describe("InteractiveBarRace", () => {
  it("draws a row per racer, ranked, starting at the first frame", () => {
    const { container } = renderRace();
    // Cy has no entry in the first frame and is drawn at zero, below the
    // two who do — same as legacy, which ranked every name every frame.
    expect(orderedLabels(container)).toEqual(["Ana", "Bo", "Cy"]);
    expect(valueFor(container, "Ana")).toBe("10");
    expect(valueFor(container, "Cy")).toBe("0");
  });

  it("slides a swapping bar between rows instead of jumping it", () => {
    const { container } = renderRace();
    const yOf = (label: string) =>
      Number(
        /translate\(0,([-\d.]+)\)/.exec(
          rows(container)
            .find((r) => r.querySelector("text.race-name")?.textContent === label)
            ?.getAttribute("transform") ?? "",
        )?.[1] ?? NaN,
      );

    const anaStart = yOf("Ana");
    const boStart = yOf("Bo");
    fireEvent.change(screen.getByLabelText("Scrub through time"), { target: { value: "0.5" } });
    // Ana leads at frame 0 and Bo at frame 1; halfway through the swap
    // both sit between the two rows rather than either having jumped.
    expect(yOf("Ana")).toBeCloseTo((anaStart + boStart) / 2, 5);
    expect(yOf("Bo")).toBeCloseTo((anaStart + boStart) / 2, 5);
  });

  it("keeps only the rows near the cut in the DOM", () => {
    const many: RaceFrame[] = [
      {
        date: new Date(2024, 0, 1),
        entries: Array.from({ length: 40 }, (_, i) => ({ label: `P${i}`, value: 40 - i })),
      },
    ];
    const { container } = renderRace({ frames: many, topN: 3 });
    // topN plus the one below the cut a climbing bar rises out of.
    expect(rows(container)).toHaveLength(4);
  });

  it("re-ranks and re-values when scrubbed, without remounting the rows", () => {
    const { container } = renderRace();
    const anaRow = rows(container).find((r) => r.querySelector("text.race-name")?.textContent === "Ana");

    fireEvent.change(screen.getByLabelText("Scrub through time"), { target: { value: "1" } });

    expect(orderedLabels(container)).toEqual(["Bo", "Ana", "Cy"]);
    expect(valueFor(container, "Bo")).toBe("40");
    // Same DOM node, moved — the keyed join is what makes bars cross each
    // other instead of being torn down and rebuilt at their new rank.
    expect(rows(container).find((r) => r.querySelector("text.race-name")?.textContent === "Ana")).toBe(
      anaRow,
    );
  });

  it("interpolates between frames rather than snapping to one", () => {
    const { container } = renderRace();
    fireEvent.change(screen.getByLabelText("Scrub through time"), { target: { value: "0.5" } });
    expect(valueFor(container, "Ana")).toBe("11"); // halfway between 10 and 12
    expect(valueFor(container, "Cy")).toBe("3"); // grows out of zero
  });

  it("advances on its own while playing, and stops at the end", async () => {
    vi.useFakeTimers();
    try {
      const { container } = renderRace();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Play" }));
      });
      expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();

      // jsdom's requestAnimationFrame is timer-driven, so advancing the
      // clock runs real frames. A two-frame race at 3 frames/second is
      // over well inside a second.
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(orderedLabels(container)).toEqual(["Bo", "Ana", "Cy"]);
      // The clock stops itself at the finish rather than looping.
      expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses when scrubbed mid-playback", async () => {
    vi.useFakeTimers();
    try {
      renderRace();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Play" }));
      });
      await act(async () => {
        fireEvent.change(screen.getByLabelText("Scrub through time"), { target: { value: "0.3" } });
      });
      expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders nothing to race, and no crash, for no frames", () => {
    const { container } = renderRace({ frames: [] });
    expect(rows(container)).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Play" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("readableTextColor", () => {
  it("picks dark text on a light bar and light text on a dark one", () => {
    expect(readableTextColor("#f7e463")).toBe("#111111"); // pale yellow
    expect(readableTextColor("#1a2a6c")).toBe("#fafafa"); // navy
  });

  it("falls back to the bar's computed fill when the color is a CSS var", () => {
    // `var(--chart-1)` is unparseable as a color; the resolved fill of the
    // element it's painting is what the browser actually drew. Set as an
    // inline style rather than a presentation attribute because jsdom
    // doesn't fold SVG presentation attributes into computed style — a
    // real browser resolves both, and the `var()` case with it.
    const node = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    node.style.fill = "#ffffff";
    document.body.append(node);
    expect(readableTextColor("var(--chart-1)", node)).toBe("#111111");
    node.remove();
  });

  it("degrades to the surface color when nothing resolves", () => {
    expect(readableTextColor("var(--chart-1)", null)).toBe("var(--card)");
  });
});
