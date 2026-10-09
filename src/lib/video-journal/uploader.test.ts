import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPLOAD_PART_SIZE } from "@/lib/video-journal/upload-plan";
import { UploadNotConfiguredError, uploadRecording, type UploadSource } from "@/lib/video-journal/uploader";

// The uploader against a fake server + fake R2, driven through a stubbed
// global fetch. Exercises the resume, retry and completion logic without
// network or credentials.

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function source(sizeBytes: number): UploadSource {
  return {
    id: ID,
    date: "2026-10-08",
    mimeType: "video/mp4",
    durationMs: 60_000,
    recordedAt: "2026-10-08T21:00:00.000Z",
    recordedTz: "America/New_York",
    blob: new Blob([new Uint8Array(sizeBytes)]),
  };
}

type FakeServer = {
  uploadedParts: Set<number>;
  putAttempts: Map<number, number>;
  putBytes: Map<number, number>;
  /** Fail the first N PUTs of a given part with this status. */
  failPart?: { partNumber: number; times: number; status: number };
  startStatus?: number;
  completed: boolean;
};

function installFakeFetch(server: FakeServer) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

    if (url === "/api/video-logs") {
      if (server.startStatus) return json({ error: "nope" }, server.startStatus);
      const body = JSON.parse(String(init?.body));
      return json({ id: ID, status: "uploading", sizeBytes: body.sizeBytes, uploadedParts: [...server.uploadedParts] });
    }
    if (url === `/api/video-logs/${ID}/parts`) {
      const { partNumbers } = JSON.parse(String(init?.body)) as { partNumbers: number[] };
      return json({ parts: partNumbers.map((n) => ({ partNumber: n, url: `https://r2.test/part/${n}` })) });
    }
    if (url.startsWith("https://r2.test/part/")) {
      const n = Number(url.split("/").pop());
      server.putAttempts.set(n, (server.putAttempts.get(n) ?? 0) + 1);
      const fail = server.failPart;
      if (fail && fail.partNumber === n && fail.times > 0) {
        fail.times--;
        return new Response("", { status: fail.status });
      }
      server.putBytes.set(n, (init?.body as Blob).size);
      server.uploadedParts.add(n);
      return new Response("", { status: 200 });
    }
    if (url === `/api/video-logs/${ID}/complete`) {
      server.completed = true;
      return json({ id: ID, status: "uploaded" });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function newServer(overrides: Partial<FakeServer> = {}): FakeServer {
  return {
    uploadedParts: new Set(),
    putAttempts: new Map(),
    putBytes: new Map(),
    completed: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("uploadRecording", () => {
  it("sends every part with fixed-size slices, then completes", async () => {
    const server = newServer();
    installFakeFetch(server);
    const size = 2 * UPLOAD_PART_SIZE + 1234;
    const progress: number[] = [];

    await uploadRecording(source(size), { onProgress: (p) => progress.push(p.sentBytes) });

    expect([...server.putBytes.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [1, UPLOAD_PART_SIZE],
      [2, UPLOAD_PART_SIZE],
      [3, 1234],
    ]);
    expect(server.completed).toBe(true);
    expect(progress.at(-1)).toBe(size);
  });

  it("resumes: skips parts R2 already has and counts them as sent", async () => {
    const server = newServer({ uploadedParts: new Set([1, 2]) });
    installFakeFetch(server);
    const size = 3 * UPLOAD_PART_SIZE;
    const progress: number[] = [];

    await uploadRecording(source(size), { onProgress: (p) => progress.push(p.sentBytes) });

    expect([...server.putAttempts.keys()]).toEqual([3]);
    expect(progress[0]).toBe(2 * UPLOAD_PART_SIZE);
    expect(server.completed).toBe(true);
  });

  it("retries a part that fails transiently", async () => {
    const server = newServer({ failPart: { partNumber: 1, times: 2, status: 503 } });
    installFakeFetch(server);

    const done = uploadRecording(source(1000));
    // Skip the 1s + 2s backoff instead of waiting it out.
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(server.putAttempts.get(1)).toBe(3);
    expect(server.completed).toBe(true);
  });

  it("gives up after repeated failures and never completes", async () => {
    const server = newServer({ failPart: { partNumber: 1, times: 99, status: 500 } });
    installFakeFetch(server);

    const assertion = expect(uploadRecording(source(1000))).rejects.toThrow(/R2 rejected part upload/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(server.putAttempts.get(1)).toBe(4);
    expect(server.completed).toBe(false);
  });

  it("surfaces a 503 as not-configured without retrying", async () => {
    const server = newServer({ startStatus: 503 });
    const fetchMock = installFakeFetch(server);

    await expect(uploadRecording(source(1000))).rejects.toBeInstanceOf(UploadNotConfiguredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a redirect to /login as signed out, without retrying", async () => {
    const fetchMock = vi.fn(async () => {
      const res = new Response("<html>login</html>", { status: 200 });
      Object.defineProperty(res, "redirected", { value: true });
      Object.defineProperty(res, "url", { value: "https://diary.test/login?next=%2Fapi%2Fvideo-logs" });
      return res;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadRecording(source(1000))).rejects.toThrow(/Signed out/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 4xx from the API", async () => {
    const server = newServer({ startStatus: 409 });
    const fetchMock = installFakeFetch(server);

    await expect(uploadRecording(source(1000))).rejects.toThrow("nope");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
