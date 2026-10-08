// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GameDetail } from "./game-detail";
import type { GameUsage } from "@/lib/days";

// The Session history card (#589). The page sits behind sign-in, so this is
// what proves each row reaches the right day page, carries its details,
// and that the card's total and empty state read as specified. jsdom: wiring,
// not appearance.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const GAME = { id: 7, name: "Backgammon", type: "Board", subtype: null };

function renderWith(usage: GameUsage) {
  return render(<GameDetail game={GAME} usage={usage} categories={[]} />);
}

describe("GameDetail session history", () => {
  it("lists every session, newest first as given, linked to its day", () => {
    renderWith({
      sessionCount: 3,
      sessions: [
        { date: "2026-09-14", durationMinutes: 1800, deviceType: "Phone", locationType: "Home" },
        { date: "2026-09-02", durationMinutes: 45, deviceType: null, locationType: "Cafe" },
        { date: "2026-08-30", durationMinutes: null, deviceType: null, locationType: null },
      ],
    });
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/day/"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/day/2026-09-14/entertainment",
      "/day/2026-09-02/entertainment",
      "/day/2026-08-30/entertainment",
    ]);
    expect(links[0].textContent).toContain("2026-09-14");
    expect(links[0].textContent).toContain("30h · Phone · Home");
    expect(links[1].textContent).toContain("45m · Cafe");
    expect(links[2].textContent).toBe("2026-08-30");
    // 1800 + 45 minutes = 30.75h, the session without a duration adding
    // nothing; past 10h `formatHoursTotal` rounds to whole hours.
    expect(screen.getByText("31h total")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy(); // the Logged sessions count
  });

  it("says nothing's logged when there are no sessions", () => {
    renderWith({ sessionCount: 0, sessions: [] });
    expect(screen.getByText("Nothing logged yet.")).toBeTruthy();
    expect(screen.queryByText(/total$/)).toBeNull();
  });
});
