import { detectRuntimeMode } from "./runtime";
import {
  getVariableValue,
  isAppStorageSupported,
  setVariableValue,
} from "./storage/indexed-db";
import type { ConnectionSecret } from "./types";

const WEB_VAULT_KEY = "qwerio.web.secretVault.v1";
const WEB_VAULT_VERSION = 1;
const PBKDF2_ITERATIONS = 250_000;
const VAULT_PIN_PATTERN = /^\d{5}$/;

type WebVaultEnvelope = {
  version: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

type WebVaultCache = {
  key: CryptoKey;
  salt: Uint8Array;
  secrets: Record<string, ConnectionSecret>;
};

export type WebVaultStatus = {
  supported: boolean;
  initialized: boolean;
  unlocked: boolean;
};

let webVaultCache: WebVaultCache | null = null;

async function tauriInvoke<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, payload);
}

function isWebRuntime(): boolean {
  return detectRuntimeMode() === "web";
}

function isWebVaultSupported(): boolean {
  return (
    isWebRuntime() &&
    typeof window !== "undefined" &&
    isAppStorageSupported() &&
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined"
  );
}

async function getWebVaultEnvelope(): Promise<WebVaultEnvelope | null> {
  if (!isWebVaultSupported()) {
    return null;
  }

  const envelope = await getVariableValue<WebVaultEnvelope | null>(
    WEB_VAULT_KEY,
    null,
  );

  if (!envelope) {
    return null;
  }

  if (envelope.version !== WEB_VAULT_VERSION) {
    return null;
  }

  return envelope;
}

async function setWebVaultEnvelope(envelope: WebVaultEnvelope): Promise<void> {
  await setVariableValue(WEB_VAULT_KEY, envelope);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function normalizeVaultPin(pin: string): string {
  return pin.trim();
}

function assertValidVaultPin(pin: string): void {
  if (!VAULT_PIN_PATTERN.test(pin)) {
    throw new Error("PIN must be exactly 5 digits.");
  }
}

async function deriveVaultKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveKey"]);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

async function persistWebVault(cache: WebVaultCache): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedSecrets = new TextEncoder().encode(JSON.stringify(cache.secrets));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cache.key, encodedSecrets);

  await setWebVaultEnvelope({
    version: WEB_VAULT_VERSION,
    salt: toBase64(cache.salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(encrypted)),
  });
}

function requireUnlockedWebVault(): WebVaultCache {
  if (!isWebVaultSupported()) {
    throw new Error("Web secret vault is unavailable in this runtime.");
  }

  if (!webVaultCache) {
    throw new Error("Web secret vault is locked. Unlock it with your PIN first.");
  }

  return webVaultCache;
}

export async function getWebSecretVaultStatus(): Promise<WebVaultStatus> {
  const supported = isWebVaultSupported();

  if (!supported) {
    return {
      supported: false,
      initialized: false,
      unlocked: false,
    };
  }

  return {
    supported: true,
    initialized: (await getWebVaultEnvelope()) !== null,
    unlocked: webVaultCache !== null,
  };
}

export async function unlockWebSecretVault(pinInput: string): Promise<void> {
  if (!isWebVaultSupported()) {
    throw new Error("Web secret vault is unavailable in this runtime.");
  }

  const pin = normalizeVaultPin(pinInput);
  assertValidVaultPin(pin);

  const envelope = await getWebVaultEnvelope();

  if (!envelope) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveVaultKey(pin, salt);

    webVaultCache = {
      key,
      salt,
      secrets: {},
    };

    await persistWebVault(webVaultCache);
    return;
  }

  try {
    const salt = fromBase64(envelope.salt);
    const iv = fromBase64(envelope.iv);
    const ciphertext = fromBase64(envelope.ciphertext);
    const key = await deriveVaultKey(pin, salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );

    const decoded = new TextDecoder().decode(decrypted);
    const parsed = JSON.parse(decoded) as Record<string, ConnectionSecret>;

    webVaultCache = {
      key,
      salt,
      secrets: parsed,
    };
  } catch {
    throw new Error("Invalid PIN or corrupted vault data.");
  }
}

export function lockWebSecretVault(): void {
  webVaultCache = null;
}

export async function storeConnectionSecret(connectionId: string, secret: ConnectionSecret): Promise<void> {
  if (detectRuntimeMode() === "desktop") {
    await tauriInvoke<void>("secret_store", {
      connectionId,
      secretJson: JSON.stringify(secret),
    });
    return;
  }

  const vault = requireUnlockedWebVault();
  vault.secrets[connectionId] = secret;
  await persistWebVault(vault);
}

export async function loadConnectionSecret(connectionId: string): Promise<ConnectionSecret | null> {
  if (detectRuntimeMode() === "desktop") {
    const secretJson = await tauriInvoke<string | null>("secret_load", { connectionId });

    if (!secretJson) {
      return null;
    }

    return JSON.parse(secretJson) as ConnectionSecret;
  }

  return requireUnlockedWebVault().secrets[connectionId] ?? null;
}

export async function deleteConnectionSecret(connectionId: string): Promise<void> {
  if (detectRuntimeMode() === "desktop") {
    await tauriInvoke<void>("secret_delete", { connectionId });
    return;
  }

  const vault = requireUnlockedWebVault();
  delete vault.secrets[connectionId];
  await persistWebVault(vault);
}
