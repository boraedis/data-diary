import { describe, expect, it } from "vitest";
import {
  KNOWN_POSTAL_CODES,
  countyNameKey,
  parseLegacyCountyKey,
  resolveCountyByName,
} from "./us-county-lookup";
import { US_STATE_FIPS_BY_NAME } from "./us-state-names";

// #363's name -> FIPS resolution, tested against real us-atlas geometry
// rather than fixtures — the whole risk here is the gap between what a
// hand-written list says and what us-atlas actually calls a county, so a
// fixture that agreed with the code would prove nothing.
//
// The legacy travel list itself isn't in this repo (see #363), so these
// cover the *shapes* of name that list is known to contain: abbreviated
// saints, apostrophes, parishes and boroughs, independent cities.

describe("countyNameKey", () => {
  it("agrees across saint spellings", () => {
    expect(countyNameKey("St. Louis")).toBe(countyNameKey("Saint Louis"));
    expect(countyNameKey("Ste. Genevieve")).toBe(countyNameKey("Sainte Genevieve"));
    // The one that would otherwise collide: Ste. must not reduce to St.
    expect(countyNameKey("Ste. Genevieve")).not.toBe(countyNameKey("St. Genevieve"));
  });

  it("ignores apostrophes and case", () => {
    expect(countyNameKey("Prince George's")).toBe(countyNameKey("Prince Georges"));
    expect(countyNameKey("O'Brien")).toBe(countyNameKey("obrien"));
  });

  it("strips a trailing type suffix, whichever kind", () => {
    expect(countyNameKey("Fulton County")).toBe(countyNameKey("Fulton"));
    expect(countyNameKey("Orleans Parish")).toBe(countyNameKey("Orleans"));
    expect(countyNameKey("Nome Census Area")).toBe(countyNameKey("Nome"));
    expect(countyNameKey("Juneau City and Borough")).toBe(countyNameKey("Juneau"));
  });

  it("does not strip 'city', which distinguishes a real place", () => {
    // Virginia's independent cities are their own FIPS codes, not spelling
    // variants of the county beside them — collapsing these would merge
    // two different places.
    expect(countyNameKey("Richmond city")).not.toBe(countyNameKey("Richmond"));
  });

  it("leaves a name that needs no normalizing alone", () => {
    expect(countyNameKey("Fulton")).toBe("fulton");
  });
});

describe("resolveCountyByName", () => {
  it("resolves an ordinary county", () => {
    expect(resolveCountyByName("Fulton", "GA")).toEqual({ kind: "match", fips: "13121", name: "Fulton" });
  });

  it("resolves the same county written with its suffix", () => {
    expect(resolveCountyByName("Fulton County", "GA")).toMatchObject({ kind: "match", fips: "13121" });
  });

  it("scopes to the named state, so a repeated county name is unambiguous", () => {
    // Lake County exists in a dozen states — the postal code is what makes
    // the key resolvable at all.
    const indiana = resolveCountyByName("Lake", "IN");
    const florida = resolveCountyByName("Lake", "FL");
    expect(indiana.kind).toBe("match");
    expect(florida.kind).toBe("match");
    expect(indiana).not.toEqual(florida);
  });

  it("resolves a Louisiana parish and an Alaska borough", () => {
    expect(resolveCountyByName("Orleans Parish", "LA").kind).toBe("match");
    expect(resolveCountyByName("Juneau", "AK").kind).toBe("match");
  });

  it("resolves an abbreviated saint against us-atlas's own spelling", () => {
    expect(resolveCountyByName("Saint Charles", "MO")).toMatchObject({ kind: "match", fips: "29183" });
  });

  it("reports the independent-city collisions instead of guessing", () => {
    // The six names us-atlas genuinely can't disambiguate from a
    // "Name__ST" key — an independent city sharing a bare name with its
    // surrounding county. Guessing would attach travel to the wrong
    // polygon, silently.
    for (const [name, postal] of [
      ["Richmond", "VA"],
      ["Franklin", "VA"],
      ["Roanoke", "VA"],
      ["Fairfax", "VA"],
      ["Baltimore", "MD"],
      ["St. Louis", "MO"],
    ] as const) {
      const result = resolveCountyByName(name, postal);
      expect(result.kind, `${name}__${postal}`).toBe("ambiguous");
      if (result.kind !== "ambiguous") throw new Error("unreachable");
      expect(result.candidates).toHaveLength(2);
      // Both candidates come back so a report can name the real choice.
      expect(new Set(result.candidates.map((c) => c.fips)).size).toBe(2);
    }
  });

  it("reports an unmatched county rather than throwing", () => {
    expect(resolveCountyByName("Nowhere", "GA")).toEqual({ kind: "no-county" });
  });

  it("reports a bad postal code distinctly from a bad county name", () => {
    expect(resolveCountyByName("Fulton", "ZZ")).toEqual({ kind: "unknown-state" });
  });

  it("accepts a lowercase postal code", () => {
    expect(resolveCountyByName("Fulton", "ga")).toMatchObject({ kind: "match", fips: "13121" });
  });
});

describe("the postal table", () => {
  it("covers every state us-atlas ships, and names them its way", () => {
    // The table maps to us-atlas's own feature names rather than hardcoded
    // FIPS numbers precisely so a typo fails here instead of silently
    // resolving to another state — this is that check.
    expect(KNOWN_POSTAL_CODES.size).toBe(56);
    for (const postal of KNOWN_POSTAL_CODES) {
      const result = resolveCountyByName("__definitely-not-a-county__", postal);
      expect(result.kind, postal).not.toBe("unknown-state");
    }
  });

  it("agrees with us-atlas on the count of state-level features", () => {
    expect(US_STATE_FIPS_BY_NAME.size).toBe(KNOWN_POSTAL_CODES.size);
  });
});

describe("parseLegacyCountyKey", () => {
  it("splits a well-formed key", () => {
    expect(parseLegacyCountyKey("Fulton__GA")).toEqual({ countyName: "Fulton", postalCode: "GA" });
  });

  it("handles a county name containing a space", () => {
    expect(parseLegacyCountyKey("Prince George's__MD")).toEqual({
      countyName: "Prince George's",
      postalCode: "MD",
    });
  });

  it("rejects a malformed key rather than half-parsing it", () => {
    // Distinguishable from "resolved to nothing" in a seed report, which
    // is the point — a bad key is a different problem from a bad name.
    expect(parseLegacyCountyKey("Fulton")).toBeNull();
    expect(parseLegacyCountyKey("Fulton__GA__extra")).toBeNull();
    expect(parseLegacyCountyKey("__GA")).toBeNull();
    expect(parseLegacyCountyKey("Fulton__")).toBeNull();
  });
});
