import type { QueryRequest, QueryResult } from "../../../core/types";
import { createEmptySchemaObjectMap, type SchemaObjectMap } from "../../../core/query-engine";
import type { ProviderAdapter } from "./provider-adapter";

type RedisProxyTarget = {
  endpoint: string;
  host: string;
  port: number;
  database: string;
  user?: string;
};

function resolveEndpoint(rawEndpoint: string): string {
  const value = rawEndpoint.trim();

  if (!value || value === "default") {
    return "/api/providers/redis";
  }

  return value.replace(/\/+$/, "");
}

async function parseErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as { message?: unknown };
      if (typeof payload.message === "string") {
        return payload.message;
      }

      if (Array.isArray(payload.message)) {
        const combined = payload.message
          .filter((entry): entry is string => typeof entry === "string")
          .join(". ");

        if (combined.length > 0) {
          return combined;
        }
      }
    } catch {
      return fallback;
    }
  }

  try {
    const text = await response.text();
    return text.trim().length > 0 ? text : fallback;
  } catch {
    return fallback;
  }
}

export class RedisProxyAdapter implements ProviderAdapter {
  private readonly endpoint: string;
  private readonly target: RedisProxyTarget;
  private readonly password: string;
  private readonly accessToken: string;

  constructor(target: RedisProxyTarget, password: string, accessToken: string) {
    this.endpoint = resolveEndpoint(target.endpoint);
    this.target = target;
    this.password = password;
    this.accessToken = accessToken;
  }

  async connect(): Promise<void> {
    await this.request<void>("/connect", {});
  }

  async execute(req: QueryRequest): Promise<QueryResult> {
    return this.request<QueryResult>("/execute", {
      sql: req.sql,
      params: req.params ?? [],
    });
  }

  async listSchemas(): Promise<Array<{ name: string }>> {
    return this.request<Array<{ name: string }>>("/schemas", {});
  }

  async listTables(schema: string): Promise<Array<{ name: string }>> {
    const objects = await this.listSchemaObjects(schema);
    return objects.tables;
  }

  async listSchemaObjects(schema: string): Promise<SchemaObjectMap> {
    const objects = await this.request<Partial<SchemaObjectMap>>(
      "/schema-objects",
      { schema },
    );

    return {
      ...createEmptySchemaObjectMap(),
      ...objects,
    };
  }

  private async request<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${this.endpoint}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify({
          target: this.target,
          password: this.password,
          ...payload,
        }),
      });
    } catch {
      throw new Error(
        "Unable to reach Redis proxy from browser mode. Verify proxy endpoint and network reachability.",
      );
    }

    if (!response.ok) {
      throw new Error(
        await parseErrorMessage(
          response,
          `Redis proxy request failed with status ${response.status}.`,
        ),
      );
    }

    return (await response.json()) as T;
  }
}
