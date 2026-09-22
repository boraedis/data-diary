// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UnloggedTravelManage } from "./unlogged-travel-manage";
import type { UnloggedTravelRow } from "@/lib/unlogged-travel";

// The confirm step on removing an entry. Worth a test rather than a
// reading of the diff because the failure mode is silent and
// unrecoverable: the bug this fixes was a delete that fired on the click
// itself, on a list of visually near-identical rows, with no undo and no
// record of what the row held.
//
// The first test in src/components/manage/ — the convention here is the
// charts' own *.render.test.tsx, same tooling, same jsdom caveat: this
// proves wiring, not appearance.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const FULTON: UnloggedTravelRow = {
  kind: "us_county",
  code: "13121",
  firstVisited: null,
  note: null,
  label: "Fulton",
  detail: "Georgia · 13121",
  loggedDays: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockClear();
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderManage(rows: UnloggedTravelRow[] = [FULTON]) {
  return render(<UnloggedTravelManage counties={rows} countries={[]} />);
}

/** The delete trigger on the row, as distinct from the confirm button
 * inside the modal — both are labelled "Delete", so the first one in the
 * document (the row's) is taken before the modal exists. */
function deleteTrigger(): HTMLElement {
  return screen.getAllByRole("button", { name: "Delete" })[0];
}

describe("UnloggedTravelManage delete confirmation", () => {
  it("does not delete anything on the first click", () => {
    renderManage();
    fireEvent.click(deleteTrigger());

    // The whole point: the click opens a prompt, it does not act.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete Fulton\?/)).toBeTruthy();
  });

  it("names what removal actually costs, so the prompt is informative", () => {
    renderManage();
    fireEvent.click(deleteTrigger());

    // A bare "are you sure?" wouldn't tell someone that the date and note
    // go too, or that their logged days don't.
    expect(screen.getByText(/first-visited date and note go with it/)).toBeTruthy();
    // Curly apostrophe: the copy uses &rsquo;, so match around it rather
    // than pinning the character.
    expect(screen.getByText(/days you.{0,8}ve actually logged there are untouched/)).toBeTruthy();
  });

  it("deletes only once confirmed, and by code", async () => {
    renderManage();
    fireEvent.click(deleteTrigger());
    // The modal's own confirm — the second "Delete" in the document.
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({ method: "DELETE" });
    // Keyed by code, not name — the six same-named county/independent-city
    // pairs are the reason the table stores codes at all.
    expect(url).toContain("kind=us_county");
    expect(url).toContain("code=13121");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("abandons the delete when the prompt is dismissed", () => {
    renderManage();
    fireEvent.click(deleteTrigger());
    fireEvent.keyDown(document, { key: "Escape" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a failed delete instead of refreshing the row back into view", async () => {
    // Before the confirm existed this path ignored res.ok, so a failure
    // looked exactly like the click not registering.
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    renderManage();
    fireEvent.click(deleteTrigger());
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);

    await waitFor(() => expect(screen.getByText("Failed to delete")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
