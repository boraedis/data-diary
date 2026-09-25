// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { InteractiveNetwork, type NetworkEdge, type NetworkNode } from "./interactive-network";

// A mounted-DOM pass over the wiring the browser check can't pin down as
// cheaply: every node and edge is drawn, a click reports the node through
// `onSelect`, and a controlled selection change restyles the live graph
// *without* rebuilding it (the rebuild-on-hover bug the first version of
// this primitive shipped with). jsdom does no layout, so nothing here says
// anything about how the graph looks — see the PR for what was verified
// visually.

// Module-level: the primitive's props are rebuild dependencies, and fresh
// arrays per render would rebuild on every rerender, hiding exactly the
// bug the selection test is here to catch.
const NODES: NetworkNode[] = [
  { id: 1, label: "Ann", count: 40 },
  { id: 2, label: "Bob", count: 30 },
  { id: 3, label: "Cat", count: 10 },
];
const EDGES: NetworkEdge[] = [
  { source: 1, target: 2, weight: 0.8 },
  { source: 2, target: 3, weight: 0.2 },
];

afterEach(cleanup);

/** By D3's bound datum rather than DOM order: focusing a node raises it
 * and its neighbours to the top of the paint order, so position among the
 * circles isn't stable across a selection change. */
function circleFor(container: HTMLElement, label: string): SVGCircleElement {
  return [...container.querySelectorAll("circle")].find(
    (c) => (c as unknown as { __data__: NetworkNode }).__data__.label === label,
  ) as SVGCircleElement;
}

describe("InteractiveNetwork", () => {
  it("draws one circle and label per node and one line per edge", () => {
    const { container } = render(<InteractiveNetwork nodes={NODES} edges={EDGES} width={400} height={300} />);
    expect(container.querySelectorAll("circle")).toHaveLength(3);
    expect(container.querySelectorAll("line")).toHaveLength(2);
    expect([...container.querySelectorAll("text")].map((t) => t.textContent)).toEqual(["Ann", "Bob", "Cat"]);
  });

  it("drops edges whose endpoints aren't among the nodes", () => {
    const { container } = render(
      <InteractiveNetwork
        nodes={NODES}
        edges={[...EDGES, { source: 1, target: 99, weight: 1 }]}
        width={400}
        height={300}
      />,
    );
    expect(container.querySelectorAll("line")).toHaveLength(2);
  });

  it("reports a clicked node, and a second click on it clears", () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(
      <InteractiveNetwork nodes={NODES} edges={EDGES} width={400} height={300} onSelect={onSelect} />,
    );
    fireEvent.click(circleFor(container, "Bob"));
    expect(onSelect).toHaveBeenLastCalledWith(2);

    rerender(
      <InteractiveNetwork nodes={NODES} edges={EDGES} width={400} height={300} selectedId={2} onSelect={onSelect} />,
    );
    fireEvent.click(circleFor(container, "Bob"));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("applies a controlled selection to the existing graph without rebuilding it", () => {
    const { container, rerender } = render(
      <InteractiveNetwork nodes={NODES} edges={EDGES} width={400} height={300} selectedId={null} />,
    );
    const before = circleFor(container, "Ann");

    rerender(<InteractiveNetwork nodes={NODES} edges={EDGES} width={400} height={300} selectedId={1} />);
    const after = circleFor(container, "Ann");
    // Same element, not an equal-looking replacement: the graph wasn't rebuilt.
    expect(after === before).toBe(true);
    expect(after.getAttribute("stroke")).toBe("var(--foreground)");
    // Cat isn't Ann's neighbour, so it's dimmed; Bob is, so it isn't.
    expect(circleFor(container, "Cat").parentElement!.getAttribute("opacity")).toBe("0.15");
    expect(circleFor(container, "Bob").parentElement!.getAttribute("opacity")).toBe("1");
  });
});
