import type { RuntimeMode } from "./runtime";

export type DbDialect = "postgres" | "mysql" | "sqlserver" | "sqlite";

export type ConnectionProfileType = "personal" | "team";

export type DesktopConnectionTarget =
  | {
      kind: "desktop-tcp";
      dialect: "postgres" | "mysql" | "sqlserver";
      host: string;
      port: number;
      database: string;
      user: string;
    }
  | {
      kind: "desktop-tcp";
      dialect: "sqlite";
      database: string;
    };

export type ConnectionTarget =
  | DesktopConnectionTarget
  | {
      kind: "web-provider";
      dialect: "postgres";
      provider: "neon";
      endpoint: string;
      connectionStringTemplate: string;
      projectId?: string;
    }
  | {
      kind: "web-provider";
      dialect: "postgres";
      provider: "proxy";
      endpoint: string;
      connectionStringTemplate: string;
      projectId?: string;
    }
  | {
      kind: "web-provider";
      dialect: "mysql";
      provider: "planetscale";
      endpoint: string;
      username: string;
      projectId?: string;
    };

export type EncryptedConnectionPassword = {
  version: 1;
  algorithm: "aes-gcm";
  kdf: "pbkdf2-sha256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

export type ConnectionCredentials =
  | {
      storage: "none";
    }
  | {
      storage: "plain";
      password: string;
    }
  | {
      storage: "encrypted";
      envelope: EncryptedConnectionPassword;
    };

export type ConnectionProfile = {
  id: string;
  name: string;
  type: ConnectionProfileType;
  target: ConnectionTarget;
  credentials: ConnectionCredentials;
  showInternalSchemas?: boolean;
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
