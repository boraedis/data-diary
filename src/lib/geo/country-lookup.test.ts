import { describe, expect, it } from "vitest";
import { listCountryFeatures, resolveCountryCode } from "./country-lookup";

// Tested against the real world-atlas file this app ships, not fixtures —
// the whole point of the module is what that file actually contains.

describe("resolveCountryCode", () => {
  it("returns the ISO 3166-1 numeric code as a string", () => {
    expect(resolveCountryCode("United States of America")).toMatchObject({ code: "840", hasIsoCode: true });
    expect(resolveCountryCode("Canada")).toMatchObject({ code: "124", hasIsoCode: true });
  });

  it("reuses the catalog's own aliases rather than a second table", () => {
    // normalizeCountryName already maps these for the world chart's
    // day-count join; resolution here rides on it.
    expect(resolveCountryCode("USA")?.code).toBe("840");
    expect(resolveCountryCode("UK")?.code).toBe(resolveCountryCode("United Kingdom")?.code);
    expect(resolveCountryCode("Czech Republic")?.code).toBe(resolveCountryCode("Czechia")?.code);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveCountryCode("  japan  ")?.code).toBe(resolveCountryCode("Japan")?.code);
  });

  it("falls back to the name for the territories with no ISO code", () => {
    // Kosovo is the one that matters — a plausible destination that a
    // strict ISO key would make unrepresentable.
    for (const name of ["Kosovo", "Somaliland", "N. Cyprus"]) {
      const ref = resolveCountryCode(name);
      expect(ref, name).not.toBeNull();
      expect(ref!.hasIsoCode, name).toBe(false);
      expect(ref!.code, name).toBe(name);
    }
  });

  it("returns null for a country world-atlas doesn't draw", () => {
    expect(resolveCountryCode("Atlantis")).toBeNull();
  });
});

describe("listCountryFeatures", () => {
  it("lists every feature exactly once, name-sorted", () => {
    const all = listCountryFeatures();
    expect(all.length).toBe(177);
    expect(new Set(all.map((c) => c.name)).size).toBe(all.length);
    expect(all.map((c) => c.name)).toEqual([...all.map((c) => c.name)].sort((a, b) => a.localeCompare(b)));
  });

  it("keeps every code unique, name fallbacks included", () => {
    // The fallback can only be safe if a name never collides with another
    // country's ISO code or name — this is that guarantee.
    const codes = listCountryFeatures().map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has exactly three name-coded features", () => {
    expect(listCountryFeatures().filter((c) => !c.hasIsoCode)).toHaveLength(3);
  });
});
