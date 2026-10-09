import { describe, expect, it } from "vitest";
import { decideFinalizeJournal, journalAfterChoice } from "@/lib/video-journal/journal-rules";

const OLD = "VIDEO LOG #1\nDate:     …\n\nEarlier take.";
const NEW = "VIDEO LOG #2\nDate:     …\n\nRe-recorded.";

describe("decideFinalizeJournal", () => {
  it("fills an empty journal", () => {
    for (const currentJournal of [null, "", "  \n "]) {
      expect(decideFinalizeJournal({ currentJournal, entry: NEW, previousEntries: [] })).toEqual({
        kind: "write",
        expected: "blank",
      });
    }
  });

  it("replaces an earlier block that's still untouched (re-finalizing after recording again)", () => {
    expect(decideFinalizeJournal({ currentJournal: OLD, entry: NEW, previousEntries: [OLD, null] })).toEqual({
      kind: "write",
      expected: OLD,
    });
  });

  it("does nothing when the journal already is this block", () => {
    expect(decideFinalizeJournal({ currentJournal: NEW, entry: NEW, previousEntries: [NEW] })).toEqual({
      kind: "unchanged",
    });
  });

  it("asks when the journal holds writing", () => {
    expect(
      decideFinalizeJournal({ currentJournal: "I wrote this.", entry: NEW, previousEntries: [OLD] }).kind,
    ).toBe("needs-choice");
  });

  it("treats an edited earlier block as writing, even a whitespace edit", () => {
    expect(decideFinalizeJournal({ currentJournal: `${OLD} Plus a note.`, entry: NEW, previousEntries: [OLD] }).kind).toBe(
      "needs-choice",
    );
    expect(decideFinalizeJournal({ currentJournal: `${OLD}\n`, entry: NEW, previousEntries: [OLD] }).kind).toBe(
      "needs-choice",
    );
  });
});

describe("journalAfterChoice", () => {
  it("replace swaps in the block", () => {
    expect(journalAfterChoice("replace", "Mine.", NEW)).toBe(NEW);
  });

  it("append adds it after a blank line, trimming trailing whitespace", () => {
    expect(journalAfterChoice("append", "Mine.\n\n  ", NEW)).toBe(`Mine.\n\n${NEW}`);
  });

  it("append to an empty journal is just the block", () => {
    expect(journalAfterChoice("append", null, NEW)).toBe(NEW);
  });

  it("keep leaves the journal alone", () => {
    expect(journalAfterChoice("keep", "Mine.", NEW)).toBe("Mine.");
  });
});
