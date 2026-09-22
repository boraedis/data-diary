import { describe, expect, it } from "vitest";
import { listCountryFeatures, listPickableCountries, resolveCountryCode } from "./country-lookup";

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

  it("resolves the microstates 110m didn't draw at all", () => {
    // The whole reason for #383's atlas switch. Each of these was absent
    // from countries-110m, so it could be neither drawn nor stored.
    for (const name of ["Vatican", "San Marino", "Monaco", "Liechtenstein", "Andorra", "Malta", "Singapore"]) {
      const ref = resolveCountryCode(name);
      expect(ref, name).not.toBeNull();
      expect(ref!.hasIsoCode, name).toBe(true);
    }
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
  it("lists every feature exactly once by name, name-sorted", () => {
    const all = listCountryFeatures();
    expect(all.length).toBe(241);
    expect(new Set(all.map((c) => c.name)).size).toBe(all.length);
    expect(all.map((c) => c.name)).toEqual([...all.map((c) => c.name)].sort((a, b) => a.localeCompare(b)));
  });

  it("has exactly five name-coded features, none colliding with a real code", () => {
    // The fallback is only safe while a name never collides with some
    // other feature's ISO code — this is that guarantee, and it's the one
    // that has to survive an atlas change.
    const all = listCountryFeatures();
    const nameCoded = all.filter((c) => !c.hasIsoCode);
    expect(nameCoded).toHaveLength(5);
    const isoCodes = new Set(all.filter((c) => c.hasIsoCode).map((c) => c.code));
    for (const c of nameCoded) expect(isoCodes.has(c.code), c.name).toBe(false);
  });

  it("keeps both halves of a shared ISO code, since it is addressed by name", () => {
    // Natural Earth gives Ashmore and Cartier Islands Australia's own
    // `036`. This view is what a day count recorded under the territory's
    // name joins through, so dropping it here would lose those days.
    const shared = listCountryFeatures().filter((c) => c.code === "036");
    expect(shared.map((c) => c.name).sort()).toEqual(["Ashmore and Cartier Is.", "Australia"]);
  });
});

describe("listPickableCountries", () => {
  it("keeps every code unique", () => {
    // The guarantee the picker and every code-keyed label lookup rely on:
    // one code, one row. Without it the two `036` features present as two
    // choices that write the same value, and whichever sorted last would
    // silently win any Map built from this.
    const codes = listPickableCountries().map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("resolves a shared code to the country, not its dependency", () => {
    expect(listPickableCountries().find((c) => c.code === "036")?.name).toBe("Australia");
  });

  it("drops exactly the duplicates and nothing else", () => {
    // 241 features, one duplicate pair, so 240 codes. Pinned so a future
    // atlas bump that introduces a second collision fails here rather
    // than quietly dropping a country from the picker.
    expect(listPickableCountries()).toHaveLength(240);
  });

  it("still offers the microstates", () => {
    const names = new Set(listPickableCountries().map((c) => c.name));
    for (const n of ["Vatican", "San Marino", "Monaco", "Liechtenstein", "Andorra", "Malta", "Singapore"]) {
      expect(names.has(n), n).toBe(true);
    }
  });
});
