import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, connectMock } = vi.hoisted(() => {
  const executeMock = vi.fn();
  const connectMock = vi.fn(() => ({
    execute: executeMock,
  }));

  return {
    executeMock,
    connectMock,
  };
});

vi.mock("@planetscale/database", () => ({
  connect: connectMock,
}));

import { PlanetScaleAdapter } from "../../../../../src/platform/web/providers/planetscale-adapter";

describe("PlanetScaleAdapter", () => {
  beforeEach(() => {
    connectMock.mockClear();
    executeMock.mockReset();
  });

  it("passes endpoint and credentials to connect", () => {
    new PlanetScaleAdapter(
      {
        kind: "web-provider",
        dialect: "mysql",
        provider: "planetscale",
        endpoint: "aws.connect.psdb.cloud",
        username: "app-user",
      },
      {
        username: "app-user",
        password: "pw",
      },
    );

    expect(connectMock).toHaveBeenCalledWith({
      host: "aws.connect.psdb.cloud",
      username: "app-user",
      password: "pw",
    });
  });

  it("maps query responses into QueryResult", async () => {
    executeMock.mockResolvedValueOnce({
      fields: [{ name: "id", type: "INT" }],
      rows: [{ id: 1 }],
      rowsAffected: 1,
    });

    const adapter = new PlanetScaleAdapter(
      {
        kind: "web-provider",
        dialect: "mysql",
        provider: "planetscale",
        endpoint: "aws.connect.psdb.cloud",
        username: "app-user",
      },
      {
        username: "app-user",
        password: "pw",
      },
    );

    await expect(
      adapter.execute({
        connectionId: "conn-1",
        sql: "select 1",
      }),
    ).resolves.toMatchObject({
      columns: [{ name: "id", dbType: "INT", nullable: true }],
      rows: [{ id: 1 }],
      rowCount: 1,
    });
  });

  it("builds schema object map from listByName queries", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [{ name: "users" }] })
      .mockResolvedValueOnce({ rows: [{ name: "users_view" }] })
      .mockResolvedValueOnce({ rows: [{ name: "f_users" }] })
      .mockResolvedValueOnce({ rows: [{ name: "p_users" }] })
      .mockResolvedValueOnce({ rows: [{ name: "tr_users" }] })
      .mockResolvedValueOnce({ rows: [{ name: "users.idx_users" }] });

    const adapter = new PlanetScaleAdapter(
      {
        kind: "web-provider",
        dialect: "mysql",
        provider: "planetscale",
        endpoint: "aws.connect.psdb.cloud",
        username: "app-user",
      },
      {
        username: "app-user",
        password: "pw",
      },
    );

    const objects = await adapter.listSchemaObjects("public");

    expect(objects.tables).toEqual([{ name: "users" }]);
    expect(objects.views).toEqual([{ name: "users_view" }]);
    expect(objects.functions).toEqual([{ name: "f_users" }]);
    expect(objects.procedures).toEqual([{ name: "p_users" }]);
    expect(objects.triggers).toEqual([{ name: "tr_users" }]);
    expect(objects.indexes).toEqual([{ name: "users.idx_users" }]);
    expect(objects.sequences).toEqual([]);
  });
});
