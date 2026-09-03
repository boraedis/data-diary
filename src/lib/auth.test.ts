import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, SESSION_MAX_AGE_SECONDS, verifyPassword, verifySessionToken } from "@/lib/auth";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret");
  vi.stubEnv("APP_PASSWORD", "correct-horse-battery-staple");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("createSessionToken / verifySessionToken", () => {
  it("a freshly created token verifies as valid", () => {
    const token = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);
  });

  it("rejects a missing or empty token", () => {
    expect(verifySessionToken(undefined)).toBe(false);
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken("")).toBe(false);
  });

  it("rejects a malformed token with no signature segment", () => {
    expect(verifySessionToken("just-a-timestamp")).toBe(false);
  });

  it("rejects a token whose signature was tampered with (same length, wrong content)", () => {
    const token = createSessionToken();
    const [issuedAt, signature] = token.split(".");
    const flippedFirstChar = signature[0] === "0" ? "1" : "0";
    const tampered = flippedFirstChar + signature.slice(1);
    expect(verifySessionToken(`${issuedAt}.${tampered}`)).toBe(false);
  });

  it("rejects a token whose issuedAt was tampered with (signature no longer matches)", () => {
    const token = createSessionToken();
    const [, signature] = token.split(".");
    expect(verifySessionToken(`9999999999999.${signature}`)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSessionToken();
    vi.stubEnv("SESSION_SECRET", "a-different-secret");
    expect(verifySessionToken(token)).toBe(false);
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = createSessionToken();
    vi.setSystemTime(SESSION_MAX_AGE_SECONDS * 1000 + 1000);
    expect(verifySessionToken(token)).toBe(false);
  });

  it("still accepts a token right at the edge of its max age", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const token = createSessionToken();
    vi.setSystemTime(SESSION_MAX_AGE_SECONDS * 1000 - 1000);
    expect(verifySessionToken(token)).toBe(true);
  });

  it("rejects a token from the future (negative age)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const token = createSessionToken();
    vi.setSystemTime(0);
    expect(verifySessionToken(token)).toBe(false);
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", () => {
    expect(verifyPassword("correct-horse-battery-staple")).toBe(true);
  });

  it("rejects an incorrect password of the same length", () => {
    expect(verifyPassword("correct-horse-battery-staplf")).toBe(false);
  });

  it("rejects an incorrect password of a different length", () => {
    expect(verifyPassword("nope")).toBe(false);
  });

  it("rejects an empty password", () => {
    expect(verifyPassword("")).toBe(false);
  });

  it("throws if APP_PASSWORD is not configured", () => {
    vi.stubEnv("APP_PASSWORD", "");
    expect(() => verifyPassword("anything")).toThrow();
  });
});
