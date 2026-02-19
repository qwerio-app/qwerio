import type { QueryRequest, QueryResult } from "../../../core/types";
import type { SchemaObjectMap } from "../../../core/query-engine";

export interface ProviderAdapter {
  execute(req: QueryRequest): Promise<QueryResult>;
  listSchemas(): Promise<Array<{ name: string }>>;
  listTables(schema: string): Promise<Array<{ name: string }>>;
  listSchemaObjects(schema: string): Promise<SchemaObjectMap>;
}
