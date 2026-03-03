import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unmock("../../../src/core/runtime");
  vi.unmock("../../../src/platform/web/browser-query-engine");
  vi.unmock("../../../src/platform/desktop/tauri-query-engine");
});

describe("query-engine-service", () => {
  it("returns BrowserQueryEngine when runtime is web", async () => {
    const detectRuntimeModeMock = vi.fn().mockReturnValue("web");
    const browserCtor = vi.fn();
    const tauriCtor = vi.fn();

    vi.doMock("../../../src/core/runtime", () => ({
      detectRuntimeMode: detectRuntimeModeMock,
    }));
    vi.doMock("../../../src/platform/web/browser-query-engine", () => ({
      BrowserQueryEngine: class {
        constructor() {
          browserCtor();
        }
      },
    }));
    vi.doMock("../../../src/platform/desktop/tauri-query-engine", () => ({
      TauriQueryEngine: class {
        constructor() {
          tauriCtor();
        }
      },
    }));

    const { getQueryEngine } = await import("../../../src/core/query-engine-service");

    getQueryEngine();

    expect(browserCtor).toHaveBeenCalledTimes(1);
    expect(tauriCtor).not.toHaveBeenCalled();
  });

  it("returns TauriQueryEngine when runtime is desktop", async () => {
    const detectRuntimeModeMock = vi.fn().mockReturnValue("desktop");
    const browserCtor = vi.fn();
    const tauriCtor = vi.fn();

    vi.doMock("../../../src/core/runtime", () => ({
      detectRuntimeMode: detectRuntimeModeMock,
    }));
    vi.doMock("../../../src/platform/web/browser-query-engine", () => ({
      BrowserQueryEngine: class {
        constructor() {
          browserCtor();
        }
      },
    }));
    vi.doMock("../../../src/platform/desktop/tauri-query-engine", () => ({
      TauriQueryEngine: class {
        constructor() {
          tauriCtor();
        }
      },
    }));

    const { getQueryEngine } = await import("../../../src/core/query-engine-service");

    getQueryEngine();

    expect(tauriCtor).toHaveBeenCalledTimes(1);
    expect(browserCtor).not.toHaveBeenCalled();
  });

  it("caches the initialized engine singleton", async () => {
    const detectRuntimeModeMock = vi.fn().mockReturnValue("web");
    const browserCtor = vi.fn();

    vi.doMock("../../../src/core/runtime", () => ({
      detectRuntimeMode: detectRuntimeModeMock,
    }));
    vi.doMock("../../../src/platform/web/browser-query-engine", () => ({
      BrowserQueryEngine: class {
        constructor() {
          browserCtor();
        }
      },
    }));
    vi.doMock("../../../src/platform/desktop/tauri-query-engine", () => ({
      TauriQueryEngine: class {},
    }));

    const { getQueryEngine } = await import("../../../src/core/query-engine-service");

    const first = getQueryEngine();
    const second = getQueryEngine();

    expect(browserCtor).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(detectRuntimeModeMock).toHaveBeenCalledTimes(1);
  });
});
