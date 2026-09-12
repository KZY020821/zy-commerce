import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount between tests; Testing Library only does this itself when vitest
// runs with globals enabled, which this package does not.
afterEach(() => cleanup());

// jsdom does not implement scrollTo; the widget scrolls its message list.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = () => {};
}
