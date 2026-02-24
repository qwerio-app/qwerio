import type { ConnectionCredentials, ConnectionTarget } from "./types";

const DEFAULT_API_BASE_URL = "/api";

export type SyncConnectionCredentials =
  | {
      storage: "none";
    }
  | {
      storage: "encrypted";
      envelope: Extract<ConnectionCredentials, { storage: "encrypted" }>['envelope'];
    };

export type SyncConnectionType = "personal" | "team";

export type SyncConnectionRecord = {
  id: string;
  name: string;
  type: SyncConnectionType;
  target: ConnectionTarget;
  credentials: SyncConnectionCredentials;
  showInternalSchemas: boolean;
  clientUpdatedAt: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncPushUpsertPayload = {
  clientConnectionId: string;
  serverConnectionId?: string;
  name: string;
  type: SyncConnectionType;
  target: ConnectionTarget;
  credentials: SyncConnectionCredentials;
  showInternalSchemas?: boolean;
  clientUpdatedAt: string;
};

export type SyncPushDeletionPayload = {
  serverConnectionId: string;
  deletedAt: string;
};

export type SyncPushRequest = {
  upserts: SyncPushUpsertPayload[];
  deletions: SyncPushDeletionPayload[];
};

export type SyncPushResponse = {
  cursor: string;
  acceptedUpserts: Array<{
    clientConnectionId: string;
    connection: SyncConnectionRecord;
  }>;
  acceptedDeletions: Array<{
    serverConnectionId: string;
    deletedAt: string;
  }>;
  rejected: Array<{
    reason: string;
    clientConnectionId?: string;
    serverConnectionId?: string;
  }>;
};

export type SyncChangesResponse = {
  cursor: string;
  upserts: SyncConnectionRecord[];
  deletions: Array<{
    serverConnectionId: string;
    deletedAt: string;
  }>;
};

function resolveApiBaseUrl(): string {
  const configuredValue = import.meta.env.VITE_QWERIO_API_BASE_URL?.trim();

  if (!configuredValue) {
    return DEFAULT_API_BASE_URL;
  }

  if (/^https?:\/\//i.test(configuredValue)) {
    return configuredValue.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    return new URL(configuredValue, window.location.origin).toString().replace(/\/+$/, "");
  }

  return configuredValue.replace(/\/+$/, "");
}

function toApiUrl(pathname: string): string {
  const base = resolveApiBaseUrl();
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function toErrorMessage(payload: unknown, fallback: string): string {
  if (!payload) {
    return fallback;
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;

    if (typeof message === "string") {
      return message;
    }

    if (Array.isArray(message) && message.length > 0) {
      return message
        .filter((entry): entry is string => typeof entry === "string")
        .join(". ");
    }
  }

  return fallback;
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (isJson) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text = await response.text();
  return text.trim().length > 0 ? text : null;
}

async function requestJson<T>(
  pathname: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(toApiUrl(pathname), {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new Error(
      "Unable to reach sync service. Confirm qwerio-api is running and reachable from this app origin.",
    );
  }

  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    throw new Error(
      toErrorMessage(
        payload,
        `Connection sync request failed with status ${response.status}.`,
      ),
    );
  }

  return payload as T;
}

export async function pushConnectionSync(
  accessToken: string,
  payload: SyncPushRequest,
): Promise<SyncPushResponse> {
  return requestJson<SyncPushResponse>("/connections/sync/push", accessToken, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function getConnectionSyncChanges(
  accessToken: string,
  since?: string,
): Promise<SyncChangesResponse> {
  const params = new URLSearchParams();

  if (since && since.trim().length > 0) {
    params.set("since", since.trim());
  }

  const path =
    params.size > 0
      ? `/connections/sync/changes?${params.toString()}`
      : "/connections/sync/changes";

  return requestJson<SyncChangesResponse>(path, accessToken, {
    method: "GET",
  });
}
