import { describe, expect, it } from "vitest";
import { normalizeCountryName } from "@/lib/geo/country-names";

describe("normalizeCountryName", () => {
  it("maps a known alias to world-atlas's spelling", () => {
    expect(normalizeCountryName("USA")).toBe("United States of America");
    expect(normalizeCountryName("uk")).toBe("United Kingdom");
  });

  it("is case- and whitespace-insensitive on the lookup", () => {
    expect(normalizeCountryName("  Usa  ")).toBe("United States of America");
    expect(normalizeCountryName("United States")).toBe("United States of America");
  });

  it("maps every UK constituent-country alias to the same name", () => {
    for (const alias of ["england", "scotland", "wales", "northern ireland"]) {
      expect(normalizeCountryName(alias)).toBe("United Kingdom");
    }
  });

  it("passes an already-matching name through unchanged", () => {
    expect(normalizeCountryName("France")).toBe("France");
    expect(normalizeCountryName("Japan")).toBe("Japan");
  });

  it("passes an unrecognized name through unchanged rather than dropping it", () => {
    expect(normalizeCountryName("Wakanda")).toBe("Wakanda");
  });
});
