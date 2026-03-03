import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../../../../src/core/types";

const { invokeMock, resolveConnectionPasswordMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  resolveConnectionPasswordMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../../../../src/core/connection-secrets", () => ({
  resolveConnectionPassword: resolveConnectionPasswordMock,
}));

import { TauriQueryEngine } from "../../../../src/platform/desktop/tauri-query-engine";

function createDesktopPostgresProfile(): ConnectionProfile {
  return {
    id: "conn-desktop-pg",
    name: "Desktop PG",
    type: "personal",
    target: {
      kind: "desktop-tcp",
      dialect: "postgres",
      host: "localhost",
      port: 5432,
      database: "app",
      user: "postgres",
      tlsMode: "tls-verified-cert",
    },
    credentials: {
      storage: "none",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("TauriQueryEngine", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resolveConnectionPasswordMock.mockReset();
    resolveConnectionPasswordMock.mockResolvedValue("pw");
  });

  it("rejects non-desktop connection profiles", async () => {
    const engine = new TauriQueryEngine();

    await expect(
      engine.connect({
        id: "conn-web",
        name: "Web",
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
      }),
    ).rejects.toThrow("Desktop runtime requires a desktop-tcp connection profile.");
  });

  it("builds sqlite connect payload with database-only target", async () => {
    invokeMock.mockResolvedValueOnce({
      resolvedTlsMode: undefined,
    });

    const engine = new TauriQueryEngine();

    await engine.connect({
      id: "conn-sqlite",
      name: "SQLite",
      type: "personal",
      target: {
        kind: "desktop-tcp",
        dialect: "sqlite",
        database: "/tmp/app.db",
      },
      credentials: {
        storage: "none",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(invokeMock).toHaveBeenCalledWith("db_connect", {
      connection: {
        id: "conn-sqlite",
        dialect: "sqlite",
        database: "/tmp/app.db",
        password: "pw",
      },
    });
  });

  it("builds postgres connect payload including preferred TLS mode", async () => {
    invokeMock.mockResolvedValueOnce({
      resolvedTlsMode: "tls-allow-invalid-cert",
    });

    const engine = new TauriQueryEngine();

    await expect(engine.connect(createDesktopPostgresProfile())).resolves.toEqual({
      resolvedDesktopTlsMode: "tls-allow-invalid-cert",
    });

    expect(invokeMock).toHaveBeenCalledWith("db_connect", {
      connection: {
        id: "conn-desktop-pg",
        dialect: "postgres",
        host: "localhost",
        port: 5432,
        database: "app",
        user: "postgres",
        password: "pw",
        preferredTlsMode: "tls-verified-cert",
      },
    });
  });

  it("delegates execute/cancel/list commands to tauri invoke", async () => {
    invokeMock
      .mockResolvedValueOnce({ columns: [], rows: [], rowCount: 0, elapsedMs: 1 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ name: "public" }])
      .mockResolvedValueOnce([{ name: "users" }])
      .mockResolvedValueOnce({
        tables: [],
        views: [],
        functions: [],
        triggers: [],
        indexes: [],
        procedures: [],
        sequences: [],
      });

    const engine = new TauriQueryEngine();

    await engine.execute({
      connectionId: "conn-1",
      sql: "select 1",
    });
    await engine.cancel("request-1");
    await engine.listSchemas("conn-1");
    await engine.listTables("conn-1", "public");
    await engine.listSchemaObjects("conn-1", "public");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "db_execute", {
      req: {
        connectionId: "conn-1",
        sql: "select 1",
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "db_cancel", {
      requestId: "request-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "db_list_schemas", {
      connectionId: "conn-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "db_list_tables", {
      connectionId: "conn-1",
      schema: "public",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, "db_list_schema_objects", {
      connectionId: "conn-1",
      schema: "public",
    });
  });

  it("adds TLS guidance for db_connect TLS failures", async () => {
    invokeMock.mockRejectedValueOnce(new Error("TLS handshake failure"));

    const engine = new TauriQueryEngine();

    await expect(engine.connect(createDesktopPostgresProfile())).rejects.toThrow(
      "Checks: desktop Postgres attempts verified TLS",
    );
  });
});
