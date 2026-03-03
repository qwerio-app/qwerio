import { describe, expect, it, vi } from "vitest";

const superCtorMock = vi.fn();

vi.mock("../../../../../src/platform/web/providers/neon-adapter", () => ({
  NeonServerlessAdapter: class {
    constructor(...args: unknown[]) {
      superCtorMock(...args);
    }
  },
}));

import { ProxyAdapter } from "../../../../../src/platform/web/providers/proxy-adapter";

describe("ProxyAdapter", () => {
  it("adds token to endpoint URLs", () => {
    new ProxyAdapter("postgres://user:pw@localhost:5432/app", "wss://proxy.example.dev/v1", "token-1");

    const [, wsProxyEndpoint] = superCtorMock.mock.calls.at(-1) as [string, string];
    expect(wsProxyEndpoint).toContain("token=token-1");
  });

  it("does not append token when already present", () => {
    new ProxyAdapter(
      "postgres://user:pw@localhost:5432/app",
      "https://proxy.example.dev/v1?token=existing",
      "token-1",
    );

    const [, wsProxyEndpoint] = superCtorMock.mock.calls.at(-1) as [string, string];
    expect(wsProxyEndpoint).toBe("https://proxy.example.dev/v1?token=existing");
  });

  it("handles host:port style endpoints", () => {
    new ProxyAdapter(
      "postgres://user:pw@localhost:5432/app",
      "localhost:6543/v1",
      "token-1",
    );

    const [, wsProxyEndpoint] = superCtorMock.mock.calls.at(-1) as [string, string];
    expect(wsProxyEndpoint).toBe("localhost:6543/v1?token=token-1");
  });
});
