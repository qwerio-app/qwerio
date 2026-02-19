import type { QueryEngine } from "../../core/query-engine";
import type { SchemaObjectMap } from "../../core/query-engine";
import type { ConnectionProfile, QueryRequest, QueryResult } from "../../core/types";

async function tauriInvoke<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, payload);
}

export class TauriQueryEngine implements QueryEngine {
  async connect(connection: ConnectionProfile): Promise<void> {
    if (connection.target.kind !== "desktop-tcp") {
      throw new Error("Desktop runtime requires a desktop-tcp connection profile.");
    }

    await tauriInvoke<void>("db_connect", {
      connection: {
        id: connection.id,
        dialect: connection.target.dialect,
        host: connection.target.host,
        port: connection.target.port,
        database: connection.target.database,
        user: connection.target.user,
      },
    });
  }

  async execute(req: QueryRequest): Promise<QueryResult> {
    return tauriInvoke<QueryResult>("db_execute", { req });
  }

  async cancel(requestId: string): Promise<void> {
    await tauriInvoke<void>("db_cancel", { requestId });
  }

  async listSchemas(connectionId: string): Promise<Array<{ name: string }>> {
    return tauriInvoke<Array<{ name: string }>>("db_list_schemas", { connectionId });
  }

  async listTables(connectionId: string, schema: string): Promise<Array<{ name: string }>> {
    return tauriInvoke<Array<{ name: string }>>("db_list_tables", { connectionId, schema });
  }

  async listSchemaObjects(connectionId: string, schema: string): Promise<SchemaObjectMap> {
    return tauriInvoke<SchemaObjectMap>("db_list_schema_objects", { connectionId, schema });
  }
}
