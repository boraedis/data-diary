import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { installSvgGeometryShim } from "./src/lib/test-utils/jsdom-svg";

// Global and permanent — see that module's own comment for why this can't
// be a per-test install/teardown (the d3 zoom transition it serves outlives
// the test that starts it). No-ops outside a DOM environment.
installSvgGeometryShim();

// Unmounts every component rendered by @testing-library/react between
// tests — without this, DOM nodes from one test's render() leak into the
// next test's query scope (see the multi-match failures this fixed).
afterEach(() => {
  cleanup();
});
