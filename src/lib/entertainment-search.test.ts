import { describe, expect, it } from "vitest";
import {
  decodeSearchId,
  encodeSearchId,
  ENTERTAINMENT_KIND_LABELS,
  ENTERTAINMENT_KINDS,
  entertainmentKindColor,
  type EntertainmentKind,
} from "@/lib/entertainment-search";

describe("encodeSearchId / decodeSearchId", () => {
  it("round-trips every kind and a representative set of catalog ids", () => {
    for (const kind of ENTERTAINMENT_KINDS) {
      for (const catalogId of [0, 1, 42, 9_999_999]) {
        const encoded = encodeSearchId(kind, catalogId);
        expect(decodeSearchId(encoded)).toEqual({ kind, id: catalogId });
      }
    }
  });

  it("never collides across two different kinds for the same catalog id", () => {
    const seen = new Set<number>();
    for (const kind of ENTERTAINMENT_KINDS) {
      const encoded = encodeSearchId(kind, 1);
      expect(seen.has(encoded)).toBe(false);
      seen.add(encoded);
    }
  });

  it("locks in each kind's slot index — reordering ENTERTAINMENT_KINDS would silently reassign every existing composite id", () => {
    // If this test breaks because ENTERTAINMENT_KINDS was reordered, that's
    // exactly the footgun this module's own header comment warns about —
    // "game" was appended, not inserted alphabetically, for this reason.
    expect(ENTERTAINMENT_KINDS.indexOf("movie" as EntertainmentKind)).toBe(0);
    expect(ENTERTAINMENT_KINDS.indexOf("tv" as EntertainmentKind)).toBe(1);
    expect(ENTERTAINMENT_KINDS.indexOf("sports" as EntertainmentKind)).toBe(2);
    expect(ENTERTAINMENT_KINDS.indexOf("book" as EntertainmentKind)).toBe(3);
    expect(ENTERTAINMENT_KINDS.indexOf("other" as EntertainmentKind)).toBe(4);
    expect(ENTERTAINMENT_KINDS.indexOf("game" as EntertainmentKind)).toBe(5);
  });
});

describe("entertainmentKindColor", () => {
  it("assigns each of the first 5 kinds its own --chart-N slot", () => {
    expect(entertainmentKindColor("movie")).toBe("var(--chart-1)");
    expect(entertainmentKindColor("tv")).toBe("var(--chart-2)");
    expect(entertainmentKindColor("sports")).toBe("var(--chart-3)");
    expect(entertainmentKindColor("book")).toBe("var(--chart-4)");
    expect(entertainmentKindColor("other")).toBe("var(--chart-5)");
  });

  it("falls back to the muted overflow color for the 6th kind rather than reusing a slot", () => {
    expect(entertainmentKindColor("game")).toBe("var(--muted-foreground)");
  });

  it("is stable for the same kind across calls", () => {
    expect(entertainmentKindColor("movie")).toBe(entertainmentKindColor("movie"));
  });
});

describe("ENTERTAINMENT_KIND_LABELS", () => {
  it("has a human-readable label for every kind, no gaps", () => {
    for (const kind of ENTERTAINMENT_KINDS) {
      expect(ENTERTAINMENT_KIND_LABELS[kind]).toBeTruthy();
    }
  });
});
