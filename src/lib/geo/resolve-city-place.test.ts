import { describe, expect, it } from "vitest";
import { resolveCityFeatureName } from "./resolve-city-place";

const roots = [{ root: "Istanbul", rootId: 7, sourceFile: "istanbul.geojson" }];
const identity = (_root: string, name: string) => name;
const names = new Map([
  ["Istanbul", new Set(["Cihangir", "Cumhuriyet (Beşiktaş)", "Cumhuriyet (Kadıköy)", "Fatih"])],
]);
const place = (path: string[]) => ({ idPath: `1/7/${path.map((_, i) => 100 + i).join("/")}/`, namePath: `Turkey/Istanbul/${path.join("/")}/` });

describe("resolveCityFeatureName with qualified names", () => {
  it("resolves a repeated name by the segment above it", () => {
    expect(resolveCityFeatureName(place(["Beşiktaş", "Cumhuriyet", "Cafe"]), roots, names, identity)).toEqual({
      root: "Istanbul",
      featureName: "Cumhuriyet (Beşiktaş)",
    });
    expect(resolveCityFeatureName(place(["Kadıköy", "Cumhuriyet", "Cafe"]), roots, names, identity)).toEqual({
      root: "Istanbul",
      featureName: "Cumhuriyet (Kadıköy)",
    });
  });

  it("does not guess when the parent segment names no namesake", () => {
    expect(resolveCityFeatureName(place(["Üsküdar", "Cumhuriyet", "Cafe"]), roots, names, identity)).toBeNull();
  });

  it("applies normalize to the parent segment too", () => {
    const fold = (_root: string, name: string) => (name === "Besiktas" ? "Beşiktaş" : name);
    expect(resolveCityFeatureName(place(["Besiktas", "Cumhuriyet", "Cafe"]), roots, names, fold)).toEqual({
      root: "Istanbul",
      featureName: "Cumhuriyet (Beşiktaş)",
    });
  });

  it("still resolves an unqualified name directly", () => {
    expect(resolveCityFeatureName(place(["Beyoğlu", "Cihangir", "Cafe"]), roots, names, identity)).toEqual({
      root: "Istanbul",
      featureName: "Cihangir",
    });
  });
});
