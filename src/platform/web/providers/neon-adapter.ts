import { Client } from "@neondatabase/serverless";
import type { QueryRequest, QueryResult } from "../../../core/types";
import type { ProviderAdapter } from "./provider-adapter";

type NeonResult = {
  fields: Array<{ name: string; dataTypeID: number }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
};

export class NeonServerlessAdapter implements ProviderAdapter {
  private readonly client: Client;
  private connectPromise: Promise<void> | null = null;
  private wsProxyHint = "default Neon proxy";

  constructor(connectionString: string, wsProxyEndpoint?: string) {
    this.validateConnectionString(connectionString);
    this.client = new Client(connectionString);
    this.configureWsProxy(wsProxyEndpoint);
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
      rowCount: result.rowCount ?? result.rows.length,
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
      await this.ensureConnected();
      return (await this.client.query(sql, params)) as NeonResult;
    } catch (error) {
      throw new Error(this.toFriendlyError(error));
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.client.connect().catch((error) => {
      this.connectPromise = null;
      throw error;
    });

    return this.connectPromise;
  }

  private validateConnectionString(connectionString: string): void {
    try {
      // Validate user input early for cleaner feedback.
      new URL(connectionString);
    } catch {
      throw new Error("Invalid Postgres connection string.");
    }
  }

  private configureWsProxy(wsProxyEndpoint?: string): void {
    const normalized = this.normalizeWsProxyEndpoint(wsProxyEndpoint);

    if (!normalized) {
      return;
    }

    this.client.neonConfig.wsProxy = normalized.address;
    this.client.neonConfig.useSecureWebSocket = normalized.secure;
    this.wsProxyHint = normalized.address;
  }

  private normalizeWsProxyEndpoint(
    rawEndpoint?: string,
  ): { address: string; secure: boolean } | null {
    const value = rawEndpoint?.trim();

    if (!value || value === "default" || value === "neon-http") {
      return null;
    }

    if (/^wss?:\/\//i.test(value) || /^https?:\/\//i.test(value)) {
      const url = new URL(value);
      const secure = url.protocol === "wss:" || url.protocol === "https:";
      const address = `${url.host}${url.pathname}${url.search}`.replace(/\/+$/, "");
      return {
        address,
        secure,
      };
    }

    const address = value.replace(/\/+$/, "");
    const host = this.extractHost(address);

    return {
      address,
      secure: !this.isLocalHost(host),
    };
  }

  private extractHost(address: string): string {
    const authority = address.split("/")[0]?.split("?")[0] ?? "";

    if (authority.startsWith("[")) {
      const ipv6End = authority.indexOf("]");

      if (ipv6End > 1) {
        return authority.slice(1, ipv6End).toLowerCase();
      }
    }

    return authority.split(":")[0]?.toLowerCase() ?? "";
  }

  private isLocalHost(host: string): boolean {
    return host === "localhost" || host === "::1" || host.startsWith("127.");
  }

  private toFriendlyError(error: unknown): string {
    if (error instanceof TypeError && /failed to fetch/i.test(error.message)) {
      return "Unable to reach the configured wsproxy endpoint from browser mode. Verify wsproxy is running and accessible from this origin.";
    }

    if (this.isCloseEvent(error)) {
      const code = error.code ? ` (code ${error.code})` : "";
      const reason = error.reason ? ` Reason: ${error.reason}` : "";
      return `WebSocket connection closed unexpectedly${code}.${reason} Verify wsproxy endpoint '${this.wsProxyHint}', database host/port, and wsproxy ALLOW_ADDR_REGEX.`;
    }

    if (this.isBrowserEvent(error)) {
      const eventType = error.type ? ` (${error.type})` : "";
      return `WebSocket connection failed${eventType}. Verify wsproxy endpoint '${this.wsProxyHint}' is reachable from this browser and allows this origin.`;
    }

    if (error instanceof Error && /No WebSocket proxy is configured/i.test(error.message)) {
      return "WebSocket proxy is not configured. Set a wsproxy endpoint (for example localhost:6543/v1) on this Neon profile.";
    }

    if (error instanceof Error) {
      return `Database connection failed: ${error.message}`;
    }

    return `Database connection failed: ${String(error)}`;
  }

  private isBrowserEvent(error: unknown): error is Event {
    return typeof Event !== "undefined" && error instanceof Event;
  }

  private isCloseEvent(error: unknown): error is CloseEvent {
    return typeof CloseEvent !== "undefined" && error instanceof CloseEvent;
  }
}
