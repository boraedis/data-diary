import { describe, expect, it } from "vitest";
import { coordinateWiseMedian, greatCircleKm, sphericalGeometricMedian, weightedMedian, type LngLat } from "@/lib/viz/geo-centre";

const DC: LngLat = [-77.0369, 38.9072];
const DUBAI: LngLat = [55.2708, 25.2048];

describe("greatCircleKm", () => {
  it("matches the known Washington–Dubai distance", () => {
    // ~11,330 km great-circle
    expect(greatCircleKm(DC, DUBAI)).toBeGreaterThan(11_250);
    expect(greatCircleKm(DC, DUBAI)).toBeLessThan(11_400);
  });

  it("is short across the antimeridian", () => {
    expect(greatCircleKm([179.5, 0], [-179.5, 0])).toBeCloseTo(111.2, 0);
  });

  it("is zero for the same point", () => {
    expect(greatCircleKm(DC, DC)).toBe(0);
  });
});

describe("sphericalGeometricMedian", () => {
  it("returns null for no points", () => {
    expect(sphericalGeometricMedian([])).toBeNull();
    expect(sphericalGeometricMedian([{ position: DC, weight: 0 }])).toBeNull();
  });

  it("returns a lone point unchanged", () => {
    const m = sphericalGeometricMedian([{ position: DC, weight: 3 }])!;
    expect(greatCircleKm(m, DC)).toBeLessThan(0.001);
  });

  it("sits exactly on a majority point instead of between two cities", () => {
    // The bimodal year a plain mean puts in the Atlantic.
    const m = sphericalGeometricMedian([
      { position: DC, weight: 0.58 },
      { position: DUBAI, weight: 0.42 },
    ])!;
    expect(greatCircleKm(m, DC)).toBeLessThan(0.01);
  });

  it("isn't dragged far by a minority of distant days", () => {
    const home: LngLat = [28.9784, 41.0082]; // Istanbul
    const m = sphericalGeometricMedian([
      { position: home, weight: 1 },
      { position: [29.02, 41.04], weight: 1 },
      { position: [28.95, 40.99], weight: 1 },
      { position: [-74.006, 40.7128], weight: 1 }, // one trip to NYC
    ])!;
    expect(greatCircleKm(m, home)).toBeLessThan(10);
  });

  it("finds the Fermat point of an equal-weight triangle", () => {
    // Symmetric small triangle around (0, 0): the median is its centre.
    const m = sphericalGeometricMedian([
      { position: [0, 1], weight: 1 },
      { position: [-0.866, -0.5], weight: 1 },
      { position: [0.866, -0.5], weight: 1 },
    ])!;
    expect(greatCircleKm(m, [0, 0])).toBeLessThan(0.5);
  });

  it("stays on the date line rather than jumping to Greenwich", () => {
    const m = sphericalGeometricMedian([
      { position: [179, 10], weight: 1 },
      { position: [-179, 10], weight: 1 },
      { position: [180, 10.5], weight: 1 },
    ])!;
    expect(Math.abs(m[0])).toBeGreaterThan(179);
  });
});

describe("weightedMedian", () => {
  it("is the usual median with equal weights", () => {
    expect(weightedMedian([3, 1, 2].map((value) => ({ value, weight: 1 })))).toBe(2);
    expect(weightedMedian([4, 1, 3, 2].map((value) => ({ value, weight: 1 })))).toBe(2.5);
  });
  it("lands on a value holding more than half the weight", () => {
    expect(weightedMedian([{ value: 10, weight: 6 }, { value: 0, weight: 5 }])).toBe(10);
  });
  it("is null with nothing weighted", () => {
    expect(weightedMedian([{ value: 1, weight: 0 }])).toBeNull();
  });
});

describe("coordinateWiseMedian (#512)", () => {
  it("sits exactly on a place holding a majority of the weight", () => {
    const median = coordinateWiseMedian([
      { position: DC, weight: 6 },
      { position: DUBAI, weight: 5 },
    ])!;
    expect(greatCircleKm(median, DC)).toBeLessThan(0.001);
  });

  it("takes latitude and longitude separately, so it can land where no point was", () => {
    // Three points: the median lat comes from one, the median lng from another.
    const median = coordinateWiseMedian([
      { position: [0, 0], weight: 1 },
      { position: [10, 20], weight: 1 },
      { position: [20, 10], weight: 1 },
    ])!;
    expect(median[0]).toBeCloseTo(10, 6);
    expect(median[1]).toBeCloseTo(10, 6);
  });

  it("doesn't break across the antimeridian", () => {
    // Fiji-ish and Samoa-ish, either side of ±180°: the median belongs near
    // the date line, not near 0° on the far side of the planet.
    const median = coordinateWiseMedian([
      { position: [178, -18], weight: 1 },
      { position: [179, -17], weight: 1 },
      { position: [-172, -14], weight: 1 },
    ])!;
    expect(Math.abs(median[0])).toBeGreaterThan(170);
    expect(median[0]).toBeCloseTo(179, 6);
    expect(median[1]).toBeCloseTo(-17, 6);
  });

  it("is null for no points", () => {
    expect(coordinateWiseMedian([])).toBeNull();
  });
});
