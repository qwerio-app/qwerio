import type { QueryEngine } from "../../core/query-engine";
import type { SchemaObjectMap } from "../../core/query-engine";
import { resolveConnectionPassword } from "../../core/connection-secrets";
import { loadValidAuthSessionFromStorage } from "../../core/auth-session";
import type { ConnectionProfile, QueryRequest, QueryResult } from "../../core/types";
import { NeonServerlessAdapter } from "./providers/neon-adapter";
import { PlanetScaleAdapter } from "./providers/planetscale-adapter";
import { ProxyAdapter } from "./providers/proxy-adapter";
import type { ProviderAdapter } from "./providers/provider-adapter";

function withConnectionStringPassword(
  connectionStringTemplate: string,
  password?: string,
): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(connectionStringTemplate);
  } catch {
    throw new Error("Connection string is invalid. Edit this connection and save again.");
  }

  parsedUrl.password = password ?? "";
  return parsedUrl.toString();
}

export class BrowserQueryEngine implements QueryEngine {
  private readonly adapters = new Map<string, ProviderAdapter>();

  async connect(connection: ConnectionProfile): Promise<void> {
    if (connection.target.kind !== "web-provider") {
      throw new Error(
        "Selected connection uses desktop TCP. Web mode only supports Web Provider connections.",
      );
    }

    const password = await resolveConnectionPassword(connection);
    const adapter = await this.createAdapter(connection, password);
    this.adapters.set(connection.id, adapter);
  }

  async execute(req: QueryRequest): Promise<QueryResult> {
    const adapter = this.adapters.get(req.connectionId);

    if (!adapter) {
      throw new Error("Connection is not initialized. Connect first.");
    }

    return adapter.execute(req);
  }

  async cancel(_requestId: string): Promise<void> {
    throw new Error("Query cancellation is provider-dependent and not implemented yet.");
  }

  async listSchemas(connectionId: string): Promise<Array<{ name: string }>> {
    const adapter = this.adapters.get(connectionId);

    if (!adapter) {
      throw new Error("Connection is not initialized. Connect first.");
    }

    return adapter.listSchemas();
  }

  async listTables(connectionId: string, schema: string): Promise<Array<{ name: string }>> {
    const adapter = this.adapters.get(connectionId);

    if (!adapter) {
      throw new Error("Connection is not initialized. Connect first.");
    }

    return adapter.listTables(schema);
  }

  async listSchemaObjects(connectionId: string, schema: string): Promise<SchemaObjectMap> {
    const adapter = this.adapters.get(connectionId);

    if (!adapter) {
      throw new Error("Connection is not initialized. Connect first.");
    }

    return adapter.listSchemaObjects(schema);
  }

  private async createAdapter(connection: ConnectionProfile, password?: string): Promise<ProviderAdapter> {
    if (connection.target.kind !== "web-provider") {
      throw new Error("Connection profile kind mismatch.");
    }

    switch (connection.target.provider) {
      case "neon": {
        return new NeonServerlessAdapter(
          withConnectionStringPassword(
            connection.target.connectionStringTemplate,
            password,
          ),
          connection.target.endpoint,
        );
      }
      case "proxy": {
        const session = await loadValidAuthSessionFromStorage();

        if (!session) {
          throw new Error(
            "Sign in is required for Proxy provider connections. Use the login button in the header and try again.",
          );
        }

        return new ProxyAdapter(
          withConnectionStringPassword(
            connection.target.connectionStringTemplate,
            password,
          ),
          connection.target.endpoint,
          session.accessToken,
        );
      }
      case "planetscale": {
        return new PlanetScaleAdapter(connection.target, {
          username: connection.target.username,
          password: password ?? "",
        });
      }
      default: {
        const exhaustiveCheck: never = connection.target;
        throw new Error(`Unsupported web provider: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }
}
