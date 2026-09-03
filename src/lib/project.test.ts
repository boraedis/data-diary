import { describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mock-db";
import { getProjectSettings, upsertProjectSettings, validateProjectSettingsInput } from "@/lib/project";

const dbState = vi.hoisted(() => ({ current: undefined as MockDb | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => dbState.current }));

describe("validateProjectSettingsInput", () => {
  it("trims non-blank fields", () => {
    expect(validateProjectSettingsInput({ name: "  Data Diary  ", tagline: "A life log", goalsSummary: "Track everything" })).toEqual({
      ok: true,
      value: { name: "Data Diary", tagline: "A life log", goalsSummary: "Track everything" },
    });
  });

  it("nulls out blank or missing fields rather than storing empty strings", () => {
    expect(validateProjectSettingsInput({ name: "", tagline: "   ", goalsSummary: undefined })).toEqual({
      ok: true,
      value: { name: null, tagline: null, goalsSummary: null },
    });
  });

  it("accepts a fully-empty body as all-null", () => {
    expect(validateProjectSettingsInput({})).toEqual({
      ok: true,
      value: { name: null, tagline: null, goalsSummary: null },
    });
  });

  it("rejects a non-object body", () => {
    expect(validateProjectSettingsInput(null)).toEqual({ ok: false, error: "Invalid request body" });
    expect(validateProjectSettingsInput("nope")).toEqual({ ok: false, error: "Invalid request body" });
  });
});

describe("getProjectSettings", () => {
  it("returns the saved row when one exists", async () => {
    dbState.current = createMockDb([[{ name: "Data Diary", tagline: "A life log", goalsSummary: "Track everything" }]]);
    expect(await getProjectSettings()).toEqual({
      name: "Data Diary",
      tagline: "A life log",
      goalsSummary: "Track everything",
    });
  });

  it("defaults every field to null when no row has been saved yet, rather than throwing", async () => {
    dbState.current = createMockDb([[]]);
    expect(await getProjectSettings()).toEqual({ name: null, tagline: null, goalsSummary: null });
  });
});

describe("upsertProjectSettings", () => {
  it("returns the upserted row", async () => {
    dbState.current = createMockDb([[{ name: "New name", tagline: null, goalsSummary: null }]]);
    expect(await upsertProjectSettings({ name: "New name", tagline: null, goalsSummary: null })).toEqual({
      name: "New name",
      tagline: null,
      goalsSummary: null,
    });
  });
});
