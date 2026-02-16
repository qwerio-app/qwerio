import type { QueryEngine } from "../../core/query-engine";
import type { QueryRequest, QueryResult } from "../../core/types";

const MOCK_SCHEMAS = [{ name: "public" }, { name: "analytics" }];

const MOCK_TABLES: Record<string, Array<{ name: string }>> = {
  public: [{ name: "users" }, { name: "projects" }, { name: "sessions" }],
  analytics: [{ name: "query_logs" }, { name: "daily_rollups" }],
};

export class BrowserQueryEngine implements QueryEngine {
  async connect(_connectionId: string): Promise<void> {
    return Promise.resolve();
  }

  async execute(req: QueryRequest): Promise<QueryResult> {
    const started = performance.now();
    const trimmed = req.sql.trim().toLowerCase();

    if (!trimmed.startsWith("select")) {
      return {
        columns: [{ name: "status", dbType: "text", nullable: false }],
        rows: [{ status: "Only SELECT statements are enabled in browser mock mode." }],
        rowCount: 1,
        elapsedMs: Math.round(performance.now() - started),
      };
    }

    return {
      columns: [
        { name: "id", dbType: "int", nullable: false },
        { name: "name", dbType: "text", nullable: false },
        { name: "dialect", dbType: "text", nullable: false },
      ],
      rows: [
        { id: 1, name: "Acme Corp", dialect: "postgres" },
        { id: 2, name: "Nova Labs", dialect: "mysql" },
      ],
      rowCount: 2,
      elapsedMs: Math.round(performance.now() - started),
    };
  }

  async cancel(_requestId: string): Promise<void> {
    return Promise.resolve();
  }

  async listSchemas(_connectionId: string): Promise<Array<{ name: string }>> {
    return MOCK_SCHEMAS;
  }

  async listTables(_connectionId: string, schema: string): Promise<Array<{ name: string }>> {
    return MOCK_TABLES[schema] ?? [];
  }
}
