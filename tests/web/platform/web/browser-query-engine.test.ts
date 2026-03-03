import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../../../src/core/types";

const {
  resolveConnectionPasswordMock,
  loadValidAuthSessionFromStorageMock,
  adapterExecuteMock,
  adapterListSchemasMock,
  adapterListTablesMock,
  adapterListSchemaObjectsMock,
  neonCtorMock,
  proxyCtorMock,
  planetScaleCtorMock,
  redisCtorMock,
  mongoCtorMock,
} = vi.hoisted(() => ({
  resolveConnectionPasswordMock: vi.fn(),
  loadValidAuthSessionFromStorageMock: vi.fn(),
  adapterExecuteMock: vi.fn(),
  adapterListSchemasMock: vi.fn(),
  adapterListTablesMock: vi.fn(),
  adapterListSchemaObjectsMock: vi.fn(),
  neonCtorMock: vi.fn(),
  proxyCtorMock: vi.fn(),
  planetScaleCtorMock: vi.fn(),
  redisCtorMock: vi.fn(),
  mongoCtorMock: vi.fn(),
}));

function resetAdapterMethodMocks(): void {
  adapterExecuteMock.mockReset();
  adapterListSchemasMock.mockReset();
  adapterListTablesMock.mockReset();
  adapterListSchemaObjectsMock.mockReset();

  adapterExecuteMock.mockResolvedValue({
    columns: [],
    rows: [],
    rowCount: 0,
    elapsedMs: 1,
  });
  adapterListSchemasMock.mockResolvedValue([{ name: "public" }]);
  adapterListTablesMock.mockResolvedValue([{ name: "users" }]);
  adapterListSchemaObjectsMock.mockResolvedValue({
    tables: [],
    views: [],
    functions: [],
    triggers: [],
    indexes: [],
    procedures: [],
    sequences: [],
  });
}

vi.mock("../../../../src/core/connection-secrets", () => ({
  resolveConnectionPassword: resolveConnectionPasswordMock,
}));

vi.mock("../../../../src/core/auth-session", () => ({
  loadValidAuthSessionFromStorage: loadValidAuthSessionFromStorageMock,
}));

vi.mock("../../../../src/platform/web/providers/neon-adapter", () => ({
  NeonServerlessAdapter: class {
    execute = adapterExecuteMock;
    listSchemas = adapterListSchemasMock;
    listTables = adapterListTablesMock;
    listSchemaObjects = adapterListSchemaObjectsMock;

    constructor(...args: unknown[]) {
      neonCtorMock(...args);
    }
  },
}));

vi.mock("../../../../src/platform/web/providers/proxy-adapter", () => ({
  ProxyAdapter: class {
    execute = adapterExecuteMock;
    listSchemas = adapterListSchemasMock;
    listTables = adapterListTablesMock;
    listSchemaObjects = adapterListSchemaObjectsMock;

    constructor(...args: unknown[]) {
      proxyCtorMock(...args);
    }
  },
}));

vi.mock("../../../../src/platform/web/providers/planetscale-adapter", () => ({
  PlanetScaleAdapter: class {
    execute = adapterExecuteMock;
    listSchemas = adapterListSchemasMock;
    listTables = adapterListTablesMock;
    listSchemaObjects = adapterListSchemaObjectsMock;

    constructor(...args: unknown[]) {
      planetScaleCtorMock(...args);
    }
  },
}));

vi.mock("../../../../src/platform/web/providers/redis-proxy-adapter", () => ({
  RedisProxyAdapter: class {
    execute = adapterExecuteMock;
    listSchemas = adapterListSchemasMock;
    listTables = adapterListTablesMock;
    listSchemaObjects = adapterListSchemaObjectsMock;

    constructor(...args: unknown[]) {
      redisCtorMock(...args);
    }
  },
}));

vi.mock("../../../../src/platform/web/providers/mongo-proxy-adapter", () => ({
  MongoProxyAdapter: class {
    execute = adapterExecuteMock;
    listSchemas = adapterListSchemasMock;
    listTables = adapterListTablesMock;
    listSchemaObjects = adapterListSchemaObjectsMock;

    constructor(...args: unknown[]) {
      mongoCtorMock(...args);
    }
  },
}));

import { BrowserQueryEngine } from "../../../../src/platform/web/browser-query-engine";

function createNeonProfile(): ConnectionProfile {
  return {
    id: "conn-web-neon",
    name: "Neon",
    type: "personal",
    target: {
      kind: "web-provider",
      dialect: "postgres",
      provider: "neon",
      endpoint: "localhost:6543",
      connectionStringTemplate: "postgres://user@localhost:5432/app",
    },
    credentials: {
      storage: "none",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("BrowserQueryEngine", () => {
  beforeEach(() => {
    resolveConnectionPasswordMock.mockReset();
    loadValidAuthSessionFromStorageMock.mockReset();
    neonCtorMock.mockReset();
    proxyCtorMock.mockReset();
    planetScaleCtorMock.mockReset();
    redisCtorMock.mockReset();
    mongoCtorMock.mockReset();

    resolveConnectionPasswordMock.mockResolvedValue("pw");
    loadValidAuthSessionFromStorageMock.mockResolvedValue({
      accessToken: "token-1",
      expiresAt: "2030-01-01T00:00:00.000Z",
      user: {
        id: "user-1",
        email: null,
        displayName: null,
        avatarUrl: null,
        subscriptions: [],
      },
    });

    resetAdapterMethodMocks();
  });

  it("rejects desktop-tcp profiles in web runtime", async () => {
    const engine = new BrowserQueryEngine();

    await expect(
      engine.connect({
        id: "conn-desktop",
        name: "Desktop",
        type: "personal",
        target: {
          kind: "desktop-tcp",
          dialect: "postgres",
          host: "localhost",
          port: 5432,
          database: "app",
          user: "postgres",
        },
        credentials: {
          storage: "none",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("Web mode only supports Web Provider connections");
  });

  it("creates neon adapter with injected password and delegates execute/list calls", async () => {
    const engine = new BrowserQueryEngine();
    const connection = createNeonProfile();

    await engine.connect(connection);

    expect(neonCtorMock).toHaveBeenCalledTimes(1);
    const [connectionString, endpoint] = neonCtorMock.mock.calls[0] as [string, string];
    expect(connectionString).toContain(":pw@");
    expect(endpoint).toBe("localhost:6543");

    await expect(
      engine.execute({
        connectionId: connection.id,
        sql: "select 1",
      }),
    ).resolves.toEqual({
      columns: [],
      rows: [],
      rowCount: 0,
      elapsedMs: 1,
    });

    await expect(engine.listSchemas(connection.id)).resolves.toEqual([
      { name: "public" },
    ]);
    await expect(engine.listTables(connection.id, "public")).resolves.toEqual([
      { name: "users" },
    ]);
  });

  it("requires an authenticated session for proxy provider", async () => {
    loadValidAuthSessionFromStorageMock.mockResolvedValueOnce(null);

    const engine = new BrowserQueryEngine();

    await expect(
      engine.connect({
        ...createNeonProfile(),
        id: "conn-proxy",
        target: {
          kind: "web-provider",
          dialect: "postgres",
          provider: "proxy",
          endpoint: "localhost:6543",
          connectionStringTemplate: "postgres://user@localhost:5432/app",
        },
      }),
    ).rejects.toThrow("Sign in is required for Proxy provider connections");

    expect(proxyCtorMock).not.toHaveBeenCalled();
  });

  it("builds proxy adapter with access token when session exists", async () => {
    const engine = new BrowserQueryEngine();

    await engine.connect({
      ...createNeonProfile(),
      id: "conn-proxy",
      target: {
        kind: "web-provider",
        dialect: "postgres",
        provider: "proxy",
        endpoint: "localhost:6543",
        connectionStringTemplate: "postgres://user@localhost:5432/app",
      },
    });

    expect(proxyCtorMock).toHaveBeenCalledTimes(1);
    const [connectionString, endpoint, token] = proxyCtorMock.mock.calls[0] as [string, string, string];
    expect(connectionString).toContain(":pw@");
    expect(endpoint).toBe("localhost:6543");
    expect(token).toBe("token-1");
  });
});
