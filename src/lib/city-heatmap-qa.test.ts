import { describe, expect, it } from "vitest";
import { isUndefinedTableError } from "./city-heatmap-qa";

describe("isUndefinedTableError", () => {
  it("recognises Postgres undefined_table directly and behind drizzle's wrapper", () => {
    expect(isUndefinedTableError({ code: "42P01" })).toBe(true);
    expect(isUndefinedTableError(new Error("Failed query", { cause: { code: "42P01" } }))).toBe(true);
    expect(isUndefinedTableError({ cause: { cause: { code: "42P01" } } })).toBe(true);
  });

  it("does not swallow other errors", () => {
    expect(isUndefinedTableError({ code: "42703" })).toBe(false);
    expect(isUndefinedTableError(new Error("boom"))).toBe(false);
    expect(isUndefinedTableError(null)).toBe(false);
    expect(isUndefinedTableError("42P01")).toBe(false);
  });
});
