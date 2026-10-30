import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEDIAPIPE_VERSION, WASM_BASE_URL } from "@/lib/day-portraits/face-landmarker";

describe("MediaPipe version", () => {
  it("matches the installed package, so the WebAssembly is the build the JavaScript expects", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@mediapipe/tasks-vision"]).toBe(MEDIAPIPE_VERSION);
    expect(WASM_BASE_URL).toContain(`@${MEDIAPIPE_VERSION}/`);
  });
});
