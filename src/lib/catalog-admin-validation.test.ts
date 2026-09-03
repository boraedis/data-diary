import { describe, expect, it } from "vitest";
import {
  validateEntertainmentKindInput,
  validateExerciseSubfocusInput,
  validateExerciseSubtypeInput,
  validateNameInput,
  validateTagInput,
} from "@/lib/catalog-admin";

// This file deliberately imports only the pure `validate*Input` functions
// from catalog-admin.ts — every other export there touches the DB via
// getDb(), which needs a real/mocked Postgres connection this test suite
// doesn't set up. Importing the module itself is still safe (src/lib/db.ts
// only throws when a query actually runs, not at import time), but calling
// any async CRUD function here would fail on a missing DATABASE_URL.

describe("validateTagInput", () => {
  it("accepts a name with no color", () => {
    expect(validateTagInput({ name: "Friends", color: null })).toEqual({
      ok: true,
      value: { name: "Friends", color: null },
    });
  });

  it("trims the name", () => {
    expect(validateTagInput({ name: "  Family  ", color: null })).toEqual({
      ok: true,
      value: { name: "Family", color: null },
    });
  });

  it("accepts a well-formed hex color", () => {
    expect(validateTagInput({ name: "Work", color: "#336699" })).toEqual({
      ok: true,
      value: { name: "Work", color: "#336699" },
    });
  });

  it("rejects a missing name", () => {
    expect(validateTagInput({ color: null })).toEqual({ ok: false, error: "Name is required" });
  });

  it("rejects a blank/whitespace-only name", () => {
    expect(validateTagInput({ name: "   ", color: null })).toEqual({ ok: false, error: "Name is required" });
  });

  it("rejects a malformed color", () => {
    expect(validateTagInput({ name: "Work", color: "blue" })).toEqual({
      ok: false,
      error: "Color must be in format #xxxxxx",
    });
  });

  it("rejects a non-object body", () => {
    expect(validateTagInput(null)).toEqual({ ok: false, error: "Invalid request body" });
    expect(validateTagInput("a string")).toEqual({ ok: false, error: "Invalid request body" });
  });
});

describe("validateEntertainmentKindInput / validateNameInput (shared 'name required' shape)", () => {
  it.each([validateEntertainmentKindInput, validateNameInput])("accepts and trims a valid name", (validate) => {
    expect(validate({ name: "  Boardgame  " })).toEqual({ ok: true, value: { name: "Boardgame" } });
  });

  it.each([validateEntertainmentKindInput, validateNameInput])("rejects a missing name", (validate) => {
    expect(validate({})).toEqual({ ok: false, error: "Name is required" });
  });

  it.each([validateEntertainmentKindInput, validateNameInput])("rejects a non-object body", (validate) => {
    expect(validate(undefined)).toEqual({ ok: false, error: "Invalid request body" });
  });
});

describe("validateExerciseSubtypeInput", () => {
  it("accepts a valid category and name", () => {
    expect(validateExerciseSubtypeInput({ category: "strength", name: "Bench press" })).toEqual({
      ok: true,
      value: { category: "strength", name: "Bench press" },
    });
  });

  it("accepts every valid category", () => {
    for (const category of ["distance", "sport", "strength"]) {
      expect(validateExerciseSubtypeInput({ category, name: "X" }).ok).toBe(true);
    }
  });

  it("rejects an invalid category", () => {
    expect(validateExerciseSubtypeInput({ category: "cardio", name: "Running" })).toEqual({
      ok: false,
      error: "Invalid category",
    });
  });

  it("rejects a missing category", () => {
    expect(validateExerciseSubtypeInput({ name: "Running" })).toEqual({ ok: false, error: "Invalid category" });
  });

  it("checks name before category", () => {
    expect(validateExerciseSubtypeInput({ category: "not-real", name: "" })).toEqual({
      ok: false,
      error: "Name is required",
    });
  });
});

describe("validateExerciseSubfocusInput", () => {
  it("accepts a valid focusId and name", () => {
    expect(validateExerciseSubfocusInput({ focusId: 3, name: "Hamstrings" })).toEqual({
      ok: true,
      value: { focusId: 3, name: "Hamstrings" },
    });
  });

  it("rejects a non-integer focusId", () => {
    expect(validateExerciseSubfocusInput({ focusId: 3.5, name: "Hamstrings" })).toEqual({
      ok: false,
      error: "Invalid focusId",
    });
  });

  it("rejects a missing focusId", () => {
    expect(validateExerciseSubfocusInput({ name: "Hamstrings" })).toEqual({ ok: false, error: "Invalid focusId" });
  });

  it("rejects a string focusId (no implicit coercion)", () => {
    expect(validateExerciseSubfocusInput({ focusId: "3", name: "Hamstrings" })).toEqual({
      ok: false,
      error: "Invalid focusId",
    });
  });
});
