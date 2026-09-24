// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { InteractiveRanked, type RankedColumn } from "./interactive-ranked";
import type { RankMovement } from "@/lib/ranking";

// A mounted-DOM pass over the leaderboard table (#115): that each column
// kind renders its own feature, that sorting reorders rows without
// renumbering them, and that movement direction is carried by a label and
// glyph as well as colour.
//
// jsdom does no layout or CSS, so this proves structure and wiring — not
// how the tints, ramps or pinned columns actually look.

type Row = {
  id: string;
  name: string;
  path: string;
  color: string;
  value: number;
  rank: number;
  week: RankMovement;
};

const rows: Row[] = [
  { id: "a", name: "Home", path: "USA › Georgia", color: "#123456", value: 900, rank: 1, week: { delta: 0, isNew: false, previousRank: 1 } },
  { id: "b", name: "Office", path: "USA › Georgia", color: "#123456", value: 40, rank: 2, week: { delta: 3, isNew: false, previousRank: 5 } },
  { id: "c", name: "Cafe", path: "Turkey › Istanbul", color: "#abcdef", value: 12, rank: 3, week: { delta: -1, isNew: false, previousRank: 2 } },
  { id: "d", name: "Airport", path: "Turkey", color: "#abcdef", value: 2, rank: 4, week: { delta: null, isNew: true, previousRank: null } },
];

const columns: RankedColumn<Row>[] = [
  { kind: "text", id: "name", header: "Place", value: (r) => r.name },
  { kind: "text", id: "path", header: "Path", value: (r) => r.path, cellColor: { color: (r) => r.color } },
  { kind: "number", id: "mentions", header: "Mentions", value: (r) => r.value, conditional: { type: "scale", log: true } },
  { kind: "movement", id: "week", header: "Week", movement: (r) => r.week, since: "a week ago" },
];

function renderTable() {
  return render(
    <InteractiveRanked rows={rows} getKey={(r) => r.id} rank={(r) => r.rank} columns={columns} ariaLabel="Places" />,
  );
}

/** Row names in DOM order, skipping the header row. */
function names() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[1].textContent);
}

describe("InteractiveRanked", () => {
  it("renders a rank column then the declared columns", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.replace(/[↑↓]/g, "").trim());
    expect(headers).toEqual(["#", "Place", "Path", "Mentions", "Week"]);
    expect(names()).toEqual(["Home", "Office", "Cafe", "Airport"]);
  });

  it("tints a cell-coloured column with each row's own colour", () => {
    renderTable();
    const cafePath = screen.getByText("Turkey › Istanbul").closest("td")!;
    expect(cafePath.style.boxShadow).toContain("#abcdef");
  });

  it("shades conditionally formatted numbers with a readable text colour", () => {
    renderTable();
    const chip = screen.getByText("900");
    expect(chip.style.backgroundColor).not.toBe("");
    expect(["rgb(17, 17, 17)", "rgb(255, 255, 255)"]).toContain(chip.style.color);
  });

  it("says which way a row moved in words, not only colour", () => {
    renderTable();
    expect(screen.getByLabelText("Up 3 places since a week ago — 5th then, 2nd now")).toBeTruthy();
    expect(screen.getByLabelText("Down 1 place since a week ago — 2nd then, 3rd now")).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByTitle("No change since a week ago — still 1st")).toBeTruthy();
  });

  it("sorts by a header without renumbering ranks, and cycles back to rank order", () => {
    renderTable();
    const mentionsHeader = screen.getByRole("columnheader", { name: /Mentions/ });
    const button = within(mentionsHeader).getByRole("button");

    // Numbers sort biggest-first on the first click — already rank order.
    fireEvent.click(button);
    expect(mentionsHeader.getAttribute("aria-sort")).toBe("descending");
    expect(names()).toEqual(["Home", "Office", "Cafe", "Airport"]);

    fireEvent.click(button);
    expect(mentionsHeader.getAttribute("aria-sort")).toBe("ascending");
    expect(names()).toEqual(["Airport", "Cafe", "Office", "Home"]);
    // The rank cell travels with its row.
    const firstRow = screen.getAllByRole("row")[1];
    expect(within(firstRow).getAllByRole("cell")[0].textContent).toBe("4");

    fireEvent.click(button);
    expect(mentionsHeader.getAttribute("aria-sort")).toBe("none");
    expect(names()).toEqual(["Home", "Office", "Cafe", "Airport"]);
  });

  it("sorts movement biggest climb first, with new entries after the rest", () => {
    renderTable();
    fireEvent.click(within(screen.getByRole("columnheader", { name: /Week/ })).getByRole("button"));
    expect(names()).toEqual(["Office", "Home", "Cafe", "Airport"]);
  });
});
