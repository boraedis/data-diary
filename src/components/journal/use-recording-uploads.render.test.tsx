// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { LocalRecording } from "@/lib/video-journal/local-store";
import { useRecordingUploads } from "@/components/journal/use-recording-uploads";

// The upload queue's stop-time hand-off (#339). The recorder stops a take
// and calls runUploads straight away; the queue must not treat that take
// as still recording, even though activeId only reaches the hook's ref
// after React commits. Storage and the uploader are mocked: this covers
// the queue's decisions, not IndexedDB or R2.

const mocks = vi.hoisted(() => ({
  listAllLocalRecordings: vi.fn(),
  loadLocalRecordingBlob: vi.fn(),
  deleteLocalRecording: vi.fn(),
  finishLocalRecording: vi.fn(),
  uploadRecording: vi.fn(),
}));

vi.mock("@/lib/video-journal/local-store", () => ({
  listAllLocalRecordings: mocks.listAllLocalRecordings,
  loadLocalRecordingBlob: mocks.loadLocalRecordingBlob,
  deleteLocalRecording: mocks.deleteLocalRecording,
  finishLocalRecording: mocks.finishLocalRecording,
}));

vi.mock("@/lib/video-journal/uploader", () => ({
  UploadNotConfiguredError: class extends Error {},
  uploadRecording: mocks.uploadRecording,
}));

const TAKE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const row: LocalRecording = {
  id: TAKE,
  date: "2026-10-16",
  mimeType: "video/mp4",
  startedAt: "2026-10-16T21:00:00.000Z",
  endedAt: "2026-10-16T21:01:00.000Z",
  durationMs: 60_000,
  bytes: 4,
  chunkCount: 1,
  state: "recorded",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAllLocalRecordings.mockResolvedValue([row]);
  mocks.loadLocalRecordingBlob.mockResolvedValue(new Blob(["data"]));
  mocks.deleteLocalRecording.mockResolvedValue(undefined);
  mocks.finishLocalRecording.mockResolvedValue(undefined);
  mocks.uploadRecording.mockResolvedValue({});
});

describe("useRecordingUploads stop-time pass", () => {
  it("uploads a take the recorder has just stopped, before activeId has synced", async () => {
    const onUploaded = vi.fn();
    // enabled: false, so no mount pass runs: the only pass is the stop one.
    const { result } = renderHook(() => useRecordingUploads({ enabled: false, activeId: TAKE, onUploaded }));

    // The recorder has set activeId to null and calls the queue at once.
    await act(async () => {
      await result.current.runUploads(null);
    });

    expect(mocks.uploadRecording).toHaveBeenCalledWith(expect.objectContaining({ id: TAKE }), expect.anything());
    expect(mocks.deleteLocalRecording).toHaveBeenCalledWith(TAKE);
    expect(onUploaded).toHaveBeenCalledWith(row);
  });

  it("still leaves alone the take that is being recorded right now", async () => {
    const { result } = renderHook(() =>
      useRecordingUploads({ enabled: false, activeId: TAKE, onUploaded: vi.fn() }),
    );

    await act(async () => {
      await result.current.runUploads(TAKE);
    });

    expect(mocks.uploadRecording).not.toHaveBeenCalled();
  });
});
