import { describe, expect, it } from "vitest";
import { parseDeepgramResponse } from "@/lib/video-journal/deepgram";

describe("parseDeepgramResponse", () => {
  it("prefers the paragraph transcript and keeps word timings", () => {
    const body = {
      metadata: { duration: 4.2 },
      results: {
        channels: [
          {
            detected_language: "en",
            alternatives: [
              {
                transcript: "Hi there. Second thought.",
                paragraphs: { transcript: "\nHi there.\n\n\n\nSecond thought." },
                words: [
                  { word: "hi", punctuated_word: "Hi", start: 0.081, end: 0.32 },
                  { word: "there", punctuated_word: "there.", start: 0.32, end: 0.7 },
                  { word: "second", start: 2.004, end: 2.4 },
                ],
              },
            ],
          },
        ],
      },
    };
    expect(parseDeepgramResponse(body)).toEqual({
      transcript: "Hi there.\n\nSecond thought.",
      words: [
        [0.08, 0.32, "Hi"],
        [0.32, 0.7, "there."],
        [2, 2.4, "second"],
      ],
      language: "en",
    });
  });

  it("falls back to the plain transcript without paragraphs", () => {
    const body = { results: { channels: [{ alternatives: [{ transcript: "Just words.", words: [] }] }] } };
    expect(parseDeepgramResponse(body)).toEqual({ transcript: "Just words.", words: [], language: null });
  });

  it("returns an empty transcript for silence", () => {
    const body = { results: { channels: [{ alternatives: [{ transcript: "", words: [] }] }] } };
    expect(parseDeepgramResponse(body).transcript).toBe("");
  });

  it("throws on a response with no results", () => {
    expect(() => parseDeepgramResponse({})).toThrow(/no transcription results/);
  });
});
