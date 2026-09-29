import { describe, expect, it } from "vitest";
import { describeQaFailure, isUndefinedTableError } from "./city-heatmap-qa";

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

describe("describeQaFailure", () => {
  it("names the missing tables and how to fix it, as a 503", () => {
    const failure = describeQaFailure(new Error("Failed query", { cause: { code: "42P01" } }));
    expect(failure.status).toBe(503);
    expect(failure.error).toContain("drizzle-kit push");
  });

  it("passes any other error's message through as a 500", () => {
    expect(describeQaFailure(new Error("connection refused"))).toEqual({ status: 500, error: "connection refused" });
    expect(describeQaFailure("nope")).toEqual({ status: 500, error: "Unexpected server error" });
  });
});
