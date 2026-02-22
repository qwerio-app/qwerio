import { decryptConnectionPassword } from "./secret-vault";
import type { ConnectionProfile } from "./types";

const sessionPasswordsByConnectionId = new Map<string, string | null>();

function promptForConnectionPassword(connectionName: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.prompt(
    `No saved password for '${connectionName}'. Enter one for this session, or leave empty to continue without a password.`,
    "",
  );
}

export function clearSessionConnectionPassword(connectionId?: string): void {
  if (!connectionId) {
    sessionPasswordsByConnectionId.clear();
    return;
  }

  sessionPasswordsByConnectionId.delete(connectionId);
}

export async function resolveConnectionPassword(
  profile: ConnectionProfile,
): Promise<string | undefined> {
  if (profile.credentials.storage === "plain") {
    return profile.credentials.password;
  }

  if (profile.credentials.storage === "encrypted") {
    return decryptConnectionPassword(profile.credentials.envelope);
  }

  if (sessionPasswordsByConnectionId.has(profile.id)) {
    return sessionPasswordsByConnectionId.get(profile.id) ?? undefined;
  }

  const input = promptForConnectionPassword(profile.name);

  if (input === null || input.length === 0) {
    sessionPasswordsByConnectionId.set(profile.id, null);
    return undefined;
  }

  sessionPasswordsByConnectionId.set(profile.id, input);
  return input;
}
