import { describe, expect, it } from "vitest";
import {
  buildLocationCentreData,
  indexDaily,
  mergeNearbyLabels,
  rollingTrail,
  windowMix,
  type CentreDay,
  type CentreMetro,
  type CentrePlace,
  type DailyVector,
} from "@/lib/location-centre";
import { addDays } from "@/lib/date";
import { fromUnitVector, greatCircleKm, toUnitVector } from "@/lib/viz/geo-centre";

// A small catalog: USA > DC (metro 1) > two spots; UAE > Dubai (metro 2);
// Turkey (geocoded, i.e. a country centroid) > Bursa (no metro, no coords)
// > a cafe with coords; and an Izmir place in no metro.
function place(p: Partial<CentrePlace> & Pick<CentrePlace, "id" | "name" | "idPath">): CentrePlace {
  return { category: null, subcategory: null, metroId: null, lat: null, lng: null, ...p };
}

const CATALOG: CentrePlace[] = [
  place({ id: 1, name: "USA", idPath: "1/", category: "Region", subcategory: "Country", lat: 39.8, lng: -98.6 }),
  place({ id: 2, name: "Washington", idPath: "1/2/", category: "Region", subcategory: "Municipality", metroId: 1 }),
  place({ id: 3, name: "Office", idPath: "1/2/3/", lat: 38.9, lng: -77.03 }),
  place({ id: 4, name: "Home", idPath: "1/2/4/", lat: 38.92, lng: -77.05 }),
  place({ id: 10, name: "UAE", idPath: "10/", category: "Region", subcategory: "Country" }),
  place({ id: 11, name: "Dubai", idPath: "10/11/", category: "Region", subcategory: "Municipality", metroId: 2, lat: 25.2, lng: 55.27 }),
  place({ id: 20, name: "Turkey", idPath: "20/", category: "Region", subcategory: "Country", lat: 39, lng: 35 }),
  place({ id: 21, name: "Bursa", idPath: "20/21/", category: "Region", subcategory: "Municipality" }),
  place({ id: 22, name: "Cafe", idPath: "20/21/22/", lat: 40.19, lng: 29.06 }),
  place({ id: 23, name: "Market", idPath: "20/21/23/", lat: 40.21, lng: 29.1 }),
  place({ id: 30, name: "Izmir", idPath: "20/30/", category: "Region", subcategory: "Municipality", lat: 38.42, lng: 27.14 }),
];
const METROS: CentreMetro[] = [
  { id: 1, name: "Washington DC", country: "USA" },
  { id: 2, name: "Dubai", country: "UAE" },
];

/** `n` consecutive days from `start` (YYYY-MM-DD, day <= 28 - n), each
 * logging the same pair of places. */
function daysAt(month: string, n: number, place1Id: number | null, place2Id: number | null = null): CentreDay[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, "0")}`,
    place1Id,
    place2Id,
  }));
}

const year = (data: ReturnType<typeof buildLocationCentreData>, y: string) => data.years.find((p) => p.period === y)!;

describe("buildLocationCentreData", () => {
  it("gives each day one vote, shared between its located places", () => {
    const data = buildLocationCentreData(
      [...daysAt("2020-01", 1, 3, 11), ...daysAt("2020-02", 1, 4, 4)],
      CATALOG,
      METROS,
    );
    const dc = data.all.bases.find((b) => b.label === "Washington DC")!;
    const dubai = data.all.bases.find((b) => b.label === "Dubai")!;
    // Day 1: ½ DC + ½ Dubai. Day 2: the same place twice is one whole vote.
    expect(dc.days).toBeCloseTo(1.5);
    expect(dubai.days).toBeCloseTo(0.5);
    expect(data.all.locatedDays).toBe(2);
  });

  it("never locates a day by a country's centroid", () => {
    const data = buildLocationCentreData(daysAt("2020-01", 3, 20), CATALOG, METROS);
    expect(data.all.placedDays).toBe(3);
    expect(data.all.locatedDays).toBe(0);
  });

  it("hands the whole vote to the one place that can be located", () => {
    const data = buildLocationCentreData(daysAt("2020-01", 1, 20, 11), CATALOG, METROS);
    expect(data.all.bases).toHaveLength(1);
    expect(data.all.bases[0].days).toBeCloseTo(1);
  });

  it("groups places by an ancestor's metro, else by their municipality", () => {
    const data = buildLocationCentreData(
      [...daysAt("2020-01", 2, 3), ...daysAt("2020-02", 2, 4), ...daysAt("2020-03", 3, 22), ...daysAt("2020-04", 1, 23), ...daysAt("2020-05", 1, 30)],
      CATALOG,
      METROS,
    );
    const labels = data.all.bases.map((b) => b.label).sort();
    // Office + Home -> their metro; Cafe + Market -> their municipality,
    // Bursa; Izmir is itself a municipality.
    expect(labels).toEqual(["Bursa", "Izmir", "Washington DC"]);
    expect(data.all.bases.find((b) => b.label === "Bursa")!.days).toBeCloseTo(4);
  });

  it("lists every year between the first and last located day, with each year's own coverage", () => {
    const data = buildLocationCentreData([...daysAt("2018-01", 5, 4), ...daysAt("2020-01", 3, 20), ...daysAt("2020-02", 2, 4)], CATALOG, METROS);
    expect(data.years.map((y) => y.period)).toEqual(["2018", "2019", "2020"]);
    expect(year(data, "2019").placedDays).toBe(0);
    expect(year(data, "2020").placedDays).toBe(5);
    expect(year(data, "2020").locatedDays).toBe(2);
  });

  it("sends one unit-length vector per located day, pointing at where it was", () => {
    const data = buildLocationCentreData([...daysAt("2020-01", 2, 4), ...daysAt("2020-02", 1, 4, 11)], CATALOG, METROS);
    expect(data.daily.map((d) => d[0])).toEqual(["2020-01-01", "2020-01-02", "2020-02-01"]);
    const [, x, y, z] = data.daily[0];
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
    expect(greatCircleKm(fromUnitVector([x, y, z])!, [-77.05, 38.92])).toBeLessThan(0.1);
    // A split day is the sum of two half-votes, so it's shorter than 1.
    const [, sx, sy, sz] = data.daily[2];
    expect(Math.hypot(sx, sy, sz)).toBeLessThan(0.9);
  });
});

const HOME: [number, number] = [-77.05, 38.92];
const AWAY: [number, number] = [55.27, 25.2];
function vec(date: string, at: [number, number]): DailyVector {
  const [x, y, z] = toUnitVector(at);
  return [date, x, y, z];
}
/** `n` consecutive days from `start` at one position. */
function stay(start: string, n: number, at: [number, number]): DailyVector[] {
  return Array.from({ length: n }, (_, i) => vec(addDays(start, i), at));
}

describe("rollingTrail", () => {
  it("stays put while every day is in one place", () => {
    const runs = rollingTrail(indexDaily(stay("2020-01-01", 60, HOME)), 30, 2);
    expect(runs).toHaveLength(1);
    for (const p of runs[0]) expect(greatCircleKm(p.position, HOME)).toBeLessThan(0.01);
  });

  it("is pulled part of the way out by a trip, peaking at the trip, and comes back", () => {
    const daily = [...stay("2020-01-01", 45, HOME), ...stay("2020-02-15", 10, AWAY), ...stay("2020-02-25", 45, HOME)];
    const [run] = rollingTrail(indexDaily(daily), 30, 1);
    const distance = (date: string) => greatCircleKm(run.find((p) => p.date === date)!.position, HOME);
    // A third of the window away: well off home, nowhere near Dubai.
    const peak = distance("2020-02-19");
    expect(peak).toBeGreaterThan(1_000);
    expect(greatCircleKm(run.find((p) => p.date === "2020-02-19")!.position, AWAY)).toBeGreaterThan(5_000);
    expect(distance("2020-01-10")).toBeLessThan(0.01);
    expect(distance("2020-04-01")).toBeLessThan(0.01);
    // A longer window dilutes the same trip.
    const [yearRun] = rollingTrail(indexDaily(daily), 90, 1);
    expect(greatCircleKm(yearRun.find((p) => p.date === "2020-02-19")!.position, HOME)).toBeLessThan(peak);
  });

  it("breaks the trail where too few of a window's days are located", () => {
    const daily = [...stay("2020-01-01", 30, HOME), ...stay("2020-04-01", 30, AWAY)];
    const runs = rollingTrail(indexDaily(daily), 7, 1);
    expect(runs).toHaveLength(2);
    expect(greatCircleKm(runs[1][runs[1].length - 1].position, AWAY)).toBeLessThan(0.01);
  });

  it("keeps moving near the start of the record instead of freezing on one window", () => {
    // A move a year in, under a 5-year window: a window slid to stay full
    // would give every point in the first 2½ years the same position.
    const daily = [...stay("2016-01-01", 365, HOME), ...stay("2017-01-01", 2000, AWAY)];
    const [run] = rollingTrail(indexDaily(daily), 1826, 42);
    const first = run[0].position;
    const later = run.find((p) => p.date >= "2017-06-01")!.position;
    expect(greatCircleKm(first, later)).toBeGreaterThan(500);
  });

  it("returns nothing for no days", () => {
    expect(rollingTrail(indexDaily([]), 30, 2)).toEqual([]);
  });
});

describe("windowMix", () => {
  it("names the area with the most of a window's days, and its share", () => {
    const data = buildLocationCentreData(
      [...daysAt("2020-01", 20, 4), ...daysAt("2020-02", 10, 11), ...daysAt("2020-03", 10, 4, 11)],
      CATALOG,
      METROS,
    );
    const index = indexDaily(data.daily);
    // A window wide enough to hold every day: DC 20 + 5, Dubai 10 + 5.
    const mix = windowMix(index, "2020-02-05", 400);
    expect(mix.map((m) => data.areas[m.area].label)).toEqual(["Washington DC", "Dubai"]);
    expect(mix[0].share).toBeCloseTo(25 / 40);
    expect(mix[1].share).toBeCloseTo(15 / 40);
    // A narrow window around the Dubai stretch.
    const feb = windowMix(index, "2020-02-05", 7);
    expect(feb).toHaveLength(1);
    expect(data.areas[feb[0].area].label).toBe("Dubai");
    expect(feb[0].share).toBeCloseTo(1);
  });

  it("returns nothing for an empty window", () => {
    expect(windowMix(indexDaily([]), "2020-01-01", 30)).toEqual([]);
  });
});

describe("mergeNearbyLabels", () => {
  it("gives nearby points one label, joining adjacent ones into ranges", () => {
    const pts = [
      { label: "2016", position: HOME },
      { label: "2017", position: [-77.06, 38.93] as [number, number] },
      { label: "2018", position: [-77.05, 38.92] as [number, number] },
      { label: "2019", position: AWAY },
      { label: "2020", position: HOME },
    ];
    const groups = mergeNearbyLabels(pts, 25);
    expect(groups.map((g) => g.label)).toEqual(["2016–2018, 2020", "2019"]);
    expect(groups[0].members).toHaveLength(4);
  });
});
