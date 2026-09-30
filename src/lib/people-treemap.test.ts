import { describe, expect, it } from "vitest";
import type { PeopleDay, PersonOnDay } from "@/lib/charts";
import { buildPeopleTree, initialsOf, tagColors, UNTAGGED_COLOR, UNTAGGED_NAME } from "./people-treemap";
import { sumValues } from "@/lib/viz/hierarchy";

function person(name: string, tagName: string | null, tagColor: string | null = null): PersonOnDay {
  return { name, tagName, tagColor, slot: 1 };
}

const ALEX = person("Alex Morgan", "Family", "#aa0000");
const SAM = person("Sam Lee", "Family", "#aa0000");
const JO = person("Jo Park", "Work", null);
const KIM = person("Kim Diaz", null);

const DAYS: PeopleDay[] = [
  { date: "2024-01-01", happiness: 7, people: [ALEX, SAM] },
  { date: "2024-01-02", happiness: 6, people: [ALEX, JO] },
  { date: "2024-01-03", happiness: 8, people: [ALEX, KIM] },
];

describe("initialsOf", () => {
  it("takes the first letter of each word", () => {
    expect(initialsOf("Alex Morgan")).toBe("AM");
  });

  it("drops a trailing roman numeral, as legacy did", () => {
    expect(initialsOf("John Smith III")).toBe("JS");
  });

  it("keeps a lone word even if it looks like a numeral", () => {
    expect(initialsOf("V")).toBe("V");
  });
});

describe("tagColors", () => {
  it("keeps a tag's own colour and gives an uncoloured tag a palette slot", () => {
    const colors = tagColors(DAYS);
    expect(colors.get("Family")).toBe("#aa0000");
    expect(colors.get("Work")).toBe("var(--chart-1)");
    expect(colors.has(UNTAGGED_NAME)).toBe(false);
  });
});

describe("buildPeopleTree", () => {
  const colors = tagColors(DAYS);

  it("groups people under their tag, sized by days logged", () => {
    const tree = buildPeopleTree(DAYS, "tag", colors)!;
    const family = tree.children!.find((c) => c.name === "Family")!;
    expect(family.color).toBe("#aa0000");
    expect(family.children!.map((c) => [c.name, c.value])).toEqual([
      ["Alex Morgan", 3],
      ["Sam Lee", 1],
    ]);
    // Every person-day lands somewhere: 2 + 2 + 2.
    expect(sumValues(tree)).toBe(6);
  });

  it("puts untagged people in a neutral group", () => {
    const tree = buildPeopleTree(DAYS, "tag", colors)!;
    const untagged = tree.children!.find((c) => c.name === UNTAGGED_NAME)!;
    expect(untagged.color).toBe(UNTAGGED_COLOR);
    expect(untagged.children!.map((c) => c.name)).toEqual(["Kim Diaz"]);
  });

  it("flat mode lists people directly, still coloured by tag", () => {
    const tree = buildPeopleTree(DAYS, "none", colors)!;
    expect(tree.children!.map((c) => [c.name, c.color])).toEqual([
      ["Alex Morgan", "#aa0000"],
      ["Sam Lee", "#aa0000"],
      ["Jo Park", "var(--chart-1)"],
      ["Kim Diaz", UNTAGGED_COLOR],
    ]);
  });

  it("keeps the roster's shape, with zeros for anyone not yet logged", () => {
    const firstDay = DAYS.slice(0, 1);
    const frame = buildPeopleTree(firstDay, "tag", colors, DAYS)!;
    const full = buildPeopleTree(DAYS, "tag", colors)!;
    const paths = (tree: typeof full) =>
      tree.children!.flatMap((group) => group.children!.map((person) => `${group.key}/${person.key}`)).sort();
    expect(paths(frame)).toEqual(paths(full));
    const work = frame.children!.find((c) => c.name === "Work")!;
    expect(work.children!.map((c) => [c.name, c.value])).toEqual([["Jo Park", 0]]);
    expect(sumValues(frame)).toBe(2);
  });

  it("returns null when the roster is empty", () => {
    expect(buildPeopleTree([], "tag", colors)).toBeNull();
  });
});
