import { describe, expect, it } from "vitest";
import {
  buildSchemaExportFileName,
  createSchemaExportArtifact,
  renderDatabaseSchemaMarkdown,
  type ExportedDatabaseSchema,
} from "../../../src/core/schema-export";
import type { ConnectionProfile } from "../../../src/core/types";

const desktopConnection: ConnectionProfile = {
  id: "conn-postgres",
  name: "Product DB",
  type: "personal",
  target: {
    kind: "desktop-tcp",
    dialect: "postgres",
    host: "localhost",
    port: 5432,
    database: "app_core",
    user: "postgres",
  },
  credentials: {
    storage: "none",
  },
  createdAt: "2026-03-12T00:00:00.000Z",
  updatedAt: "2026-03-12T00:00:00.000Z",
};

const postgresExportData: ExportedDatabaseSchema = {
  dialect: "postgres",
  connectionName: "Product DB",
  databaseName: "app_core",
  exportedAt: "2026-03-12T15:30:00.000Z",
  schemas: [
    {
      name: "public",
      tables: [
        {
          name: "users",
          kind: "table",
          description: "Application users",
          definition: null,
          columns: [
            {
              name: "id",
              dataType: "uuid",
              nullable: false,
              defaultValue: "gen_random_uuid()",
              description: null,
            },
            {
              name: "email",
              dataType: "text",
              nullable: false,
              defaultValue: null,
              description: "Primary login address",
            },
          ],
          constraints: [
            {
              name: "users_pkey",
              type: "primary-key",
              definition: "PRIMARY KEY (id)",
            },
          ],
          indexes: [
            {
              name: "users_email_key",
              definition: "CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)",
            },
          ],
          triggers: [
            {
              name: "set_updated_at",
              timing: "BEFORE",
              events: ["UPDATE"],
              action: "EXECUTE FUNCTION set_timestamp()",
            },
          ],
        },
      ],
      views: [
        {
          name: "active_users",
          kind: "view",
          description: null,
          definition: "select id, email from public.users where deleted_at is null",
        },
      ],
      routines: [
        {
          name: "set_timestamp",
          kind: "function",
          arguments: "",
          returnType: "trigger",
          description: null,
        },
      ],
      sequences: [
        {
          name: "audit_log_id_seq",
          dataType: "bigint",
          startValue: "1",
          minimumValue: "1",
          maximumValue: null,
          increment: "1",
          cycle: false,
        },
      ],
      enumTypes: [
        {
          name: "user_role",
          values: ["admin", "member"],
        },
      ],
    },
  ],
};

const mysqlConnection: ConnectionProfile = {
  id: "conn-mysql",
  name: "Commerce DB",
  type: "team",
  target: {
    kind: "web-provider",
    dialect: "mysql",
    provider: "planetscale",
    endpoint: "aws.connect.psdb.cloud",
    username: "app",
  },
  credentials: {
    storage: "none",
  },
  createdAt: "2026-03-12T00:00:00.000Z",
  updatedAt: "2026-03-12T00:00:00.000Z",
};

const mysqlExportData: ExportedDatabaseSchema = {
  dialect: "mysql",
  connectionName: "Commerce DB",
  databaseName: "Commerce DB",
  exportedAt: "2026-03-12T15:30:00.000Z",
  schemas: [
    {
      name: "shop",
      tables: [
        {
          name: "orders",
          kind: "table",
          description: "Customer orders",
          definition: null,
          columns: [
            {
              name: "id",
              dataType: "bigint unsigned",
              nullable: false,
              defaultValue: null,
              description: null,
            },
          ],
          constraints: [
            {
              name: "PRIMARY",
              type: "primary-key",
              definition: "PRIMARY KEY (id)",
            },
          ],
          indexes: [
            {
              name: "idx_customer_id",
              definition: "BTREE (customer_id)",
            },
          ],
          triggers: [],
        },
      ],
      views: [],
      routines: [],
      sequences: [],
      enumTypes: [],
    },
  ],
};

const sqliteConnection: ConnectionProfile = {
  id: "conn-sqlite",
  name: "Local notes",
  type: "personal",
  target: {
    kind: "desktop-tcp",
    dialect: "sqlite",
    database: "/tmp/notes.db",
  },
  credentials: {
    storage: "none",
  },
  createdAt: "2026-03-12T00:00:00.000Z",
  updatedAt: "2026-03-12T00:00:00.000Z",
};

const sqliteExportData: ExportedDatabaseSchema = {
  dialect: "sqlite",
  connectionName: "Local notes",
  databaseName: "/tmp/notes.db",
  exportedAt: "2026-03-12T15:30:00.000Z",
  schemas: [
    {
      name: "main",
      tables: [
        {
          name: "notes",
          kind: "table",
          description: null,
          definition: "CREATE TABLE notes (id integer primary key, title text not null)",
          columns: [
            {
              name: "title",
              dataType: "TEXT",
              nullable: false,
              defaultValue: null,
              description: null,
            },
          ],
          constraints: [],
          indexes: [],
          triggers: [
            {
              name: "notes_updated",
              timing: "custom",
              events: [],
              action: "CREATE TRIGGER notes_updated AFTER UPDATE ON notes BEGIN SELECT 1; END",
            },
          ],
        },
      ],
      views: [],
      routines: [],
      sequences: [],
      enumTypes: [],
    },
  ],
};

describe("schema-export", () => {
  it("renders readable markdown for postgres AI context", () => {
    const markdown = renderDatabaseSchemaMarkdown(postgresExportData);

    expect(markdown).toContain("# Product DB Postgres schema");
    expect(markdown).toContain("## Schema `public`");
    expect(markdown).toContain("#### users");
    expect(markdown).toContain("| email | text | no | - | Primary login address |");
    expect(markdown).toContain("- users_pkey [primary-key]: PRIMARY KEY (id)");
    expect(markdown).toContain("```sql");
    expect(markdown).toContain("- function set_timestamp() -> trigger");
    expect(markdown).toContain("- user_role: admin, member");
  });

  it("builds deterministic export filenames and artifacts", () => {
    const exportedAt = new Date("2026-03-12T15:30:00.000Z");

    expect(buildSchemaExportFileName(desktopConnection, "markdown", exportedAt)).toBe(
      "product-db-app-core-schema-2026-03-12.md",
    );

    const artifact = createSchemaExportArtifact(
      desktopConnection,
      "json",
      postgresExportData,
    );

    expect(artifact.fileName).toBe("product-db-app-core-schema-2026-03-12.json");
    expect(artifact.mimeType).toBe("application/json;charset=utf-8");
    expect(artifact.content).toContain('"databaseName": "app_core"');
  });

  it("renders mysql exports with schema header and table metadata", () => {
    const markdown = renderDatabaseSchemaMarkdown(mysqlExportData);

    expect(markdown).toContain("# Commerce DB MySQL schema");
    expect(markdown).toContain("## Schema `shop`");
    expect(markdown).toContain("#### orders");
    expect(markdown).toContain("- idx_customer_id: BTREE (customer_id)");
    expect(buildSchemaExportFileName(mysqlConnection, "json", new Date("2026-03-12T15:30:00.000Z"))).toBe(
      "commerce-db-commerce-db-schema-2026-03-12.json",
    );
  });

  it("renders sqlite exports with table definitions and triggers", () => {
    const markdown = renderDatabaseSchemaMarkdown(sqliteExportData);

    expect(markdown).toContain("# Local notes SQLite schema");
    expect(markdown).toContain("## Schema `main`");
    expect(markdown).toContain("CREATE TABLE notes");
    expect(markdown).toContain("- notes_updated: custom -> CREATE TRIGGER notes_updated");
    expect(buildSchemaExportFileName(sqliteConnection, "markdown", new Date("2026-03-12T15:30:00.000Z"))).toBe(
      "local-notes-tmp-notes-db-schema-2026-03-12.md",
    );
  });
});
