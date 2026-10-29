import { describe, expect, it } from "vitest";
import {
  fitWithin,
  MAX_PORTRAIT_BYTES,
  portraitStorageKey,
  sniffImageType,
  validatePortraitUpload,
} from "@/lib/day-portraits/rules";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("portraitStorageKey", () => {
  it("groups by day and uses the type's extension", () => {
    expect(portraitStorageKey("2026-10-29", "abc", "image/jpeg")).toBe("day-portraits/2026-10-29/abc.jpg");
    expect(portraitStorageKey("2026-10-29", "abc", "image/webp")).toBe("day-portraits/2026-10-29/abc.webp");
  });
});

describe("sniffImageType", () => {
  it("recognises JPEG and WebP by their magic numbers", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });

  it("rejects other formats and truncated input", () => {
    expect(sniffImageType(PNG)).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it("does not take a RIFF container that is not WebP", () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]);
    expect(sniffImageType(wav)).toBeNull();
  });
});

describe("validatePortraitUpload", () => {
  it("accepts a JPEG whose bytes match, ignoring content-type parameters", () => {
    expect(validatePortraitUpload({ contentType: "image/jpeg; charset=binary", sizeBytes: 1000, bytes: JPEG })).toEqual({
      ok: true,
      mimeType: "image/jpeg",
    });
  });

  it("rejects an unsupported or missing type with 415", () => {
    expect(validatePortraitUpload({ contentType: "image/png", sizeBytes: 10, bytes: null })).toMatchObject({
      ok: false,
      status: 415,
    });
    expect(validatePortraitUpload({ contentType: null, sizeBytes: 10, bytes: null })).toMatchObject({
      ok: false,
      status: 415,
    });
  });

  it("rejects an empty or oversized body", () => {
    expect(validatePortraitUpload({ contentType: "image/jpeg", sizeBytes: 0, bytes: null })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      validatePortraitUpload({ contentType: "image/jpeg", sizeBytes: MAX_PORTRAIT_BYTES + 1, bytes: null }),
    ).toMatchObject({ ok: false, status: 413 });
  });

  it("accepts exactly the cap", () => {
    expect(validatePortraitUpload({ contentType: "image/jpeg", sizeBytes: MAX_PORTRAIT_BYTES, bytes: null }).ok).toBe(
      true,
    );
  });

  it("rejects bytes that do not match the declared type", () => {
    expect(validatePortraitUpload({ contentType: "image/jpeg", sizeBytes: 8, bytes: PNG })).toMatchObject({
      ok: false,
      status: 415,
    });
    expect(validatePortraitUpload({ contentType: "image/webp", sizeBytes: 6, bytes: JPEG })).toMatchObject({
      ok: false,
      status: 415,
    });
  });
});

describe("fitWithin", () => {
  it("leaves a frame that already fits alone", () => {
    expect(fitWithin(1280, 720, 2048)).toEqual({ width: 1280, height: 720 });
  });

  it("scales the longer side down to the cap, keeping aspect", () => {
    expect(fitWithin(4096, 2160, 2048)).toEqual({ width: 2048, height: 1080 });
    expect(fitWithin(2160, 4096, 2048)).toEqual({ width: 1080, height: 2048 });
  });

  it("never scales up", () => {
    expect(fitWithin(640, 480, 2048)).toEqual({ width: 640, height: 480 });
  });
});
