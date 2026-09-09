import { describe, expect, it } from "vitest";
import { normalizeUsStateName, resolveUsStateName, US_STATE_FEATURE_NAMES } from "@/lib/geo/us-state-names";

describe("US_STATE_FEATURE_NAMES", () => {
  it("covers the 50 states, DC, and us-atlas's 5 territories", () => {
    expect(US_STATE_FEATURE_NAMES.size).toBe(56);
    expect(US_STATE_FEATURE_NAMES.has("Georgia")).toBe(true);
    expect(US_STATE_FEATURE_NAMES.has("District of Columbia")).toBe(true);
    expect(US_STATE_FEATURE_NAMES.has("United States Virgin Islands")).toBe(true);
  });
});

describe("normalizeUsStateName", () => {
  it("maps the catalog's own territory spelling to us-atlas's", () => {
    expect(normalizeUsStateName("Virgin Islands")).toBe("United States Virgin Islands");
  });

  it("maps every DC spelling onto District of Columbia", () => {
    for (const alias of ["DC", "Washington DC", "Washington, D.C.", "d.c."]) {
      expect(normalizeUsStateName(alias)).toBe("District of Columbia");
    }
  });

  it("is case- and whitespace-insensitive on the lookup", () => {
    expect(normalizeUsStateName("  virgin islands  ")).toBe("United States Virgin Islands");
  });

  it("passes an already-matching name through unchanged", () => {
    expect(normalizeUsStateName("Georgia")).toBe("Georgia");
    expect(normalizeUsStateName("New Hampshire")).toBe("New Hampshire");
  });
});

describe("resolveUsStateName", () => {
  it("resolves a state wherever it sits in the path, not at a fixed depth", () => {
    expect(resolveUsStateName("USA/Georgia/Atlanta/Midtown/")).toBe("Georgia");
    expect(resolveUsStateName("USA/Georgia/")).toBe("Georgia");
    expect(resolveUsStateName("USA/New York/New York City/Manhattan/SoHo/Balthazar/")).toBe("New York");
  });

  it("prefers the shallowest match, so a city can't shadow the state it's in", () => {
    // Washington-the-city inside DC, and New York City inside New York:
    // both would resolve to the wrong feature if segments were scanned
    // leaf-to-root, or if any single depth were assumed.
    expect(resolveUsStateName("USA/District of Columbia/Washington/Georgetown/")).toBe("District of Columbia");
    expect(resolveUsStateName("USA/New York/New York City/Brooklyn/")).toBe("New York");
  });

  it("resolves a territory us-atlas ships, even though the US map can't draw it", () => {
    expect(resolveUsStateName("USA/Virgin Islands/Saint John/Maho Bay Beach/")).toBe("United States Virgin Islands");
  });

  it("accepts any country-name spelling that normalizes to the US", () => {
    expect(resolveUsStateName("United States/Colorado/Denver/")).toBe("Colorado");
    expect(resolveUsStateName("US/Colorado/Denver/")).toBe("Colorado");
  });

  it("returns null for a place outside the US", () => {
    expect(resolveUsStateName("Turkey/Istanbul/Kadıköy/")).toBeNull();
    // Georgia the country, not Georgia the state — the root check is what
    // keeps these apart, since the leaf walk alone would happily match.
    expect(resolveUsStateName("Georgia/Tbilisi/")).toBeNull();
  });

  it("returns null for a US place under no recognizable state", () => {
    expect(resolveUsStateName("USA/Nowhere County/")).toBeNull();
    expect(resolveUsStateName("USA/")).toBeNull();
  });

  it("returns null for a missing or empty path rather than throwing", () => {
    expect(resolveUsStateName(null)).toBeNull();
    expect(resolveUsStateName(undefined)).toBeNull();
    expect(resolveUsStateName("")).toBeNull();
  });
});
