import type { QueryEngine } from "../../core/query-engine";
import type { SchemaObjectMap } from "../../core/query-engine";
import { resolveConnectionPassword } from "../../core/connection-secrets";
import { toErrorMessage } from "../../core/error-message";
import type {
  ConnectionProfile,
  DesktopPostgresTlsMode,
  QueryRequest,
  QueryResult,
} from "../../core/types";

function withDesktopConnectGuidance(
  command: string,
  payload: Record<string, unknown>,
  message: string,
): string {
  if (command !== "db_connect") {
    return message;
  }

  const lower = message.toLowerCase();
  const looksLikeTlsIssue =
    lower.includes("tls") ||
    lower.includes("ssl") ||
    lower.includes("certificate") ||
    lower.includes("handshake") ||
    lower.includes("secure transport") ||
    lower.includes("requires encryption") ||
    lower.includes("encrypted connection");

  if (!looksLikeTlsIssue) {
    return message;
  }

  const connection = payload.connection as
    | {
        dialect?: unknown;
      }
    | undefined;
  const dialect =
    connection && typeof connection.dialect === "string"
      ? connection.dialect
      : "";

  if (dialect === "postgres") {
    return `${message} Checks: desktop Postgres attempts verified TLS, then TLS with invalid-cert acceptance, then non-TLS fallback. Verify server SSL policy and hostname settings.`;
  }

  return `${message} Checks: verify server SSL/TLS requirements, certificates, and whether this driver/path supports your required TLS mode.`;
}

async function tauriInvoke<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");

  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    const baseMessage = toErrorMessage(error, `Desktop command '${command}' failed.`);
    const message = withDesktopConnectGuidance(command, payload, baseMessage);
    throw new Error(message);
  }
}

export class TauriQueryEngine implements QueryEngine {
  async connect(connection: ConnectionProfile): Promise<{
    resolvedDesktopTlsMode?: DesktopPostgresTlsMode;
  }> {
    if (connection.target.kind !== "desktop-tcp") {
      throw new Error("Desktop runtime requires a desktop-tcp connection profile.");
    }

    const password = await resolveConnectionPassword(connection);
    const baseConnection = {
      id: connection.id,
      dialect: connection.target.dialect,
      database: connection.target.database,
      password,
    };

    const result = await tauriInvoke<{
      resolvedTlsMode?: DesktopPostgresTlsMode;
    }>("db_connect", {
      connection:
        connection.target.dialect === "sqlite"
          ? baseConnection
          : {
              ...baseConnection,
              host: connection.target.host,
              port: connection.target.port,
              ...(connection.target.dialect === "postgres" &&
              typeof connection.target.tlsMode === "string"
                ? { preferredTlsMode: connection.target.tlsMode }
                : {}),
              ...(typeof connection.target.user === "string"
                ? { user: connection.target.user }
                : {}),
            },
    });

    return {
      resolvedDesktopTlsMode: result.resolvedTlsMode,
    };
  }

  async execute(req: QueryRequest): Promise<QueryResult> {
    return tauriInvoke<QueryResult>("db_execute", { req });
  }

  async cancel(requestId: string): Promise<void> {
    await tauriInvoke<void>("db_cancel", { requestId });
  }

  async listSchemas(connectionId: string): Promise<Array<{ name: string }>> {
    return tauriInvoke<Array<{ name: string }>>("db_list_schemas", { connectionId });
  }

  async listTables(connectionId: string, schema: string): Promise<Array<{ name: string }>> {
    return tauriInvoke<Array<{ name: string }>>("db_list_tables", { connectionId, schema });
  }

  async listSchemaObjects(connectionId: string, schema: string): Promise<SchemaObjectMap> {
    return tauriInvoke<SchemaObjectMap>("db_list_schema_objects", { connectionId, schema });
  }
}
