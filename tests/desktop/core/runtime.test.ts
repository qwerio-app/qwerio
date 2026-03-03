import { afterEach, describe, expect, it } from "vitest";
import { detectRuntimeMode } from "../../../src/core/runtime";

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("detectRuntimeMode", () => {
  it("returns web when tauri internals are missing", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(detectRuntimeMode()).toBe("web");

    (globalThis as { window?: Record<string, unknown> }).window = {};
    expect(detectRuntimeMode()).toBe("web");
  });

  it("returns desktop when __TAURI_INTERNALS__ is present", () => {
    (globalThis as { window?: Record<string, unknown> }).window = {
      __TAURI_INTERNALS__: {},
    };

    expect(detectRuntimeMode()).toBe("desktop");
  });
});
