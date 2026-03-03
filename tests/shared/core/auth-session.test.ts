import { beforeEach, describe, expect, it, vi } from "vitest";

const { getVariableValueMock, setVariableValueMock } = vi.hoisted(() => ({
  getVariableValueMock: vi.fn(),
  setVariableValueMock: vi.fn(),
}));

vi.mock("../../../src/core/storage/indexed-db", () => ({
  getVariableValue: getVariableValueMock,
  setVariableValue: setVariableValueMock,
}));

import type { AuthResult } from "../../../src/core/auth-types";
import {
  isAuthSessionExpired,
  loadValidAuthSessionFromStorage,
  parseAuthSession,
  saveAuthSessionToStorage,
  toAuthSession,
} from "../../../src/core/auth-session";

describe("auth-session", () => {
  beforeEach(() => {
    getVariableValueMock.mockReset();
    setVariableValueMock.mockReset();
  });

  it("parses a valid persisted auth session", () => {
    const parsed = parseAuthSession({
      accessToken: "token-1",
      expiresAt: "2030-01-01T00:00:00.000Z",
      user: {
        id: "user-1",
        email: "user@example.com",
        displayName: "User",
        avatarUrl: null,
        subscriptions: [
          {
            id: "sub-1",
            type: "team",
            status: "active",
            seatCount: 3,
            teamId: "team-1",
            currentPeriodEnd: "2030-02-01T00:00:00.000Z",
          },
        ],
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.user.id).toBe("user-1");
    expect(parsed?.user.subscriptions).toHaveLength(1);
  });

  it("rejects malformed auth sessions", () => {
    expect(parseAuthSession(null)).toBeNull();
    expect(
      parseAuthSession({
        accessToken: "token-1",
        expiresAt: "2030-01-01T00:00:00.000Z",
      }),
    ).toBeNull();

    expect(
      parseAuthSession({
        accessToken: "token-1",
        expiresAt: "2030-01-01T00:00:00.000Z",
        user: {
          id: "",
        },
      }),
    ).toBeNull();
  });

  it("flags expired sessions and invalid dates", () => {
    expect(
      isAuthSessionExpired({
        accessToken: "token-1",
        expiresAt: "invalid-date",
        user: {
          id: "user-1",
          email: null,
          displayName: null,
          avatarUrl: null,
          subscriptions: [],
        },
      }),
    ).toBe(true);

    expect(
      isAuthSessionExpired({
        accessToken: "token-1",
        expiresAt: "2999-01-01T00:00:00.000Z",
        user: {
          id: "user-1",
          email: null,
          displayName: null,
          avatarUrl: null,
          subscriptions: [],
        },
      }),
    ).toBe(false);
  });

  it("normalizes auth result to session shape", () => {
    const nextSession = toAuthSession({
      accessToken: "token-1",
      expiresAt: "2030-01-01T00:00:00.000Z",
      user: {
        id: "user-1",
        email: "user@example.com",
        displayName: "User",
        avatarUrl: " https://example.com/avatar.png ",
      },
    } as unknown as AuthResult);

    expect(nextSession.user.avatarUrl).toBe(" https://example.com/avatar.png ");
    expect(nextSession.user.subscriptions).toEqual([]);
  });

  it("returns null from loadValidAuthSessionFromStorage when expired", async () => {
    getVariableValueMock.mockResolvedValueOnce({
      accessToken: "token-1",
      expiresAt: "2020-01-01T00:00:00.000Z",
      user: {
        id: "user-1",
        email: null,
        displayName: null,
        avatarUrl: null,
        subscriptions: [],
      },
    });

    await expect(loadValidAuthSessionFromStorage()).resolves.toBeNull();
  });

  it("persists serializable auth session shape", async () => {
    await saveAuthSessionToStorage({
      accessToken: "token-1",
      expiresAt: "2030-01-01T00:00:00.000Z",
      user: {
        id: "user-1",
        email: "user@example.com",
        displayName: "User",
        avatarUrl: null,
        subscriptions: [
          {
            id: "sub-1",
            type: "solo",
            status: "active",
            seatCount: null,
            teamId: null,
            currentPeriodEnd: null,
          },
        ],
      },
    });

    expect(setVariableValueMock).toHaveBeenCalledWith(
      "variables.auth.session",
      expect.objectContaining({
        accessToken: "token-1",
      }),
    );
  });
});
