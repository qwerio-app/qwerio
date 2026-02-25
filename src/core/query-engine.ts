import type {
  ConnectionProfile,
  DesktopPostgresTlsMode,
  QueryRequest,
  QueryResult,
} from "./types";

export type SchemaObject = { name: string };

export type SchemaObjectKind =
  | "tables"
  | "views"
  | "functions"
  | "triggers"
  | "indexes"
  | "procedures"
  | "sequences";

export type SchemaObjectMap = Record<SchemaObjectKind, SchemaObject[]>;

export function createEmptySchemaObjectMap(): SchemaObjectMap {
  return {
    tables: [],
    views: [],
    functions: [],
    triggers: [],
    indexes: [],
    procedures: [],
    sequences: [],
  };
}

export interface QueryEngine {
  connect(connection: ConnectionProfile): Promise<{
    resolvedDesktopTlsMode?: DesktopPostgresTlsMode;
  }>;
  execute(req: QueryRequest): Promise<QueryResult>;
  cancel(requestId: string): Promise<void>;
  listSchemas(connectionId: string): Promise<Array<{ name: string }>>;
  listTables(connectionId: string, schema: string): Promise<Array<{ name: string }>>;
  listSchemaObjects(connectionId: string, schema: string): Promise<SchemaObjectMap>;
}
