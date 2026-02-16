import type { QueryEngine } from "../../core/query-engine";
import type { QueryRequest, QueryResult } from "../../core/types";

async function tauriInvoke<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, payload);
}

export class TauriQueryEngine implements QueryEngine {
  async connect(connectionId: string): Promise<void> {
    await tauriInvoke<void>("db_connect", { connectionId });
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
}
