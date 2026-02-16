import type { QueryRequest, QueryResult } from "./types";

export interface QueryEngine {
  connect(connectionId: string): Promise<void>;
  execute(req: QueryRequest): Promise<QueryResult>;
  cancel(requestId: string): Promise<void>;
  listSchemas(connectionId: string): Promise<Array<{ name: string }>>;
  listTables(connectionId: string, schema: string): Promise<Array<{ name: string }>>;
}
