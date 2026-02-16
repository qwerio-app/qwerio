import type { RuntimeMode } from "./runtime";

export type DbDialect = "postgres" | "mysql";

export type ConnectionTarget =
  | {
      kind: "desktop-tcp";
      dialect: DbDialect;
      host: string;
      port: number;
      database: string;
      user: string;
    }
  | {
      kind: "web-provider";
      dialect: DbDialect;
      provider: string;
      endpoint: string;
      projectId?: string;
    };

export type ConnectionProfile = {
  id: string;
  name: string;
  target: ConnectionTarget;
  createdAt: string;
  updatedAt: string;
};

export type QueryRequest = {
  connectionId: string;
  sql: string;
  params?: Array<string | number | boolean | null>;
  limit?: number;
  cursor?: string;
};

export type QueryResult = {
  columns: Array<{ name: string; dbType: string; nullable: boolean }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  nextCursor?: string;
  elapsedMs: number;
};

export type RuntimeCapabilities = {
  runtimeMode: RuntimeMode;
  supportsCancel: boolean;
  supportsDesktopTcp: boolean;
};
