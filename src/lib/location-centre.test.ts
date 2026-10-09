import { describe, expect, it } from "vitest";
import {
  buildLocationCentreData,
  indexDaily,
  mergeNearbyLabels,
  rangeSummary,
  rankAreas,
  rollingTrail,
  smoothTrail,
  windowDetail,
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

const year = (data: ReturnType<typeof buildLocationCentreData>, y: string) => data.years.find((p) => p.year === Number(y))!;
/** The whole record's summary — what the chart shows with no range picked. */
const all = (data: ReturnType<typeof buildLocationCentreData>) => rangeSummary(data, 0, 9999);

describe("buildLocationCentreData", () => {
  it("gives each day one vote, shared between its located places", () => {
    const data = buildLocationCentreData(
      [...daysAt("2020-01", 1, 3, 11), ...daysAt("2020-02", 1, 4, 4)],
      CATALOG,
      METROS,
    );
    const dc = all(data).bases.find((b) => b.label === "Washington DC")!;
    const dubai = all(data).bases.find((b) => b.label === "Dubai")!;
    // Day 1: ½ DC + ½ Dubai. Day 2: the same place twice is one whole vote.
    expect(dc.days).toBeCloseTo(1.5);
    expect(dubai.days).toBeCloseTo(0.5);
    expect(all(data).locatedDays).toBe(2);
  });

  it("never locates a day by a country's centroid", () => {
    const data = buildLocationCentreData(daysAt("2020-01", 3, 20), CATALOG, METROS);
    expect(all(data).placedDays).toBe(3);
    expect(all(data).locatedDays).toBe(0);
  });

  it("hands the whole vote to the one place that can be located", () => {
    const data = buildLocationCentreData(daysAt("2020-01", 1, 20, 11), CATALOG, METROS);
    expect(all(data).bases).toHaveLength(1);
    expect(all(data).bases[0].days).toBeCloseTo(1);
  });

  it("groups places by an ancestor's metro, else by their municipality", () => {
    const data = buildLocationCentreData(
      [...daysAt("2020-01", 2, 3), ...daysAt("2020-02", 2, 4), ...daysAt("2020-03", 3, 22), ...daysAt("2020-04", 1, 23), ...daysAt("2020-05", 1, 30)],
      CATALOG,
      METROS,
    );
    const labels = all(data).bases.map((b) => b.label).sort();
    // Office + Home -> their metro; Cafe + Market -> their municipality,
    // Bursa; Izmir is itself a municipality.
    expect(labels).toEqual(["Bursa", "Izmir", "Washington DC"]);
    expect(all(data).bases.find((b) => b.label === "Bursa")!.days).toBeCloseTo(4);
  });

  it("lists every year between the first and last located day, with each year's own coverage", () => {
    const data = buildLocationCentreData([...daysAt("2018-01", 5, 4), ...daysAt("2020-01", 3, 20), ...daysAt("2020-02", 2, 4)], CATALOG, METROS);
    expect(data.years.map((y) => y.year)).toEqual([2018, 2019, 2020]);
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

  it("is pulled part of the way out by a trip, peaking as it ends, and comes back", () => {
    const daily = [...stay("2020-01-01", 45, HOME), ...stay("2020-02-15", 10, AWAY), ...stay("2020-02-25", 45, HOME)];
    const [run] = rollingTrail(indexDaily(daily), 30, 1);
    const at = (date: string) => run.find((p) => p.date === date)!.position;
    const distance = (date: string) => greatCircleKm(at(date), HOME);
    // Looking back, the pull is strongest on the trip's last day, with a
    // third of the window away: well off home, nowhere near Dubai.
    const peak = distance("2020-02-24");
    expect(peak).toBeGreaterThan(distance("2020-02-18"));
    expect(peak).toBeGreaterThan(distance("2020-03-05"));
    expect(peak).toBeGreaterThan(1_000);
    expect(greatCircleKm(at("2020-02-24"), AWAY)).toBeGreaterThan(5_000);
    // Nothing before the trip moves: a window never looks forward.
    expect(distance("2020-02-14")).toBeLessThan(0.01);
    expect(distance("2020-04-01")).toBeLessThan(0.01);
    // A longer window dilutes the same trip.
    const [longRun] = rollingTrail(indexDaily(daily), 90, 1);
    expect(greatCircleKm(longRun.find((p) => p.date === "2020-02-24")!.position, HOME)).toBeLessThan(peak);
  });

  it("always ends on the last logged day, whatever the step", () => {
    const runs = rollingTrail(indexDaily(stay("2020-01-01", 100, HOME)), 30, 42);
    const last = runs[runs.length - 1];
    expect(last[last.length - 1].date).toBe(addDays("2020-01-01", 99));
  });

  it("breaks the trail where too few of a window's days are located", () => {
    const daily = [...stay("2020-01-01", 30, HOME), ...stay("2020-04-01", 30, AWAY)];
    const runs = rollingTrail(indexDaily(daily), 7, 1);
    expect(runs).toHaveLength(2);
    expect(greatCircleKm(runs[1][runs[1].length - 1].position, AWAY)).toBeLessThan(0.01);
  });

  it("keeps moving near the start of the record instead of freezing on one window", () => {
    // A move a year in, under a 5-year window: the first points' windows
    // are cut short rather than all being the same first five years.
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
    // A window ending after every day: DC 20 + 5, Dubai 10 + 5.
    const mix = windowMix(index, "2020-03-31", 400);
    expect(mix.map((m) => data.areas[m.area].label)).toEqual(["Washington DC", "Dubai"]);
    expect(mix[0].share).toBeCloseTo(25 / 40);
    expect(mix[1].share).toBeCloseTo(15 / 40);
    // A week ending in the Dubai stretch (Jan 30–Feb 5; January's logging
    // stopped on the 20th).
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

describe("windowDetail", () => {
  // DC all of January; Dubai (first ever visit) Feb 1–10; Bursa and DC
  // split Mar 1–10.
  const data = buildLocationCentreData(
    [...daysAt("2020-01", 25, 4), ...daysAt("2020-02", 10, 11), ...daysAt("2020-03", 10, 22, 4)],
    CATALOG,
    METROS,
  );
  const index = indexDaily(data.daily);
  const label = (area: number) => data.areas[area].label;

  it("covers the days up to and including the point, and counts the located ones", () => {
    const d = windowDetail(index, data.areas, "2020-02-05", 30)!;
    expect(d.from).toBe("2020-01-07");
    expect(d.to).toBe("2020-02-05");
    expect(d.spanDays).toBe(30);
    // Jan 7–25 and Feb 1–5 are logged; Jan 26–31 isn't.
    expect(d.locatedDays).toBe(24);
    expect(d.areas.map((a) => label(a.area))).toEqual(["Washington DC", "Dubai"]);
    expect(d.areas[0].days).toBeCloseTo(19);
  });

  it("is cut short, never extended forward, in the record's first window", () => {
    const d = windowDetail(index, data.areas, "2020-01-10", 30)!;
    expect(d.from).toBe("2020-01-01");
    expect(d.to).toBe("2020-01-10");
    expect(d.spanDays).toBe(10);
  });

  it("rolls areas up by country", () => {
    const d = windowDetail(index, data.areas, "2020-03-05", 10)!;
    // Mar 1–10 split DC/Bursa: half USA, half Turkey.
    expect(d.countries.map((c) => c.name).sort()).toEqual(["Turkey", "USA"]);
    expect(d.countries[0].share).toBeCloseTo(0.5);
  });

  it("lists only areas first visited inside the window, in order", () => {
    // Jan 11 – Mar 10.
    const wide = windowDetail(index, data.areas, "2020-03-10", 60)!;
    expect(wide.firstVisits.map((v) => [label(v.area), v.date])).toEqual([
      ["Dubai", "2020-02-01"],
      ["Bursa", "2020-03-01"],
    ]);
    // DC was first visited in January, before this window opens.
    expect(wide.firstVisits.some((v) => label(v.area) === "Washington DC")).toBe(false);
  });

  it("returns null for a window with nothing located", () => {
    expect(windowDetail(index, data.areas, "2020-01-30", 3)).toBeNull();
    expect(windowDetail(indexDaily([]), [], "2020-01-01", 30)).toBeNull();
  });
});

describe("rangeSummary", () => {
  const data = buildLocationCentreData(
    [...daysAt("2019-01", 20, 4), ...daysAt("2020-01", 10, 11), ...daysAt("2021-01", 10, 4), ...daysAt("2021-02", 2, 20)],
    CATALOG,
    METROS,
  );

  it("sums coverage and area days over the picked years only", () => {
    const r = rangeSummary(data, 2020, 2021);
    expect(r.placedDays).toBe(22);
    expect(r.locatedDays).toBe(20);
    // A tie on days breaks by all-time rank: DC has more days overall.
    expect(r.bases.map((b) => [b.label, b.days])).toEqual([
      ["Washington DC", 10],
      ["Dubai", 10],
    ]);
    expect(r.bases[0].share).toBeCloseTo(0.5);
  });

  it("keeps each area's all-time position and rank, whatever the range", () => {
    const dcAll = rangeSummary(data, 2019, 2021).bases.find((b) => b.label === "Washington DC")!;
    const dcLate = rangeSummary(data, 2021, 2021).bases.find((b) => b.label === "Washington DC")!;
    expect(dcLate.position).toEqual(dcAll.position);
    expect(dcAll.rank).toBe(0);
    expect(dcLate.rank).toBe(0);
  });
});

describe("rankAreas", () => {
  const days = [...daysAt("2020-01", 20, 4), ...daysAt("2020-02", 25, 11), ...daysAt("2020-03", 5, 22)];

  it("ranks areas by located days, most first", () => {
    expect(rankAreas(days, CATALOG, METROS).map((a) => [a.label, a.rank])).toEqual([
      ["Dubai", 0],
      ["Washington DC", 1],
      ["Bursa", 2],
    ]);
  });

  it("agrees with the Centre of Gravity chart's own ranks", () => {
    const data = buildLocationCentreData(days, CATALOG, METROS);
    for (const area of rankAreas(days, CATALOG, METROS)) {
      expect(data.areas.find((a) => a.key === area.key)!.rank).toBe(area.rank);
    }
  });
});

// #609: the second-level averager over the trail.
describe("smoothTrail", () => {
  const point = (date: string, position: [number, number]) => ({ date, position, days: 30 });
  /** One trail point every 14 days from `start`. */
  const run = (start: string, positions: [number, number][]) => positions.map((p, i) => point(addDays(start, i * 14), p));

  it("is a no-op with no smoothing", () => {
    const runs = [run("2020-01-01", [HOME, AWAY, HOME])];
    expect(smoothTrail(runs, 0)).toBe(runs);
  });

  it("leaves a trail that never moves where it is", () => {
    const [smoothed] = smoothTrail([run("2020-01-01", Array(10).fill(HOME))], 60);
    for (const p of smoothed) expect(greatCircleKm(p.position, HOME)).toBeLessThan(0.01);
  });

  it("pulls a one-point spike most of the way back, without reaching the dot", () => {
    const positions: [number, number][] = Array(11).fill(HOME);
    positions[5] = AWAY;
    const [smoothed] = smoothTrail([run("2020-01-01", positions)], 30);
    const spike = smoothed[5].position;
    // Near the spike rather than through it: off home, but well short of Dubai.
    expect(greatCircleKm(spike, HOME)).toBeGreaterThan(100);
    expect(greatCircleKm(spike, AWAY)).toBeGreaterThan(greatCircleKm(spike, HOME));
    // Neighbours bend towards it a little, so the line is a curve, not a corner.
    expect(greatCircleKm(smoothed[4].position, HOME)).toBeGreaterThan(1);
    // Keeps dates and day counts, so colours and alignment with the dots hold.
    expect(smoothed.map((p) => p.date)).toEqual(run("2020-01-01", positions).map((p) => p.date));
  });

  it("never smooths across a gap between runs", () => {
    const [home, away] = smoothTrail([run("2020-01-01", Array(5).fill(HOME)), run("2020-06-01", Array(5).fill(AWAY))], 365);
    for (const p of home) expect(greatCircleKm(p.position, HOME)).toBeLessThan(0.01);
    for (const p of away) expect(greatCircleKm(p.position, AWAY)).toBeLessThan(0.01);
  });

  it("averages on the globe, so it stays put across the date line", () => {
    const [smoothed] = smoothTrail([run("2020-01-01", [[179.5, -17], [-179.5, -17], [179.5, -17], [-179.5, -17]])], 30);
    for (const p of smoothed) expect(Math.abs(p.position[0])).toBeGreaterThan(179);
  });
});
