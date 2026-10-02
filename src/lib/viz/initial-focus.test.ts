import { describe, expect, it } from "vitest";
import { lerpDomain, resolveInitialFocus } from "@/lib/viz/initial-focus";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const FULL: [Date, Date] = [d("2024-01-01"), d("2024-12-31")];

describe("resolveInitialFocus", () => {
  it("lastDays anchors the window at the end of the data", () => {
    const [start, end] = resolveInitialFocus(FULL, { lastDays: 45 })!;
    expect(end).toEqual(FULL[1]);
    expect(end.getTime() - start.getTime()).toBe(45 * 86_400_000);
  });

  it("returns null when lastDays covers everything", () => {
    expect(resolveInitialFocus(FULL, { lastDays: 400 })).toBeNull();
  });

  it("clamps an explicit domain inside the data", () => {
    const [start, end] = resolveInitialFocus(FULL, { domain: [d("2023-06-01"), d("2024-03-01")] })!;
    expect(start).toEqual(FULL[0]);
    expect(end).toEqual(d("2024-03-01"));
  });

  it("returns null for an empty, inverted or fully covering target", () => {
    expect(resolveInitialFocus(FULL, { domain: [d("2024-03-01"), d("2024-03-01")] })).toBeNull();
    expect(resolveInitialFocus(FULL, { domain: [d("2024-05-01"), d("2024-03-01")] })).toBeNull();
    expect(resolveInitialFocus(FULL, { domain: [d("2020-01-01"), d("2030-01-01")] })).toBeNull();
    expect(resolveInitialFocus(FULL, { lastDays: 0 })).toBeNull();
  });

  it("returns null when the data is a single instant", () => {
    expect(resolveInitialFocus([d("2024-01-01"), d("2024-01-01")], { lastDays: 10 })).toBeNull();
  });
});

describe("lerpDomain", () => {
  it("interpolates both endpoints", () => {
    const to: [Date, Date] = [d("2024-12-01"), FULL[1]];
    expect(lerpDomain(FULL, to, 0)).toEqual(FULL);
    expect(lerpDomain(FULL, to, 1)).toEqual(to);
    const mid = lerpDomain(FULL, to, 0.5);
    expect(mid[0].getTime()).toBe((FULL[0].getTime() + to[0].getTime()) / 2);
  });
});
