import { describe, expect, it } from "vitest";
import { buildMetroTree } from "@/components/charts/place-hierarchy-explorer";
import type { PlaceHierarchyRow } from "@/lib/charts";
import { AREA_OVERFLOW_COLOR } from "@/lib/viz/area-colors";

// Metro mode's top-level colours (#215): each area — a metro, or a
// municipality outside one — takes the Centre of Gravity chart's colour.

function row(p: Partial<PlaceHierarchyRow> & Pick<PlaceHierarchyRow, "id" | "name">): PlaceHierarchyRow {
  return { alias: null, parentId: null, category: null, subcategory: null, rootColor: null, value: 0, metro: null, ...p };
}

const ROWS: PlaceHierarchyRow[] = [
  row({ id: 1, name: "USA" }),
  row({ id: 2, name: "Washington", parentId: 1, subcategory: "Municipality", metro: "Washington DC", value: 10 }),
  row({ id: 3, name: "Arlington", parentId: 1, subcategory: "Municipality", metro: "Washington DC", value: 5 }),
  row({ id: 4, name: "Turkey" }),
  row({ id: 5, name: "Bursa", parentId: 4, subcategory: "Municipality", value: 4 }),
  row({ id: 6, name: "Izmir", parentId: 4, subcategory: "Municipality", value: 2 }),
];

const top = (tree: ReturnType<typeof buildMetroTree>) => new Map(tree!.children!.map((c) => [c.name, c.color]));

describe("buildMetroTree area colours", () => {
  it("colours metros by name and standalone municipalities by id, the rest grey", () => {
    const tree = buildMetroTree(ROWS, { metros: { "Washington DC": "#ed4b7c" }, places: { "5": "#00a9b1" } });
    const colors = top(tree);
    expect(colors.get("Washington DC")).toBe("#ed4b7c");
    expect(colors.get("Bursa")).toBe("#00a9b1");
    expect(colors.get("Izmir")).toBe(AREA_OVERFLOW_COLOR);
  });

  it("leaves colour to the donut when no area colours are given", () => {
    const colors = top(buildMetroTree(ROWS));
    expect([...colors.values()].every((c) => c === undefined)).toBe(true);
  });
});
