// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { usePendingOpenMatch, type PendingOpen } from "@/lib/use-pending-open";

// usePendingOpenMatch's return value is only meaningful for the single
// render pass where a fresh nonce arrives (see the hook's own doc comment
// on why it uses React's "adjust state during render" pattern instead of an
// effect) — a real caller immediately feeds that transient value into its
// own state update in the same render, exactly like movies-section.tsx's
// `usePendingOpenMatch(...)` call site does. This Probe mirrors that real
// shape (appending every match to a visible log) rather than reading the
// hook's raw return directly, since what a mounted UI actually ends up
// showing — not the render function's raw per-call return values — is the
// behavior that matters.
function Probe({ pendingOpen, kind }: { pendingOpen: PendingOpen; kind: "movie" | "book" }) {
  const [openLog, setOpenLog] = useState<number[]>([]);
  const matchedId = usePendingOpenMatch(pendingOpen, kind);
  if (matchedId !== null) {
    setOpenLog((prev) => [...prev, matchedId]);
  }
  return <div data-testid="opened">{openLog.join(",")}</div>;
}

function openedLog() {
  return screen.getByTestId("opened").textContent;
}

describe("usePendingOpenMatch", () => {
  it("opens nothing when pendingOpen is null", () => {
    render(<Probe pendingOpen={null} kind="movie" />);
    expect(openedLog()).toBe("");
  });

  it("does not open when pendingOpen targets a different kind", () => {
    render(<Probe pendingOpen={{ kind: "book", id: 5, nonce: 1 }} kind="movie" />);
    expect(openedLog()).toBe("");
  });

  it("opens with the matched id once a new nonce for this kind arrives", () => {
    const { rerender } = render(<Probe pendingOpen={null} kind="movie" />);
    rerender(<Probe pendingOpen={{ kind: "movie", id: 42, nonce: 1 }} kind="movie" />);
    expect(openedLog()).toBe("42");
  });

  it("does not re-open on a later render with the same pendingOpen/nonce", () => {
    const pendingOpen: PendingOpen = { kind: "movie", id: 42, nonce: 1 };
    const { rerender } = render(<Probe pendingOpen={pendingOpen} kind="movie" />);
    expect(openedLog()).toBe("42");
    // A parent re-render for an unrelated reason, same pendingOpen object.
    rerender(<Probe pendingOpen={pendingOpen} kind="movie" />);
    expect(openedLog()).toBe("42");
  });

  it("re-opens when the same id is reselected with a fresh nonce", () => {
    const { rerender } = render(<Probe pendingOpen={{ kind: "movie", id: 42, nonce: 1 }} kind="movie" />);
    expect(openedLog()).toBe("42");
    rerender(<Probe pendingOpen={{ kind: "movie", id: 42, nonce: 2 }} kind="movie" />);
    expect(openedLog()).toBe("42,42");
  });
});
