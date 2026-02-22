import type { EncryptedConnectionPassword } from "./types";

const PBKDF2_ITERATIONS = 250_000;
const PIN_PATTERN = /^\d{5}$/;

export type SecretPinStatus = {
  supported: boolean;
  unlocked: boolean;
};

export class SecretPinRequiredError extends Error {
  readonly envelope?: EncryptedConnectionPassword;

  constructor(message: string, envelope?: EncryptedConnectionPassword) {
    super(message);
    this.name = "SecretPinRequiredError";
    this.envelope = envelope;
  }
}

let unlockedPin: string | null = null;

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

function normalizePin(pin: string): string {
  return pin.trim();
}

function assertValidPin(pin: string): void {
  if (!PIN_PATTERN.test(pin)) {
    throw new Error("PIN must be exactly 5 digits.");
  }
}

function requireCryptoSupport(): void {
  if (!isSecretPinSupported()) {
    throw new Error("Connection PIN encryption is unavailable in this runtime.");
  }
}

function requireUnlockedPin(envelope?: EncryptedConnectionPassword): string {
  if (!unlockedPin) {
    throw new SecretPinRequiredError(
      "Enter your 5-digit PIN to unlock encrypted connection passwords.",
      envelope,
    );
  }

  return unlockedPin;
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
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

export function isSecretPinSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined"
  );
}

export function getSecretPinStatus(): SecretPinStatus {
  return {
    supported: isSecretPinSupported(),
    unlocked: unlockedPin !== null,
  };
}

export function unlockSecretPin(pinInput: string): void {
  requireCryptoSupport();
  const pin = normalizePin(pinInput);
  assertValidPin(pin);
  unlockedPin = pin;
}

export function lockSecretPin(): void {
  unlockedPin = null;
}

export async function encryptConnectionPassword(
  password: string,
): Promise<EncryptedConnectionPassword> {
  requireCryptoSupport();
  const pin = requireUnlockedPin();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const encodedPassword = new TextEncoder().encode(password);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedPassword,
  );

  return {
    version: 1,
    algorithm: "aes-gcm",
    kdf: "pbkdf2-sha256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptConnectionPassword(
  envelope: EncryptedConnectionPassword,
): Promise<string> {
  requireCryptoSupport();

  if (envelope.version !== 1 || envelope.algorithm !== "aes-gcm" || envelope.kdf !== "pbkdf2-sha256") {
    throw new Error("Unsupported encrypted credential format.");
  }

  const pin = requireUnlockedPin(envelope);

  try {
    const salt = fromBase64(envelope.salt);
    const iv = fromBase64(envelope.iv);
    const ciphertext = fromBase64(envelope.ciphertext);
    const key = await deriveKey(pin, salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    lockSecretPin();
    throw new SecretPinRequiredError(
      "Invalid PIN for this encrypted connection. Try again.",
      envelope,
    );
  }
}
