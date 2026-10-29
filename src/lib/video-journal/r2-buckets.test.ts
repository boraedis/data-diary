import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteObject,
  getR2Config,
  getR2PortraitsConfig,
  presignGetObject,
  putObject,
  R2NotConfiguredError,
  requirePortraitsConfig,
} from "@/lib/video-journal/r2";

// #688: day portraits live in their own bucket, with the same account and
// API token as the videos. These pin that the two never fall into each
// other, since a token or object landing in the wrong bucket is silent.

function setEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
}

const CREDENTIALS = { R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "secret" };

beforeEach(() => {
  // A clean slate even if the developer's shell has these set.
  setEnv({ R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET: "", R2_PORTRAITS_BUCKET: "" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("bucket config", () => {
  it("gives each bucket its own name on the shared credentials", () => {
    setEnv({ ...CREDENTIALS, R2_BUCKET: "videos", R2_PORTRAITS_BUCKET: "portraits" });
    expect(getR2Config()).toEqual({ accountId: "acct", accessKeyId: "key", secretAccessKey: "secret", bucket: "videos" });
    expect(getR2PortraitsConfig()).toEqual({
      accountId: "acct",
      accessKeyId: "key",
      secretAccessKey: "secret",
      bucket: "portraits",
    });
  });

  it("does not fall back to the video bucket when the portraits bucket is unset", () => {
    setEnv({ ...CREDENTIALS, R2_BUCKET: "videos" });
    expect(getR2PortraitsConfig()).toBeNull();
    expect(() => requirePortraitsConfig()).toThrow(R2NotConfiguredError);
    expect(() => requirePortraitsConfig()).toThrow(/R2_PORTRAITS_BUCKET/);
  });

  it("configures portraits without the video bucket, and videos without portraits", () => {
    setEnv({ ...CREDENTIALS, R2_PORTRAITS_BUCKET: "portraits" });
    expect(getR2Config()).toBeNull();
    expect(getR2PortraitsConfig()?.bucket).toBe("portraits");

    setEnv({ R2_BUCKET: "videos", R2_PORTRAITS_BUCKET: "" });
    expect(getR2Config()?.bucket).toBe("videos");
    expect(getR2PortraitsConfig()).toBeNull();
  });

  it("is not configured at all without credentials", () => {
    setEnv({ R2_BUCKET: "videos", R2_PORTRAITS_BUCKET: "portraits" });
    expect(getR2Config()).toBeNull();
    expect(getR2PortraitsConfig()).toBeNull();
  });
});

describe("object helpers use the bucket they are given", () => {
  const portraits = { accountId: "acct", accessKeyId: "key", secretAccessKey: "secret", bucket: "portraits" };

  it("PUTs and DELETEs in the given bucket, even with no video bucket configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await putObject("day-portraits/2026-10-29/a.jpg", new Uint8Array([1, 2, 3]), "image/jpeg", portraits);
    await deleteObject("day-portraits/2026-10-29/a.jpg", portraits);

    const urls = fetchMock.mock.calls.map(([input]) => String((input as Request).url ?? input));
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toContain("acct.r2.cloudflarestorage.com/portraits/day-portraits/2026-10-29/a.jpg");
    }
  });

  it("sends a PUT body as a plain typed array on a URL, not inside a Request", async () => {
    // R2 answered 411 MissingContentLength when the body reached it inside
    // a Request built by aws4fetch (a stream, under Next's patched fetch).
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);

    await putObject("day-portraits/2026-10-29/a.jpg", bytes, "image/jpeg", portraits);

    const [input, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    expect(typeof input).toBe("string");
    expect(String(input)).toContain("X-Amz-Signature=");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(bytes);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
  });

  it("surfaces R2's own error code when the PUT is refused", async () => {
    const refusal = "<Error><Code>AccessDenied</Code><Message>token does not cover this bucket</Message></Error>";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(refusal, { status: 403 })));

    await expect(putObject("k.jpg", new Uint8Array([1]), "image/jpeg", portraits)).rejects.toThrow(
      /403 AccessDenied.*token does not cover this bucket/,
    );
  });

  it("presigns a read in the given bucket", async () => {
    const url = await presignGetObject("day-portraits/2026-10-29/a.jpg", portraits);
    expect(url).toContain("acct.r2.cloudflarestorage.com/portraits/day-portraits/2026-10-29/a.jpg");
    expect(url).toContain("X-Amz-Expires=");
  });
});
