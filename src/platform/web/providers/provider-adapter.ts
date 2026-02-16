import type { QueryRequest, QueryResult } from "../../../core/types";

export interface ProviderAdapter {
  execute(req: QueryRequest): Promise<QueryResult>;
  listSchemas(): Promise<Array<{ name: string }>>;
  listTables(schema: string): Promise<Array<{ name: string }>>;
}
