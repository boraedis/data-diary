import { describe, expect, it } from "vitest";
import { loadAdminRegionFeatures } from "@/lib/geo/admin-geometry";
import { resolveAdminRegion } from "@/lib/geo/admin-lookup";

async function regionsOf(worldAtlasId: string) {
  return (await loadAdminRegionFeatures(worldAtlasId))!.features;
}

describe("resolveAdminRegion", () => {
  it("places a point in the subdivision that contains it", async () => {
    // Izmir's Alsancak, and Budapest — the latter specifically because
    // gbOpen's Hungary drew Pest county straight over it (see
    // admin-regions.ts on why Hungary comes from gbHumanitarian).
    expect(resolveAdminRegion(await regionsOf("792"), [[27.1428, 38.4379]])).toBe("İzmir");
    expect(resolveAdminRegion(await regionsOf("348"), [[19.0402, 47.4979]])).toBe("Budapest");
  });

  it("uses the renamed name, not geoBoundaries' own", async () => {
    // Rhodes town, in what EuroGeoGraphics calls "Notioy Aigaioy".
    expect(resolveAdminRegion(await regionsOf("300"), [[28.2176, 36.4341]])).toBe("South Aegean");
  });

  it("falls back to the next point when the first lands nowhere", async () => {
    // First point well out in the Aegean — a coastal place shaved off by
    // simplification looks exactly like this. Its city's point, inland,
    // still resolves.
    const offshore: [number, number] = [26.0, 38.4];
    expect(resolveAdminRegion(await regionsOf("792"), [offshore, [27.1428, 38.4379]])).toBe("İzmir");
  });

  it("prefers the place's own point over its ancestors'", async () => {
    // A Kyoto place filed under an ancestor geocoded to Osaka resolves by
    // its own location — the ancestors are only a fallback.
    const kyoto: [number, number] = [135.7681, 35.0116];
    const osaka: [number, number] = [135.5023, 34.6937];
    expect(resolveAdminRegion(await regionsOf("392"), [kyoto, osaka])).toBe("Kyoto");
  });

  it("returns null when nothing lands, rather than snapping to the nearest", async () => {
    expect(resolveAdminRegion(await regionsOf("792"), [[26.0, 38.4]])).toBeNull();
    expect(resolveAdminRegion(await regionsOf("792"), [])).toBeNull();
  });
});
