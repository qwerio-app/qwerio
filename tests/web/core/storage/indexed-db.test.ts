import { beforeEach, describe, expect, it } from "vitest";
import {
  getSettingValue,
  getVariableValue,
  loadAppTabsFromStorage,
  loadConnectionsFromStorage,
  loadSavedQueriesFromStorage,
  loadWorkbenchTabsFromStorage,
  removeSavedQueryFromStorage,
  saveAppTabsToStorage,
  saveConnectionsToStorage,
  saveSavedQueryToStorage,
  saveWorkbenchTabsToStorage,
  setSettingValue,
  setVariableValue,
  type StoredSavedQuery,
} from "../../../../src/core/storage/indexed-db";
import type { ConnectionProfile } from "../../../../src/core/types";

function uniqueKey(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createConnectionProfile(id: string, orderLabel: string): ConnectionProfile {
  return {
    id,
    name: `Connection ${orderLabel}`,
    type: "personal",
    target: {
      kind: "web-provider",
      dialect: "postgres",
      provider: "neon",
      endpoint: "localhost:6543",
      connectionStringTemplate: `postgres://user@localhost:5432/${orderLabel}`,
    },
    credentials: {
      storage: "none",
    },
    sync: {
      enabled: false,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function clearSavedQueries(): Promise<void> {
  const existing = await loadSavedQueriesFromStorage();
  await Promise.all(existing.map((query) => removeSavedQueryFromStorage(query.id)));
}

describe("indexed-db storage", () => {
  beforeEach(async () => {
    await saveConnectionsToStorage([]);
    await clearSavedQueries();
  });

  it("persists and loads connections preserving order", async () => {
    const first = createConnectionProfile("conn-a", "A");
    const second = createConnectionProfile("conn-b", "B");

    await saveConnectionsToStorage([second, first]);

    await expect(loadConnectionsFromStorage()).resolves.toEqual([second, first]);
  });

  it("round-trips workbench query/table tabs with object type encoding", async () => {
    const connectionId = uniqueKey("conn-workbench");

    await saveWorkbenchTabsToStorage({
      connectionId,
      queryTabs: [
        {
          type: "query",
          id: "q-1",
          connectionId,
          title: "Query 1",
          sql: "select 1",
          savedQueryId: "saved-1",
        },
      ],
      tableTabs: [
        {
          type: "table",
          id: "t-1",
          title: "public.users",
          connectionId,
          schemaName: "public",
          tableName: "users",
          objectType: "view",
        },
      ],
    });

    const loaded = await loadWorkbenchTabsFromStorage(connectionId);

    expect(loaded.queryTabs).toEqual([
      {
        type: "query",
        id: "q-1",
        connectionId,
        title: "Query 1",
        sql: "select 1",
        savedQueryId: "saved-1",
      },
    ]);

    expect(loaded.tableTabs).toEqual([
      {
        type: "table",
        id: "t-1",
        title: "public.users",
        connectionId,
        schemaName: "public",
        tableName: "users",
        objectType: "view",
      },
    ]);
  });

  it("persists app tabs and parses table/collection page keys", async () => {
    const connectionId = uniqueKey("conn-app");

    await saveAppTabsToStorage(connectionId, [
      {
        type: "query",
        id: "ignored-query-id",
        connectionId,
        title: "Query route",
        routePath: "/query/query-tab-1",
        queryTabId: "query-tab-1",
      },
      {
        type: "table",
        id: "ignored-table-id",
        connectionId,
        title: "users",
        routePath: "/collections/object-1",
        pageKey: "collection:object-1",
      },
    ]);

    const tabs = await loadAppTabsFromStorage(connectionId);

    expect(tabs).toEqual([
      {
        type: "query",
        id: "query:query-tab-1",
        connectionId,
        title: "Query route",
        routePath: "/query/query-tab-1",
        queryTabId: "query-tab-1",
      },
      {
        type: "table",
        id: "table:object-1",
        connectionId,
        title: "users",
        routePath: "/collections/object-1",
        pageKey: "collection:object-1",
      },
    ]);
  });

  it("returns fallback values for missing settings and variables", async () => {
    const settingKey = uniqueKey("setting");
    const themeSettingKey = uniqueKey("theme-setting");
    const variableKey = uniqueKey("variable");

    await expect(getSettingValue(settingKey, { enabled: false })).resolves.toEqual({
      enabled: false,
    });
    await expect(getSettingValue(themeSettingKey, "graphite")).resolves.toBe(
      "graphite",
    );
    await expect(getVariableValue(variableKey, "fallback")).resolves.toBe("fallback");

    await setSettingValue(settingKey, { enabled: true });
    await setSettingValue(themeSettingKey, "paper");
    await setVariableValue(variableKey, "stored-value");

    await expect(getSettingValue(settingKey, { enabled: false })).resolves.toEqual({
      enabled: true,
    });
    await expect(getSettingValue(themeSettingKey, "graphite")).resolves.toBe(
      "paper",
    );
    await expect(getVariableValue(variableKey, "fallback")).resolves.toBe("stored-value");
  });

  it("supports saved query CRUD and reverse updatedAt ordering", async () => {
    const older: StoredSavedQuery = {
      id: uniqueKey("saved-old"),
      connectionId: "conn-1",
      schemaName: "public",
      name: "Old",
      sql: "select 1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const newer: StoredSavedQuery = {
      id: uniqueKey("saved-new"),
      connectionId: "conn-1",
      schemaName: "public",
      name: "New",
      sql: "select 2",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    await saveSavedQueryToStorage(older);
    await saveSavedQueryToStorage(newer);

    const initial = await loadSavedQueriesFromStorage();
    expect(initial.map((entry) => entry.id)).toEqual([newer.id, older.id]);

    await removeSavedQueryFromStorage(newer.id);

    const remaining = await loadSavedQueriesFromStorage();
    expect(remaining.map((entry) => entry.id)).toEqual([older.id]);
  });
});
