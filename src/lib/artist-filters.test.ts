import { describe, expect, it } from "vitest";
import { filterArtists } from "@/lib/artist-filters";

const none = { genres: [] as string[], hasGroup: false };
const ungrouped = { genres: ["dream pop"], hasGroup: false };
const grouped = { genres: ["indie rock"], hasGroup: true };
const ARTISTS = [none, ungrouped, grouped];

describe("filterArtists", () => {
  it("keeps everyone for all", () => {
    expect(filterArtists(ARTISTS, "all")).toEqual(ARTISTS);
  });

  it("no-genre keeps only artists with no genres", () => {
    expect(filterArtists(ARTISTS, "no-genre")).toEqual([none]);
  });

  it("no-group keeps artists with no genres and artists whose genres are all ungrouped", () => {
    expect(filterArtists(ARTISTS, "no-group")).toEqual([none, ungrouped]);
  });

  it("preserves the incoming (listening-time) order", () => {
    expect(filterArtists([ungrouped, none], "no-group")).toEqual([ungrouped, none]);
  });
});
