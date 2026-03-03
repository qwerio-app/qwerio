import { beforeEach, describe, expect, it } from "vitest";
import {
  SecretPinRequiredError,
  decryptConnectionPassword,
  encryptConnectionPassword,
  getSecretPinStatus,
  isSecretPinSupported,
  lockSecretPin,
  unlockSecretPin,
} from "../../../src/core/secret-vault";

describe("secret-vault", () => {
  beforeEach(() => {
    lockSecretPin();
  });

  it("supports PIN crypto in web test runtime", () => {
    expect(isSecretPinSupported()).toBe(true);
  });

  it("validates PIN format", () => {
    expect(() => unlockSecretPin("12")).toThrow("PIN must be exactly 5 digits.");
    expect(() => unlockSecretPin("abcde")).toThrow("PIN must be exactly 5 digits.");
  });

  it("encrypts and decrypts connection passwords with unlocked PIN", async () => {
    unlockSecretPin("12345");

    const envelope = await encryptConnectionPassword("db-secret");
    const decrypted = await decryptConnectionPassword(envelope);

    expect(envelope.algorithm).toBe("aes-gcm");
    expect(envelope.kdf).toBe("pbkdf2-sha256");
    expect(decrypted).toBe("db-secret");
  });

  it("throws SecretPinRequiredError when decrypting without unlocked PIN", async () => {
    unlockSecretPin("12345");
    const envelope = await encryptConnectionPassword("db-secret");

    lockSecretPin();

    await expect(decryptConnectionPassword(envelope)).rejects.toBeInstanceOf(
      SecretPinRequiredError,
    );
  });

  it("locks PIN after invalid decrypt and requires re-unlock", async () => {
    unlockSecretPin("12345");
    const envelope = await encryptConnectionPassword("db-secret");

    lockSecretPin();
    unlockSecretPin("54321");

    await expect(decryptConnectionPassword(envelope)).rejects.toMatchObject({
      name: "SecretPinRequiredError",
      message: "Invalid PIN for this encrypted connection. Try again.",
    });

    expect(getSecretPinStatus().unlocked).toBe(false);
  });
});
