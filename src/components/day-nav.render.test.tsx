// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DayNav } from "./day-nav";

// #666: the Home link on a day summary went to "/", the public landing page,
// instead of the owner's dashboard. Every other in-app Home link goes to /home.
// jsdom: wiring (where the link points), not appearance.

describe("DayNav Home link", () => {
  it("points the day summary's Home link at the owner dashboard, not the public landing page", () => {
    render(<DayNav date="2026-10-19" />);
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/home");
  });

  it("keeps a section page's Summary link on the same day", () => {
    render(<DayNav date="2026-10-19" category="sleep" />);
    expect(screen.getByRole("link", { name: "Summary" }).getAttribute("href")).toBe("/day/2026-10-19");
  });
});
