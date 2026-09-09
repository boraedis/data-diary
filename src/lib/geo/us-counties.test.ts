import { describe, expect, it } from "vitest";
import { resolveCountyForPoint } from "@/lib/geo/us-counties";
import { US_STATE_FIPS_BY_NAME } from "@/lib/geo/us-state-names";

const GEORGIA = US_STATE_FIPS_BY_NAME.get("Georgia")!;
const NEW_YORK = US_STATE_FIPS_BY_NAME.get("New York")!;

describe("resolveCountyForPoint", () => {
  it("places a point in the county that actually contains it", () => {
    // Downtown Atlanta.
    expect(resolveCountyForPoint(33.7537, -84.3863, GEORGIA)).toEqual({ fips: "13121", name: "Fulton" });
    // Midtown Manhattan.
    expect(resolveCountyForPoint(40.7549, -73.984, NEW_YORK)).toEqual({ fips: "36061", name: "New York" });
  });

  it("resolves the same county with no state hint at all", () => {
    // The hint is only an optimization — dropping it must not change the
    // answer, just the number of polygons tested.
    expect(resolveCountyForPoint(33.7537, -84.3863)).toEqual({ fips: "13121", name: "Fulton" });
  });

  it("falls back to a nationwide scan when the hint is wrong", () => {
    // A real pattern in the catalog: 12 places geocode to a county in a
    // different state than their namePath claims. The hint being wrong
    // must not lose the place — that disagreement is a data-entry signal,
    // not a reason to drop its days.
    expect(resolveCountyForPoint(33.7537, -84.3863, NEW_YORK)).toEqual({ fips: "13121", name: "Fulton" });
  });

  it("returns null for a point in no county rather than snapping to the nearest", () => {
    // Well out in the Atlantic. The real cases this guards are subtler
    // (an address geocoded just off a shoreline), but the rule is the
    // same: an honest gap beats a confidently wrong county.
    expect(resolveCountyForPoint(38.0, -60.0)).toBeNull();
  });

  it("handles a county-equivalent that isn't a county", () => {
    // Virginia's independent cities are their own FIPS entries, which is
    // why UsCounty.name is left bare rather than having "County" appended.
    const richmond = resolveCountyForPoint(37.5407, -77.436);
    expect(richmond?.fips).toBe("51760");
    expect(richmond?.name).toBe("Richmond");
  });
});
