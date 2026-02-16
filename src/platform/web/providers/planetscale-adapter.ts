import { connect } from "@planetscale/database";
import type { ConnectionTarget, QueryRequest, QueryResult } from "../../../core/types";
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
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name",
      [schema],
    );

    return result.rows;
  }
}
