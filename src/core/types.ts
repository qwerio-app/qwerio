import type { RuntimeMode } from "./runtime";

export type DbDialect =
  | "postgres"
  | "mysql"
  | "sqlserver"
  | "sqlite"
  | "redis"
  | "mongodb";

export type ConnectionProfileType = "personal" | "team";
export type DesktopPostgresTlsMode =
  | "tls-verified-cert"
  | "tls-allow-invalid-cert"
  | "non-tls";

export type DesktopConnectionTarget =
  | {
      kind: "desktop-tcp";
      dialect: "postgres";
      host: string;
      port: number;
      database: string;
      user: string;
      tlsMode?: DesktopPostgresTlsMode;
    }
  | {
      kind: "desktop-tcp";
      dialect: "mysql" | "sqlserver";
      host: string;
      port: number;
      database: string;
      user: string;
    }
  | {
      kind: "desktop-tcp";
      dialect: "sqlite";
      database: string;
    }
  | {
      kind: "desktop-tcp";
      dialect: "redis";
      host: string;
      port: number;
      database: string;
      user?: string;
    }
  | {
      kind: "desktop-tcp";
      dialect: "mongodb";
      host: string;
      port: number;
      database: string;
      user?: string;
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
    }
  | {
      kind: "web-provider";
      dialect: "redis";
      provider: "redis-proxy";
      endpoint: string;
      host: string;
      port: number;
      database: string;
      user?: string;
      projectId?: string;
    }
  | {
      kind: "web-provider";
      dialect: "mongodb";
      provider: "mongo-proxy";
      endpoint: string;
      host: string;
      port: number;
      database: string;
      user?: string;
      projectId?: string;
    };

export type DataObjectType =
  | "table"
  | "view"
  | "collection"
  | "redis-string"
  | "redis-hash"
  | "redis-list"
  | "redis-set"
  | "redis-zset"
  | "redis-stream"
  | "redis-key";

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
  sync?: {
    enabled: boolean;
    serverId?: string;
    lastSyncedAt?: string;
  };
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
