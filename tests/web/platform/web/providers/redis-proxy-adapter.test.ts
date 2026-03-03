import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedisProxyAdapter } from "../../../../../src/platform/web/providers/redis-proxy-adapter";

const fetchMock = vi.fn<typeof fetch>();

describe("RedisProxyAdapter", () => {
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

    const adapter = new RedisProxyAdapter(
      {
        endpoint: "default",
        host: "localhost",
        port: 6379,
        database: "0",
      },
      "pw",
      "token-1",
    );

    await adapter.execute({
      connectionId: "conn-1",
      sql: "PING",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/providers/redis/execute",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("sends target/password/auth headers in proxy request", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ name: "public" }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const adapter = new RedisProxyAdapter(
      {
        endpoint: "https://proxy.example.dev/redis/",
        host: "localhost",
        port: 6379,
        database: "0",
        user: "default",
      },
      "pw",
      "token-1",
    );

    await adapter.listSchemas();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://proxy.example.dev/redis/schemas");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer token-1",
      "Content-Type": "application/json",
    });

    const payload = JSON.parse(String(init.body));
    expect(payload.target).toMatchObject({
      host: "localhost",
      port: 6379,
      database: "0",
      user: "default",
    });
    expect(payload.password).toBe("pw");
  });

  it("maps JSON error payload messages", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: ["bad host", "bad auth"] }), {
        status: 400,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const adapter = new RedisProxyAdapter(
      {
        endpoint: "https://proxy.example.dev/redis",
        host: "localhost",
        port: 6379,
        database: "0",
      },
      "pw",
      "token-1",
    );

    await expect(adapter.listSchemas()).rejects.toThrow("bad host. bad auth");
  });

  it("maps text error payload when response is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("connection refused", {
        status: 502,
        headers: {
          "content-type": "text/plain",
        },
      }),
    );

    const adapter = new RedisProxyAdapter(
      {
        endpoint: "https://proxy.example.dev/redis",
        host: "localhost",
        port: 6379,
        database: "0",
      },
      "pw",
      "token-1",
    );

    await expect(adapter.execute({ connectionId: "conn-1", sql: "PING" })).rejects.toThrow(
      "connection refused",
    );
  });
});
