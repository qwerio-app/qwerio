import type { QueryEngine } from "../../core/query-engine";
import { loadConnectionSecret } from "../../core/secret-vault";
import type { ConnectionProfile, ConnectionSecret, QueryRequest, QueryResult } from "../../core/types";
import { PostgresHttpAdapter } from "./providers/postgres-http-adapter";
import { PlanetScaleAdapter } from "./providers/planetscale-adapter";
import type { ProviderAdapter } from "./providers/provider-adapter";

export class BrowserQueryEngine implements QueryEngine {
  private readonly adapters = new Map<string, ProviderAdapter>();

  async connect(connection: ConnectionProfile): Promise<void> {
    if (connection.target.kind !== "web-provider") {
      throw new Error(
        "Selected connection uses desktop TCP. Web mode only supports Web Provider connections.",
      );
    }

    const secret = await loadConnectionSecret(connection.id);

    if (!secret || secret.kind !== "web-provider") {
      throw new Error("Credentials are missing for this web connection. Re-save the connection.");
    }

    const adapter = this.createAdapter(connection, secret);
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

  private createAdapter(connection: ConnectionProfile, secret: ConnectionSecret): ProviderAdapter {
    if (connection.target.kind !== "web-provider" || secret.kind !== "web-provider") {
      throw new Error("Connection profile and secret kind mismatch.");
    }

    switch (connection.target.provider) {
      case "postgres": {
        if (secret.provider !== "postgres") {
          throw new Error("This Postgres HTTP connection is missing a connection string.");
        }

        return new PostgresHttpAdapter(secret.connectionString);
      }
      case "neon": {
        if (secret.provider !== "neon") {
          throw new Error("This Neon connection is missing Neon credentials.");
        }

        return new PostgresHttpAdapter(secret.connectionString);
      }
      case "planetscale": {
        if (secret.provider !== "planetscale") {
          throw new Error("This PlanetScale connection is missing PlanetScale credentials.");
        }

        return new PlanetScaleAdapter(connection.target, {
          username: secret.username,
          password: secret.password,
        });
      }
      default: {
        const exhaustiveCheck: never = connection.target;
        throw new Error(`Unsupported web provider: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }
}
