import { describe, expect, it } from "vitest";
import {
  buildLocationCentreData,
  buildPath,
  formatPeriodRuns,
  type CentreDay,
  type CentreMetro,
  type CentrePlace,
  type CentrePeriod,
} from "@/lib/location-centre";
import { greatCircleKm } from "@/lib/viz/geo-centre";

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
  place({ id: 40, name: "Cape Town", idPath: "40/", lat: -33.92, lng: 18.42 }),
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

  it("groups places by an ancestor's metro, and clusters the rest within 50 km", () => {
    const data = buildLocationCentreData(
      [...daysAt("2020-01", 2, 3), ...daysAt("2020-02", 2, 4), ...daysAt("2020-03", 3, 22), ...daysAt("2020-04", 1, 23), ...daysAt("2020-05", 1, 30)],
      CATALOG,
      METROS,
    );
    const labels = data.all.bases.map((b) => b.label).sort();
    // Office + Home -> one metro; Cafe + Market (~4 km apart) -> one
    // cluster named for their municipality; Izmir (~250 km) its own.
    expect(labels).toEqual(["Bursa", "Izmir", "Washington DC"]);
    expect(data.all.bases.find((b) => b.label === "Bursa")!.days).toBeCloseTo(4);
  });

  it("centres a bimodal year on its majority city, not between the two", () => {
    const data = buildLocationCentreData(
      [
        ...["2021-01", "2021-02", "2021-03", "2021-04"].flatMap((m) => daysAt(m, 25, 4)),
        ...["2021-05", "2021-06", "2021-07"].flatMap((m) => daysAt(m, 25, 11)),
      ],
      CATALOG,
      METROS,
    );
    const y = year(data, "2021");
    expect(y.sparse).toBe(false);
    expect(y.nearestBase?.label).toBe("Washington DC");
    expect(y.nearestBase!.km).toBeLessThan(1);
  });

  it("reports how far the centre is from every base when no area has a majority", () => {
    // A wide triangle. (Bursa would be a bad third corner: it sits almost
    // on the line from DC to Dubai, and a triangle with an angle of 120°+
    // has its median exactly on that corner — so the centre would
    // correctly land *in* Bursa.)
    const data = buildLocationCentreData(
      [...daysAt("2022-01", 20, 4), ...daysAt("2022-02", 20, 11), ...daysAt("2022-03", 20, 40)],
      CATALOG,
      METROS,
    );
    const y = year(data, "2022");
    expect(y.centre).not.toBeNull();
    expect(y.nearestBase!.km).toBeGreaterThan(50);
  });

  it("gives a sparse year no centre, and lists every year in between", () => {
    const data = buildLocationCentreData([...daysAt("2018-01", 5, 4), ...daysAt("2020-01", 25, 4), ...daysAt("2020-02", 10, 4)], CATALOG, METROS);
    expect(data.years.map((y) => y.period)).toEqual(["2018", "2019", "2020"]);
    expect(year(data, "2018").sparse).toBe(true);
    expect(year(data, "2018").centre).toBeNull();
    expect(year(data, "2020").centre).not.toBeNull();
    expect(data.months).toHaveLength(36);
    // January 2020 has 25 located days (>= 10), February 10.
    expect(data.months.find((m) => m.period === "2020-01")!.sparse).toBe(false);
    expect(data.months.find((m) => m.period === "2020-02")!.sparse).toBe(false);
  });

  it("keeps a base's colour slot the same in every period", () => {
    const data = buildLocationCentreData(
      [...daysAt("2020-01", 25, 11), ...daysAt("2021-01", 25, 4), ...daysAt("2021-02", 25, 4)],
      CATALOG,
      METROS,
    );
    const dcAll = data.all.bases.find((b) => b.label === "Washington DC")!.colorIndex;
    const dc2021 = year(data, "2021").bases.find((b) => b.label === "Washington DC")!.colorIndex;
    expect(dcAll).toBe(0);
    expect(dc2021).toBe(dcAll);
    expect(year(data, "2020").bases[0].colorIndex).toBe(1);
  });
});

function period(p: string, centre: [number, number] | null): CentrePeriod {
  return { period: p, placedDays: 40, locatedDays: centre ? 40 : 3, sparse: !centre, centre, nearestBase: null, bases: [] };
}

describe("buildPath", () => {
  it("merges periods at the same spot and dashes across sparse gaps", () => {
    const periods = [
      period("2016", [-77.05, 38.92]),
      period("2017", [-77.06, 38.93]), // ~1 km away: same stop
      period("2018", null),
      period("2019", [55.27, 25.2]),
      period("2020", [-77.05, 38.92]), // back where 2016 was
    ];
    const { stops, segments } = buildPath(periods);
    expect(stops.map((s) => s.periods.map((p) => p.period))).toEqual([["2016", "2017", "2020"], ["2019"]]);
    expect(segments).toHaveLength(2);
    expect(segments[0].dashed).toBe(true);
    expect(segments[1].dashed).toBe(false);
    expect(greatCircleKm(segments[1].to, [-77.05, 38.92])).toBeLessThan(0.01);
  });
});

describe("formatPeriodRuns", () => {
  it("joins adjacent periods into ranges", () => {
    const ordered = ["2016", "2017", "2018", "2019", "2020", "2021"].map((p) => period(p, [0, 0]));
    const members = [ordered[0], ordered[1], ordered[2], ordered[5]];
    expect(formatPeriodRuns(members, ordered, (p) => p)).toBe("2016–2018, 2021");
  });
});
