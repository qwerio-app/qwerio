import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeQueryResult = {
  fields: Array<{ name: string; dataTypeID: number }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
};

const { createdClients, FakeClient } = vi.hoisted(() => {
  const clients: Array<{
    connectionString: string;
    neonConfig: {
      pipelineConnect: boolean;
      wsProxy?: (host: string, port: number) => string;
      useSecureWebSocket?: boolean;
    };
    connect: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  }> = [];

  class HoistedFakeClient {
    readonly neonConfig: {
      pipelineConnect: boolean;
      wsProxy?: (host: string, port: number) => string;
      useSecureWebSocket?: boolean;
    } = {
      pipelineConnect: true,
    };

    readonly connect = vi.fn(async () => undefined);
    readonly query = vi.fn(async (): Promise<FakeQueryResult> => ({
      fields: [],
      rows: [],
      rowCount: 0,
    }));

    constructor(readonly connectionString: string) {
      clients.push(this);
    }
  }

  return {
    createdClients: clients,
    FakeClient: HoistedFakeClient,
  };
});

vi.mock("@neondatabase/serverless", () => ({
  Client: FakeClient,
}));

import { NeonServerlessAdapter } from "../../../../../src/platform/web/providers/neon-adapter";

function getLastClient(): FakeClient {
  const client = createdClients.at(-1);

  if (!client) {
    throw new Error("Expected FakeClient to be created.");
  }

  return client;
}

describe("NeonServerlessAdapter", () => {
  beforeEach(() => {
    createdClients.length = 0;
  });

  it("validates connection string", () => {
    expect(() => new NeonServerlessAdapter("not-a-url")).toThrow(
      "Invalid Postgres connection string.",
    );
  });

  it("configures wsproxy endpoint and secure flag for localhost endpoints", () => {
    new NeonServerlessAdapter(
      "postgres://user:pw@localhost:5432/app",
      "localhost:6543/v1",
    );

    const client = getLastClient();

    expect(client.neonConfig.pipelineConnect).toBe(false);
    expect(client.neonConfig.useSecureWebSocket).toBe(false);
    expect(client.neonConfig.wsProxy?.("db.internal", 5432)).toBe(
      "localhost:6543/v1?address=db.internal%3A5432",
    );
  });

  it("normalizes http/ws proxy URLs and preserves query params", () => {
    new NeonServerlessAdapter(
      "postgres://user:pw@localhost:5432/app",
      "https://proxy.example.dev/v1?foo=1",
    );

    const client = getLastClient();

    expect(client.neonConfig.useSecureWebSocket).toBe(true);
    expect(client.neonConfig.wsProxy?.("db.internal", 5432)).toBe(
      "proxy.example.dev/v1?foo=1&address=db.internal%3A5432",
    );
  });

  it("maps failed fetch errors to actionable wsproxy guidance", async () => {
    const adapter = new NeonServerlessAdapter(
      "postgres://user:pw@localhost:5432/app",
      "localhost:6543/v1",
    );
    const client = getLastClient();
    client.query.mockRejectedValueOnce(new TypeError("failed to fetch"));

    await expect(
      adapter.execute({
        connectionId: "conn-1",
        sql: "select 1",
      }),
    ).rejects.toThrow("Unable to reach the configured wsproxy endpoint");
  });

  it("maps websocket close events with code/reason guidance", async () => {
    const adapter = new NeonServerlessAdapter(
      "postgres://user:pw@localhost:5432/app",
      "localhost:6543/v1",
    );
    const client = getLastClient();
    client.query.mockRejectedValueOnce(
      new CloseEvent("close", {
        code: 1006,
        reason: "Policy violation",
      }),
    );

    await expect(
      adapter.execute({
        connectionId: "conn-1",
        sql: "select 1",
      }),
    ).rejects.toThrow("WebSocket connection closed unexpectedly (code 1006)");
  });

  it("maps protocol mismatch errors with wsproxy checks", async () => {
    const adapter = new NeonServerlessAdapter(
      "postgres://user:pw@localhost:5432/app",
      "localhost:6543/v1",
    );
    const client = getLastClient();
    client.query.mockRejectedValueOnce(
      new Error("invalid frontend message type 112"),
    );

    await expect(
      adapter.execute({
        connectionId: "conn-1",
        sql: "select 1",
      }),
    ).rejects.toThrow("Proxy/Postgres protocol mismatch");
  });
});
