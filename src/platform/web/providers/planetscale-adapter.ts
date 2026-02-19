import { connect } from "@planetscale/database";
import type { ConnectionTarget, QueryRequest, QueryResult } from "../../../core/types";
import { createEmptySchemaObjectMap, type SchemaObjectMap } from "../../../core/query-engine";
import type { ProviderAdapter } from "./provider-adapter";

type PlanetScaleSecret = {
  username: string;
  password: string;
};

export class PlanetScaleAdapter implements ProviderAdapter {
  private readonly connection;

  constructor(target: Extract<ConnectionTarget, { kind: "web-provider"; provider: "planetscale" }>, secret: PlanetScaleSecret) {
    this.connection = connect({
      host: target.endpoint,
      username: secret.username,
      password: secret.password,
    });
  }

  async execute(req: QueryRequest): Promise<QueryResult> {
    const started = performance.now();
    const result = await this.connection.execute<Record<string, unknown>>(req.sql, req.params ?? []);

    return {
      columns: result.fields.map((field) => ({
        name: field.name,
        dbType: field.type,
        nullable: true,
      })),
      rows: result.rows,
      rowCount: result.rowsAffected || result.rows.length,
      elapsedMs: Math.round(performance.now() - started),
    };
  }

  async listSchemas(): Promise<Array<{ name: string }>> {
    const result = await this.connection.execute<{ name: string }>(
      "SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name",
    );

    return result.rows;
  }

  async listTables(schema: string): Promise<Array<{ name: string }>> {
    const result = await this.connection.execute<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name",
      [schema],
    );

    return result.rows;
  }

  async listSchemaObjects(schema: string): Promise<SchemaObjectMap> {
    const objects = createEmptySchemaObjectMap();
    const [tables, views, functions, procedures, triggers, indexes] = await Promise.all([
      this.listByName(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name",
        [schema],
      ),
      this.listByName(
        "SELECT table_name AS name FROM information_schema.views WHERE table_schema = ? ORDER BY table_name",
        [schema],
      ),
      this.listByName(
        "SELECT DISTINCT routine_name AS name FROM information_schema.routines WHERE routine_schema = ? AND routine_type = 'FUNCTION' ORDER BY routine_name",
        [schema],
      ),
      this.listByName(
        "SELECT DISTINCT routine_name AS name FROM information_schema.routines WHERE routine_schema = ? AND routine_type = 'PROCEDURE' ORDER BY routine_name",
        [schema],
      ),
      this.listByName(
        "SELECT DISTINCT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = ? ORDER BY trigger_name",
        [schema],
      ),
      this.listByName(
        "SELECT DISTINCT CONCAT(table_name, '.', index_name) AS name FROM information_schema.statistics WHERE table_schema = ? AND index_name <> 'PRIMARY' ORDER BY table_name, index_name",
        [schema],
      ),
    ]);

    objects.tables = tables;
    objects.views = views;
    objects.functions = functions;
    objects.procedures = procedures;
    objects.triggers = triggers;
    objects.indexes = indexes;
    // MySQL does not expose schema-local sequences.
    objects.sequences = [];

    return objects;
  }

  private async listByName(sql: string, params: Array<string>): Promise<Array<{ name: string }>> {
    const result = await this.connection.execute<{ name?: unknown }>(sql, params);
    return result.rows
      .map((row) => ({ name: String(row.name ?? "") }))
      .filter((row) => row.name.length > 0);
  }
}
