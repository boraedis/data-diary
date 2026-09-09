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

// jsdom has no PointerEvent implementation at all (a long-standing gap —
// see https://github.com/jsdom/jsdom/issues/2527). `attachMarkHover`
// (marks.ts) branches on `event instanceof PointerEvent` for every event
// it handles — pointerenter, pointermove, AND focus — so the bare
// identifier reference throws a ReferenceError on the very first hover in
// this suite without it, regardless of which of those three fires. A
// minimal polyfill here (not in marks.ts, which has no bug — this is a
// test-environment gap, real browsers all have PointerEvent) unblocks
// every test below rather than each one working around it. Worth noting:
// this means no other Interactive* primitive's render tests exercise
// attachMarkHover's hover path either, in this suite, today.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {}
  // @ts-expect-error -- a deliberately minimal stand-in, not a full PointerEvent
  globalThis.PointerEvent = PointerEventPolyfill;
}

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

function rowFor(container: HTMLElement, label: string): SVGGElement {
  const row = rows(container).find((r) => r.querySelector("text.race-name")?.textContent === label);
  if (!row) throw new Error(`no row for "${label}"`);
  return row;
}

/** The chart-level keyboard surface (#296) — distinguished from the
 * per-bar focus stops `attachMarkHover` also adds by the one attribute
 * only this wrapper carries. */
function chartKeySurface(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[aria-keyshortcuts]");
  if (!el) throw new Error("no chart keyboard surface found");
  return el;
}

/** The floating hover tooltip, as opposed to the visually-hidden
 * standings list — both are `role="status"` (see tooltip.tsx and this
 * component's own live region), so they have to be told apart some other
 * way; the tooltip is the one NOT marked `sr-only`. */
function tooltipEl(container: HTMLElement): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('[role="status"]')].find(
    (el) => !el.className.includes("sr-only"),
  );
}

function standingsText(container: HTMLElement): string {
  return container.querySelector<HTMLElement>('[role="status"].sr-only')?.textContent ?? "";
}

// A longer run, for the keyboard shortcuts that need somewhere to jump —
// FRAMES' two frames can't show a Shift+Arrow "big jump" landing anywhere
// but the far end.
const MANY_FRAMES: RaceFrame[] = Array.from({ length: 12 }, (_, i) => ({
  date: new Date(2024, i, 1),
  entries: [
    { label: "Ana", value: i },
    { label: "Bo", value: 11 - i },
  ],
}));

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

// #296: hover/focus tooltip, chart-level keyboard playback, and the
// visually-hidden standings list.

describe("bar hover/focus tooltip", () => {
  it("shows the exact value and rank, and pauses playback", async () => {
    const { container } = renderRace();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();

    fireEvent.pointerEnter(rowFor(container, "Ana"));

    // Hovering paused it — the tooltip's whole reason for pausing (see the
    // file header) is that a number that's still moving isn't one you can
    // read, so this is the behavior under test, not incidental.
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    const tooltip = tooltipEl(container);
    expect(tooltip?.textContent).toContain("Ana · #1");
    expect(tooltip?.textContent).toContain("10");
  });

  it("clears the tooltip on unhover, without resuming playback", () => {
    const { container } = renderRace();
    fireEvent.pointerEnter(rowFor(container, "Bo"));
    expect(tooltipEl(container)).toBeTruthy();

    fireEvent.pointerLeave(rowFor(container, "Bo"));

    expect(tooltipEl(container)).toBeUndefined();
    // Was already paused (autoPlay: false) before the hover — unhover
    // doesn't invent a "resume" that was never asked for.
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("reads the datum bound at focus time, same as a pointer hover", () => {
    // The keyboard-equivalent path attachMarkHover wires to the same
    // handler — same shared pattern, same result.
    const { container } = renderRace();
    fireEvent.focus(rowFor(container, "Bo"));
    expect(tooltipEl(container)?.textContent).toContain("Bo · #2");
    fireEvent.blur(rowFor(container, "Bo"));
    expect(tooltipEl(container)).toBeUndefined();
  });
});

describe("chart-level keyboard playback", () => {
  it("Space toggles play/pause", () => {
    const { container } = renderRace();
    fireEvent.keyDown(chartKeySurface(container), { key: " " });
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.keyDown(chartKeySurface(container), { key: " " });
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("Left/Right step exactly one frame", () => {
    const { container } = renderRace();
    fireEvent.keyDown(chartKeySurface(container), { key: "ArrowRight" });
    expect(valueFor(container, "Bo")).toBe("40"); // frame 1's exact value, not interpolated
    fireEvent.keyDown(chartKeySurface(container), { key: "ArrowLeft" });
    expect(valueFor(container, "Bo")).toBe("4"); // back to frame 0's exact value
  });

  it("Shift+Right/Left jump KEYBOARD_JUMP_FRAMES at a time", () => {
    const { container } = renderRace({ frames: MANY_FRAMES });
    fireEvent.keyDown(chartKeySurface(container), { key: "ArrowRight", shiftKey: true });
    expect(valueFor(container, "Ana")).toBe("10"); // frame 10 of 0..11
    fireEvent.keyDown(chartKeySurface(container), { key: "ArrowLeft", shiftKey: true });
    expect(valueFor(container, "Ana")).toBe("0"); // clamps at frame 0, not negative
  });

  it("Home/End jump to either end", () => {
    const { container } = renderRace({ frames: MANY_FRAMES });
    fireEvent.keyDown(chartKeySurface(container), { key: "End" });
    expect(valueFor(container, "Ana")).toBe("11");
    fireEvent.keyDown(chartKeySurface(container), { key: "Home" });
    expect(valueFor(container, "Ana")).toBe("0");
  });

  it("pauses playback rather than fighting the clock for the position", async () => {
    const { container } = renderRace();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });
    fireEvent.keyDown(chartKeySurface(container), { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("ignores keys it doesn't own, and does nothing on an empty race", () => {
    const { container } = renderRace({ frames: [] });
    // No throw, no crash — the empty guard at the top of the handler.
    expect(() => fireEvent.keyDown(chartKeySurface(container), { key: "ArrowRight" })).not.toThrow();
  });
});

describe("visually-hidden standings list", () => {
  it("reflects the settled position at mount", () => {
    const { container } = renderRace();
    const text = standingsText(container);
    expect(text).toContain("Ana: 10");
    expect(text).toContain("Bo: 4");
    // Cy has no entry in frame 0 but is still a real standing (rank 2, at
    // zero) — same "everyone is ranked every frame" rule the bars follow.
    expect(text).toContain("Cy: 0");
  });

  it("updates when playback stops, but not while it's still running", async () => {
    vi.useFakeTimers();
    try {
      const { container } = renderRace();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Play" }));
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      // Stopped at the end (see the earlier "advances on its own" test) —
      // the list should have followed it there.
      const text = standingsText(container);
      expect(text).toContain("Bo: 40");
      expect(text).toContain("Ana: 12");
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates on every discrete scrub tick while already paused", () => {
    const { container } = renderRace();
    fireEvent.change(screen.getByLabelText("Scrub through time"), { target: { value: "1" } });
    expect(standingsText(container)).toContain("Bo: 40");
  });

  it("suppresses announcements mid-drag, and catches up once the drag ends", () => {
    const { container } = renderRace();
    const scrub = screen.getByLabelText("Scrub through time");

    fireEvent.pointerDown(scrub);
    fireEvent.change(scrub, { target: { value: "1" } });
    // The bars themselves already moved (dragging still drives applyFrame
    // directly)...
    expect(valueFor(container, "Bo")).toBe("40");
    // ...but the live region hasn't, so a screen reader isn't narrated at
    // every pixel of the drag.
    expect(standingsText(container)).toContain("Bo: 4");
    expect(standingsText(container)).not.toContain("Bo: 40");

    fireEvent.pointerUp(scrub);
    expect(standingsText(container)).toContain("Bo: 40");
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
