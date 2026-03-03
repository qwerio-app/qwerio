import { beforeEach, describe, expect, it, vi } from "vitest";

const { decryptConnectionPasswordMock } = vi.hoisted(() => ({
  decryptConnectionPasswordMock: vi.fn(),
}));

vi.mock("../../../src/core/secret-vault", () => ({
  decryptConnectionPassword: decryptConnectionPasswordMock,
}));

import {
  clearSessionConnectionPassword,
  resolveConnectionPassword,
} from "../../../src/core/connection-secrets";
import type { ConnectionProfile } from "../../../src/core/types";

function createBaseProfile(): ConnectionProfile {
  return {
    id: "conn-1",
    name: "Primary",
    type: "personal",
    target: {
      kind: "web-provider",
      dialect: "postgres",
      provider: "neon",
      endpoint: "localhost:6543",
      connectionStringTemplate: "postgres://user@localhost:5432/db",
    },
    credentials: {
      storage: "none",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("connection-secrets", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    decryptConnectionPasswordMock.mockReset();
    clearSessionConnectionPassword();
    vi.unstubAllGlobals();
  });

  it("returns plain stored password", async () => {
    const profile: ConnectionProfile = {
      ...createBaseProfile(),
      credentials: {
        storage: "plain",
        password: "plain-secret",
      },
    };

    await expect(resolveConnectionPassword(profile)).resolves.toBe("plain-secret");
    expect(decryptConnectionPasswordMock).not.toHaveBeenCalled();
  });

  it("delegates encrypted passwords to secret-vault", async () => {
    decryptConnectionPasswordMock.mockResolvedValueOnce("decrypted-secret");

    const profile: ConnectionProfile = {
      ...createBaseProfile(),
      credentials: {
        storage: "encrypted",
        envelope: {
          version: 1,
          algorithm: "aes-gcm",
          kdf: "pbkdf2-sha256",
          iterations: 250000,
          salt: "salt",
          iv: "iv",
          ciphertext: "cipher",
        },
      },
    };

    await expect(resolveConnectionPassword(profile)).resolves.toBe("decrypted-secret");
    expect(decryptConnectionPasswordMock).toHaveBeenCalledTimes(1);
  });

  it("prompts once for storage:none and caches by connection", async () => {
    const promptMock = vi.fn().mockReturnValueOnce("session-secret");
    vi.stubGlobal("window", {
      prompt: promptMock,
    });

    const profile = createBaseProfile();

    await expect(resolveConnectionPassword(profile)).resolves.toBe("session-secret");
    await expect(resolveConnectionPassword(profile)).resolves.toBe("session-secret");

    expect(promptMock).toHaveBeenCalledTimes(1);
  });

  it("stores empty prompt response as undefined and reuses it", async () => {
    const promptMock = vi.fn().mockReturnValueOnce("");
    vi.stubGlobal("window", {
      prompt: promptMock,
    });

    const profile = createBaseProfile();

    await expect(resolveConnectionPassword(profile)).resolves.toBeUndefined();
    await expect(resolveConnectionPassword(profile)).resolves.toBeUndefined();

    expect(promptMock).toHaveBeenCalledTimes(1);
  });

  it("clears one cached entry or all entries", async () => {
    const promptMock = vi
      .fn()
      .mockReturnValueOnce("secret-a")
      .mockReturnValueOnce("secret-b")
      .mockReturnValueOnce("secret-a-2")
      .mockReturnValueOnce("");

    vi.stubGlobal("window", {
      prompt: promptMock,
    });

    const profileA = createBaseProfile();
    const profileB = {
      ...createBaseProfile(),
      id: "conn-2",
      name: "Replica",
    };

    await expect(resolveConnectionPassword(profileA)).resolves.toBe("secret-a");
    await expect(resolveConnectionPassword(profileB)).resolves.toBe("secret-b");

    clearSessionConnectionPassword(profileA.id);

    await expect(resolveConnectionPassword(profileA)).resolves.toBe("secret-a-2");
    await expect(resolveConnectionPassword(profileB)).resolves.toBe("secret-b");

    clearSessionConnectionPassword();
    await expect(resolveConnectionPassword(profileB)).resolves.toBeUndefined();

    expect(promptMock).toHaveBeenCalledTimes(4);
  });
});
