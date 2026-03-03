import { beforeEach, describe, expect, it, vi } from "vitest";
import { MongoProxyAdapter } from "../../../../../src/platform/web/providers/mongo-proxy-adapter";

const fetchMock = vi.fn<typeof fetch>();

describe("MongoProxyAdapter", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uses default endpoint for blank/default target endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ columns: [], rows: [], rowCount: 0, elapsedMs: 1 }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const adapter = new MongoProxyAdapter(
      {
        endpoint: "",
        host: "localhost",
        port: 27017,
        database: "admin",
      },
      "pw",
      "token-1",
    );

    await adapter.execute({
      connectionId: "conn-1",
      sql: "db.stats()",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/providers/mongodb/execute",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("sends target/password/auth headers in proxy request", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ name: "admin" }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const adapter = new MongoProxyAdapter(
      {
        endpoint: "https://proxy.example.dev/mongo/",
        host: "localhost",
        port: 27017,
        database: "admin",
        user: "root",
      },
      "pw",
      "token-1",
    );

    await adapter.listSchemas();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://proxy.example.dev/mongo/schemas");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer token-1",
      "Content-Type": "application/json",
    });

    const payload = JSON.parse(String(init.body));
    expect(payload.target).toMatchObject({
      host: "localhost",
      port: 27017,
      database: "admin",
      user: "root",
    });
    expect(payload.password).toBe("pw");
  });

  it("maps JSON and text errors to user-facing messages", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "invalid auth" }), {
          status: 401,
          headers: {
            "content-type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response("upstream timeout", {
          status: 504,
          headers: {
            "content-type": "text/plain",
          },
        }),
      );

    const adapter = new MongoProxyAdapter(
      {
        endpoint: "https://proxy.example.dev/mongo",
        host: "localhost",
        port: 27017,
        database: "admin",
      },
      "pw",
      "token-1",
    );

    await expect(adapter.listSchemas()).rejects.toThrow("invalid auth");
    await expect(
      adapter.execute({ connectionId: "conn-1", sql: "db.stats()" }),
    ).rejects.toThrow("upstream timeout");
  });
});
