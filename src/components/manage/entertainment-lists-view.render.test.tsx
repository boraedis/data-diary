// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EntertainmentListsView, type EntertainmentTypeLists } from "./entertainment-lists-view";

// A mounted-DOM pass over the read-only rankings/watchlists view (#549):
// ranked lists number their rows, entries and section headers link through,
// and an empty list says so rather than rendering a blank section.

const TYPES: EntertainmentTypeLists[] = [
  {
    type: "Movies",
    lists: [
      {
        label: "Top 10",
        ranked: true,
        editHref: "/manage/entertainment/movies/ranking",
        entries: [
          { id: 7, title: "Heat", detail: "1995", href: "/manage/entertainment/movies/7" },
          { id: 3, title: "Ran", detail: "1985", href: "/manage/entertainment/movies/3" },
        ],
      },
      { label: "Watchlist", ranked: false, editHref: "/manage/entertainment/movies/watchlist", entries: [] },
    ],
  },
];

describe("EntertainmentListsView", () => {
  it("numbers ranked rows in order and links each entry to its own page", () => {
    render(<EntertainmentListsView types={TYPES} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("1");
    expect(items[0].textContent).toContain("Heat");
    expect(items[1].textContent).toContain("2");
    expect(screen.getByRole("link", { name: /Heat/ }).getAttribute("href")).toBe("/manage/entertainment/movies/7");
  });

  it("links each section header to that list's editor", () => {
    render(<EntertainmentListsView types={TYPES} />);
    const edits = screen.getAllByRole("link", { name: "Edit" });
    expect(edits.map((a) => a.getAttribute("href"))).toEqual([
      "/manage/entertainment/movies/ranking",
      "/manage/entertainment/movies/watchlist",
    ]);
  });

  it("shows an empty state for an empty list", () => {
    render(<EntertainmentListsView types={TYPES} />);
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
  });
});
