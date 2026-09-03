import { describe, expect, it } from "vitest";
import { parseOptionalHexColor } from "@/lib/color";

describe("parseOptionalHexColor", () => {
  it("treats an empty/blank string as 'no color set', not invalid", () => {
    expect(parseOptionalHexColor("")).toEqual({ ok: true, value: null });
    expect(parseOptionalHexColor("   ")).toEqual({ ok: true, value: null });
  });

  it("treats a missing/non-string value as 'no color set'", () => {
    expect(parseOptionalHexColor(undefined)).toEqual({ ok: true, value: null });
    expect(parseOptionalHexColor(null)).toEqual({ ok: true, value: null });
    expect(parseOptionalHexColor(123)).toEqual({ ok: true, value: null });
  });

  it("accepts a well-formed 6-digit hex color, trimmed", () => {
    expect(parseOptionalHexColor("  #1a2b3c  ")).toEqual({ ok: true, value: "#1a2b3c" });
  });

  it("accepts uppercase hex digits", () => {
    expect(parseOptionalHexColor("#ABCDEF")).toEqual({ ok: true, value: "#ABCDEF" });
  });

  it("rejects a 3-digit shorthand hex color", () => {
    expect(parseOptionalHexColor("#abc")).toEqual({ ok: false });
  });

  it("rejects a value missing the leading '#'", () => {
    expect(parseOptionalHexColor("1a2b3c")).toEqual({ ok: false });
  });

  it("rejects a non-hex string", () => {
    expect(parseOptionalHexColor("not-a-color")).toEqual({ ok: false });
  });
});
