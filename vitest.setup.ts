import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmounts every component rendered by @testing-library/react between
// tests — without this, DOM nodes from one test's render() leak into the
// next test's query scope (see the multi-match failures this fixed).
afterEach(() => {
  cleanup();
});
