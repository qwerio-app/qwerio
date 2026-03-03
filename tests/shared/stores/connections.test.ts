import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { ConnectionProfile } from "../../../src/core/types";

const {
  loadConnectionsFromStorageMock,
  saveConnectionsToStorageMock,
  getVariableValueMock,
  setVariableValueMock,
  createNanoIdMock,
} = vi.hoisted(() => ({
  loadConnectionsFromStorageMock: vi.fn<() => Promise<ConnectionProfile[]>>(),
  saveConnectionsToStorageMock: vi.fn(),
  getVariableValueMock: vi.fn(),
  setVariableValueMock: vi.fn(),
  createNanoIdMock: vi.fn(),
}));

vi.mock("../../../src/core/storage/indexed-db", () => ({
  loadConnectionsFromStorage: loadConnectionsFromStorageMock,
  saveConnectionsToStorage: saveConnectionsToStorageMock,
  getVariableValue: getVariableValueMock,
  setVariableValue: setVariableValueMock,
}));

vi.mock("../../../src/core/nano-id", () => ({
  createNanoId: createNanoIdMock,
}));

import { useConnectionsStore } from "../../../src/stores/connections";

const ACTIVE_CONNECTION_ID_KEY = "variables.connections.activeConnectionId";

function createStoredPostgresProfile(id: string): ConnectionProfile {
  return {
    id,
    name: `Conn ${id}`,
    type: "personal",
    target: {
      kind: "desktop-tcp",
      dialect: "postgres",
      host: "localhost",
      port: 5432,
      database: "app",
      user: "postgres",
      tlsMode: "tls-verified-cert",
    },
    credentials: {
      storage: "none",
    },
    sync: {
      enabled: false,
    },
    showInternalSchemas: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("connections store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useRealTimers();
    createNanoIdMock.mockReset();
    loadConnectionsFromStorageMock.mockReset();
    saveConnectionsToStorageMock.mockReset();
    getVariableValueMock.mockReset();
    setVariableValueMock.mockReset();

    createNanoIdMock.mockReturnValue("generated-1");
    loadConnectionsFromStorageMock.mockResolvedValue([]);
    getVariableValueMock.mockResolvedValue(null);
    saveConnectionsToStorageMock.mockResolvedValue(undefined);
    setVariableValueMock.mockResolvedValue(undefined);
  });

  it("rejects invalid profiles", async () => {
    const store = useConnectionsStore();
    await flushAsyncWork();

    const result = store.addConnection({
      name: "a",
      type: "personal",
      target: {
        kind: "web-provider",
        dialect: "postgres",
        provider: "neon",
        endpoint: "localhost:6543",
        connectionStringTemplate: "postgres://user@localhost:5432/app",
      },
      credentials: {
        storage: "none",
      },
    });

    expect(result.ok).toBe(false);
    expect(store.profiles).toHaveLength(0);
  });

  it("preserves existing postgres tls mode on update when target identity is unchanged", async () => {
    loadConnectionsFromStorageMock.mockResolvedValueOnce([
      createStoredPostgresProfile("stored-1"),
    ]);

    const store = useConnectionsStore();
    await flushAsyncWork();

    const result = store.updateConnection("stored-1", {
      name: "Updated",
      type: "team",
      target: {
        kind: "desktop-tcp",
        dialect: "postgres",
        host: "localhost",
        port: 5432,
        database: "app",
        user: "postgres",
      },
      credentials: {
        storage: "none",
      },
      showInternalSchemas: true,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.profile.target.kind === "desktop-tcp" && result.profile.target.dialect === "postgres" ? result.profile.target.tlsMode : null).toBe("tls-verified-cert");
  });

  it("falls back to first profile when stored active connection is missing", async () => {
    const first = createStoredPostgresProfile("conn-1");
    const second = createStoredPostgresProfile("conn-2");

    loadConnectionsFromStorageMock.mockResolvedValueOnce([first, second]);
    getVariableValueMock.mockResolvedValueOnce("missing-id");

    const store = useConnectionsStore();
    await flushAsyncWork();

    expect(store.activeConnectionId).toBe("conn-1");
  });

  it("persists active connection variable after hydration", async () => {
    const first = createStoredPostgresProfile("conn-1");
    const second = createStoredPostgresProfile("conn-2");

    loadConnectionsFromStorageMock.mockResolvedValueOnce([first, second]);
    getVariableValueMock.mockResolvedValueOnce("conn-1");

    const store = useConnectionsStore();
    await flushAsyncWork();

    store.setActiveConnection("conn-2");
    await flushAsyncWork();

    expect(setVariableValueMock).toHaveBeenCalledWith(
      ACTIVE_CONNECTION_ID_KEY,
      "conn-2",
    );
  });
});
