import type { FaceLandmarker } from "@mediapipe/tasks-vision";

// Loads MediaPipe's face landmarker for the portrait framing hints (#689).
// Browser only. Everything runs on the device: the camera frames are handed
// to the model in this tab and never sent anywhere. What the network does
// fetch is the library's code, its WebAssembly, and the model file, all
// public and the same for everyone.
//
// The library itself is imported lazily, so the ~45KB (gzipped) of
// JavaScript only downloads when someone opens the camera, never with the
// rest of the app. The WebAssembly and the model (~3.7MB) come from public
// CDNs rather than being committed or copied into `public/`: they are
// binary, and the static-asset strategy (#163) keeps binary out of git. That
// does mean the hints need the network the first time; without it the
// loader resolves null and the card falls back to lighting-only hints.

/** Must match the `@mediapipe/tasks-vision` version in package.json, since
 * the WebAssembly has to be the build the JavaScript expects (a test checks
 * they agree). */
export const MEDIAPIPE_VERSION = "1.1.1";

export const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

/** Google's published float16 face landmarker, the one MediaPipe's own docs
 * point at. */
export const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let loading: Promise<FaceLandmarker | null> | null = null;

async function create(): Promise<FaceLandmarker | null> {
  try {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO" as const,
      numFaces: 1,
    });
    try {
      return await FaceLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      // Some phones and browsers have no usable GPU path; the model is
      // small enough that the CPU keeps up at a few checks a second.
      return await FaceLandmarker.createFromOptions(fileset, options("CPU"));
    }
  } catch (error) {
    console.warn("[portrait] Framing hints are unavailable:", error);
    // Let a later camera session try again, e.g. once back online.
    loading = null;
    return null;
  }
}

/** The shared landmarker, created on first use. Resolves null, never
 * rejects, when it can't be loaded. */
export function loadFaceLandmarker(): Promise<FaceLandmarker | null> {
  loading ??= create();
  return loading;
}

/** Frees the model's memory once the portrait page is left. */
export function releaseFaceLandmarker(): void {
  const pending = loading;
  loading = null;
  void pending?.then((landmarker) => landmarker?.close());
}
