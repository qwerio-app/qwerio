import { getVariableValue, setVariableValue } from "./storage/indexed-db";
import type { AuthResult, AuthSession, AuthenticatedUser } from "./auth-types";

const AUTH_SESSION_KEY = "variables.auth.session";

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toAuthenticatedUser(value: unknown): AuthenticatedUser | null {
  const record = toRecord(value);

  if (!record) {
    return null;
  }

  const id = toStringOrNull(record.id);

  if (!id) {
    return null;
  }

  const email = toStringOrNull(record.email);
  const displayName = toStringOrNull(record.displayName);

  return {
    id,
    email,
    displayName,
  };
}

export function parseAuthSession(value: unknown): AuthSession | null {
  const record = toRecord(value);

  if (!record) {
    return null;
  }

  const accessToken = toStringOrNull(record.accessToken);
  const expiresAt = toStringOrNull(record.expiresAt);
  const user = toAuthenticatedUser(record.user);

  if (!accessToken || !expiresAt || !user) {
    return null;
  }

  return {
    accessToken,
    expiresAt,
    user,
  };
}

export function isAuthSessionExpired(session: AuthSession): boolean {
  const expiresAt = Date.parse(session.expiresAt);

  if (Number.isNaN(expiresAt)) {
    return true;
  }

  return expiresAt <= Date.now();
}

export function toAuthSession(result: AuthResult): AuthSession {
  return {
    accessToken: result.accessToken,
    expiresAt: result.expiresAt,
    user: result.user,
  };
}

export async function loadAuthSessionFromStorage(): Promise<AuthSession | null> {
  const value = await getVariableValue<unknown>(AUTH_SESSION_KEY, null);
  return parseAuthSession(value);
}

export async function loadValidAuthSessionFromStorage(): Promise<AuthSession | null> {
  const session = await loadAuthSessionFromStorage();

  if (!session || isAuthSessionExpired(session)) {
    return null;
  }

  return session;
}

export async function saveAuthSessionToStorage(
  session: AuthSession | null,
): Promise<void> {
  await setVariableValue(AUTH_SESSION_KEY, session);
}
