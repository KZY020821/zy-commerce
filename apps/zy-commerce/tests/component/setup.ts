import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Unmount between tests; Testing Library only does this itself when vitest
// runs with globals enabled, which this project does not.
afterEach(() => cleanup());

// jsdom has no object URLs. The logo form uses them for its preview.
if (typeof URL.createObjectURL !== "function") {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:preview"),
    revokeObjectURL: vi.fn(),
  });
}

// jsdom does not implement scrollTo; the assistant widget scrolls its message list.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = () => {};
}
