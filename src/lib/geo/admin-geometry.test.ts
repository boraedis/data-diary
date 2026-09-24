import { describe, expect, it } from "vitest";
import { ADMIN_GEOMETRY_LOADERS, loadAdminRegionFeatures } from "@/lib/geo/admin-geometry";
import { ADMIN_REGIONS } from "@/lib/geo/admin-regions";
import { listCountryFeatures } from "@/lib/geo/country-lookup";

describe("admin geometry", () => {
  it("has a loader for exactly the countries ADMIN_REGIONS lists", () => {
    // The loader table is written out by hand so the bundler can split
    // each file (see admin-geometry.ts); this is what stops the two lists
    // drifting apart.
    const configured = Object.values(ADMIN_REGIONS).map((c) => c.iso3).sort();
    expect(Object.keys(ADMIN_GEOMETRY_LOADERS).sort()).toEqual(configured);
  });

  it("keys every entry by a real world-atlas country id", () => {
    const ids = new Set(listCountryFeatures().map((c) => c.code));
    for (const id of Object.keys(ADMIN_REGIONS)) expect(ids, id).toContain(id);
  });

  it.each(Object.entries(ADMIN_REGIONS))("loads %s with named, uniquely keyed subdivisions", async (id) => {
    const features = await loadAdminRegionFeatures(id);
    expect(features).not.toBeNull();
    const names = features!.features.map((f) => f.properties.name);
    expect(names.length).toBeGreaterThan(1);
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns null for a country with no entry, rather than an empty map", () => {
    expect(loadAdminRegionFeatures("484")).toBeNull(); // Mexico
  });
});
