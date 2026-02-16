import { neon, type FullQueryResults } from "@neondatabase/serverless";
import type { QueryRequest, QueryResult } from "../../../core/types";
import type { ProviderAdapter } from "./provider-adapter";

type NeonResult = FullQueryResults<false>;

export class PostgresHttpAdapter implements ProviderAdapter {
  private readonly sql;

  constructor(connectionString: string) {
    this.validateBrowserConnectivity(connectionString);

    this.sql = neon<false, true>(connectionString, {
      fullResults: true,
      disableWarningInBrowsers: true,
    });
  }

  async execute(req: QueryRequest): Promise<QueryResult> {
    const started = performance.now();
    const result = await this.runQuery(req.sql, req.params ?? []);

    return {
      columns: result.fields.map((field) => ({
        name: field.name,
        dbType: String(field.dataTypeID),
        nullable: true,
      })),
      rows: result.rows as Array<Record<string, unknown>>,
      rowCount: result.rowCount,
      elapsedMs: Math.round(performance.now() - started),
    };
  }

  async listSchemas(): Promise<Array<{ name: string }>> {
    const result = await this.runQuery(
      "SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name",
      [],
    );

    return result.rows as Array<{ name: string }>;
  }

  async listTables(schema: string): Promise<Array<{ name: string }>> {
    const result = await this.runQuery(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
      [schema],
    );

    return result.rows as Array<{ name: string }>;
  }

  private async runQuery(sql: string, params: Array<string | number | boolean | null>): Promise<NeonResult> {
    try {
      return (await this.sql.query(sql, params)) as NeonResult;
    } catch (error) {
      throw new Error(this.toFriendlyError(error));
    }
  }

  private validateBrowserConnectivity(connectionString: string): void {
    let parsed: URL;

    try {
      parsed = new URL(connectionString);
    } catch {
      throw new Error("Invalid Postgres connection string.");
    }

    const host = parsed.hostname.toLowerCase();

    if (this.isLocalhostHost(host)) {
      throw new Error(
        "Browser mode cannot connect directly to localhost Postgres. Use desktop mode, or expose an HTTPS SQL endpoint that supports browser access.",
      );
    }
  }

  private isLocalhostHost(host: string): boolean {
    if (host === "localhost" || host === "::1") {
      return true;
    }

    if (host.startsWith("127.")) {
      return true;
    }

    return false;
  }

  private toFriendlyError(error: unknown): string {
    if (error instanceof TypeError && /failed to fetch/i.test(error.message)) {
      return "Unable to reach the database HTTP endpoint from browser mode. Browser mode cannot use raw Postgres TCP endpoints (including localhost). Use desktop mode or a browser-accessible HTTPS SQL endpoint with CORS.";
    }

    if (error instanceof Error) {
      return `Error connecting to database: ${error.message}`;
    }

    return `Error connecting to database: ${String(error)}`;
  }
}
