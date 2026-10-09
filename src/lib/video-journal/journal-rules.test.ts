import { describe, expect, it } from "vitest";
import { decideJournalAction, journalAfterChoice, type SiblingLog } from "@/lib/video-journal/journal-rules";

const t = (hhmm: string) => new Date(`2026-10-08T${hhmm}:00Z`);
const sibling = (overrides: Partial<SiblingLog>): SiblingLog => ({
  id: "older",
  recordedAt: t("08:00"),
  status: "ready",
  transcript: "Earlier take.",
  ...overrides,
});

describe("decideJournalAction", () => {
  it("fills an empty journal", () => {
    for (const currentJournal of [null, "", "  \n "]) {
      expect(
        decideJournalAction({ transcript: "Hello.", recordedAt: t("09:00"), currentJournal, siblings: [] }),
      ).toEqual({ kind: "apply", expected: "blank" });
    }
  });

  it("never touches hand-written text", () => {
    expect(
      decideJournalAction({ transcript: "Hello.", recordedAt: t("09:00"), currentJournal: "I wrote this.", siblings: [] }),
    ).toEqual({ kind: "pending" });
  });

  it("latest wins: replaces an earlier transcript that's still unedited", () => {
    expect(
      decideJournalAction({
        transcript: "Re-recorded.",
        recordedAt: t("09:00"),
        currentJournal: "Earlier take.",
        siblings: [sibling({})],
      }),
    ).toEqual({ kind: "apply", expected: { text: "Earlier take.", replacingId: "older" } });
  });

  it("treats an edited transcript as writing", () => {
    expect(
      decideJournalAction({
        transcript: "Re-recorded.",
        recordedAt: t("09:00"),
        currentJournal: "Earlier take. Plus a note I typed.",
        siblings: [sibling({})],
      }),
    ).toEqual({ kind: "pending" });
  });

  it("treats even whitespace edits to a transcript as edits", () => {
    expect(
      decideJournalAction({
        transcript: "Re-recorded.",
        recordedAt: t("09:00"),
        currentJournal: "Earlier take.\n",
        siblings: [sibling({})],
      }).kind,
    ).toBe("pending");
  });

  it("an older recording finishing late never displaces a newer finished one", () => {
    expect(
      decideJournalAction({
        transcript: "Older take, slow to transcribe.",
        recordedAt: t("08:00"),
        currentJournal: "Newer take.",
        siblings: [sibling({ id: "newer", recordedAt: t("09:00"), transcript: "Newer take." })],
      }),
    ).toEqual({ kind: "superseded" });
  });

  it("a newer recording that's still transcribing doesn't block an older one", () => {
    expect(
      decideJournalAction({
        transcript: "Older take.",
        recordedAt: t("08:00"),
        currentJournal: null,
        siblings: [sibling({ id: "newer", recordedAt: t("09:00"), status: "transcribing", transcript: null })],
      }),
    ).toEqual({ kind: "apply", expected: "blank" });
  });

  it("a newer recording that failed doesn't block an older one", () => {
    expect(
      decideJournalAction({
        transcript: "Older take.",
        recordedAt: t("08:00"),
        currentJournal: null,
        siblings: [sibling({ id: "newer", recordedAt: t("09:00"), status: "failed", transcript: null })],
      }).kind,
    ).toBe("apply");
  });

  it("does nothing for a recording with no speech", () => {
    expect(
      decideJournalAction({ transcript: "  ", recordedAt: t("09:00"), currentJournal: null, siblings: [] }),
    ).toEqual({ kind: "none" });
  });
});

describe("journalAfterChoice", () => {
  it("replace swaps in the transcript", () => {
    expect(journalAfterChoice("replace", "Mine.", "Spoken.")).toBe("Spoken.");
  });

  it("append adds it after a blank line, trimming trailing whitespace", () => {
    expect(journalAfterChoice("append", "Mine.\n\n  ", "Spoken.")).toBe("Mine.\n\nSpoken.");
  });

  it("append to an empty journal is just the transcript", () => {
    expect(journalAfterChoice("append", null, "Spoken.")).toBe("Spoken.");
  });

  it("keep leaves the journal alone", () => {
    expect(journalAfterChoice("keep", "Mine.", "Spoken.")).toBe("Mine.");
  });
});
