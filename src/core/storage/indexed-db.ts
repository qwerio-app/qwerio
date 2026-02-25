import Dexie, { type Table } from "dexie";
import type { ConnectionProfile, DataObjectType } from "../types";

const DATABASE_NAME = "qwerio.app";
const TABLE_OBJECT_TYPE_SQL_PREFIX = "__qwerio_object_type__:";

export type StoredWorkbenchQueryTab = {
  type: "query";
  id: string;
  connectionId: string;
  title: string;
  sql: string;
  savedQueryId?: string;
};

export type StoredWorkbenchTableTab = {
  type: "table";
  id: string;
  title: string;
  connectionId: string;
  schemaName: string;
  tableName: string;
  objectType: DataObjectType;
};

export type StoredAppQueryTab = {
  type: "query";
  id: string;
  connectionId: string;
  title: string;
  routePath: string;
  queryTabId: string;
};

export type StoredAppTableTab = {
  type: "table";
  id: string;
  connectionId: string;
  title: string;
  routePath: string;
  pageKey: string;
};

type StoredConnectionRecord = ConnectionProfile & {
  order: number;
};

type StoredTabRecord = {
  id: string;
  type: "query" | "table";
  order: number;
  connectionId: string | null;
  tabId: string;
  path: string;
  sql: string;
  title: string;
  savedQueryId?: string;
  updatedAt: string;
};

type StoredSettingRecord = {
  key: string;
  value: unknown;
  updatedAt: string;
};

type StoredVariableRecord = {
  key: string;
  value: unknown;
  updatedAt: string;
};

export type StoredSavedQuery = {
  id: string;
  connectionId: string;
  schemaName: string;
  name: string;
  sql: string;
  createdAt: string;
  updatedAt: string;
};

type StoredSavedQueryRecord = StoredSavedQuery;

class QwerioAppDatabase extends Dexie {
  connections!: Table<StoredConnectionRecord, string>;
  tabs!: Table<StoredTabRecord, string>;
  settings!: Table<StoredSettingRecord, string>;
  variables!: Table<StoredVariableRecord, string>;
  queries!: Table<StoredSavedQueryRecord, string>;

  constructor() {
    super(DATABASE_NAME);

    this.version(2).stores({
      connections: "id, order, updatedAt",
      tabs: "id, type, order, tabId, connectionId, [type+tabId], updatedAt",
      settings: "key, updatedAt",
      variables: "key, updatedAt",
    });

    this.version(3).stores({
      connections: "id, order, updatedAt",
      tabs: "id, type, order, tabId, connectionId, [type+tabId], updatedAt",
      settings: "key, updatedAt",
      variables: "key, updatedAt",
      queries:
        "id, connectionId, schemaName, [connectionId+schemaName], updatedAt, createdAt",
    });
  }
}

function isIndexedDbSupported(): boolean {
  return typeof indexedDB !== "undefined" && typeof IDBKeyRange !== "undefined";
}

export function isAppStorageSupported(): boolean {
  return isIndexedDbSupported();
}

const appDatabase = isIndexedDbSupported() ? new QwerioAppDatabase() : null;
let hasWarnedAboutStorage = false;

function warnAboutStorageFailure(error: unknown): void {
  console.error("IndexedDB storage operation failed.", error);

  if (hasWarnedAboutStorage) {
    return;
  }

  hasWarnedAboutStorage = true;
  console.warn(
    "IndexedDB storage is unavailable. Qwerio is running with in-memory state only.",
  );
}

async function readFromDatabase<T>(
  operation: (database: QwerioAppDatabase) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!appDatabase) {
    return fallback;
  }

  try {
    return await operation(appDatabase);
  } catch (error) {
    warnAboutStorageFailure(error);
    return fallback;
  }
}

async function writeToDatabase(
  operation: (database: QwerioAppDatabase) => Promise<void>,
): Promise<void> {
  if (!appDatabase) {
    return;
  }

  try {
    await operation(appDatabase);
  } catch (error) {
    warnAboutStorageFailure(error);
  }
}

function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

function toQueryPath(tabId: string): string {
  return `/query/${tabId}`;
}

function toTablePath(tabId: string): string {
  return `/tables/${tabId}`;
}

function toCollectionPath(tabId: string): string {
  return `/collections/${tabId}`;
}

function toTablePageKey(tabId: string): string {
  return `table:${tabId}`;
}

function toCollectionPageKey(tabId: string): string {
  return `collection:${tabId}`;
}

function parseObjectTabIdFromPageKey(pageKey: string): string | null {
  if (!pageKey.startsWith("table:") && !pageKey.startsWith("collection:")) {
    return null;
  }

  const tabId = pageKey.slice(pageKey.indexOf(":") + 1).trim();
  return tabId.length > 0 ? tabId : null;
}

function toTabRecordKey(type: "query" | "table", tabId: string): string {
  return `${type}:${tabId}`;
}

function encodeTableObjectType(
  objectType: StoredWorkbenchTableTab["objectType"],
): string {
  return `${TABLE_OBJECT_TYPE_SQL_PREFIX}${objectType}`;
}

function decodeTableObjectType(
  sql: string,
): StoredWorkbenchTableTab["objectType"] {
  if (!sql.startsWith(TABLE_OBJECT_TYPE_SQL_PREFIX)) {
    return "table";
  }

  const value = sql.slice(TABLE_OBJECT_TYPE_SQL_PREFIX.length);
  switch (value) {
    case "view":
    case "collection":
    case "redis-string":
    case "redis-hash":
    case "redis-list":
    case "redis-set":
    case "redis-zset":
    case "redis-stream":
    case "redis-key":
      return value;
    default:
      return "table";
  }
}

function isCollectionObjectType(objectType: DataObjectType): boolean {
  return (
    objectType === "collection" ||
    objectType.startsWith("redis-")
  );
}

function toObjectPath(tabId: string, objectType: DataObjectType): string {
  return isCollectionObjectType(objectType)
    ? toCollectionPath(tabId)
    : toTablePath(tabId);
}

function toObjectPageKey(tabId: string, objectType: DataObjectType): string {
  return isCollectionObjectType(objectType)
    ? toCollectionPageKey(tabId)
    : toTablePageKey(tabId);
}

function parseTableTitle(title: string): {
  schemaName: string;
  tableName: string;
} {
  const normalizedTitle = title.trim();
  const separatorIndex = normalizedTitle.indexOf(".");

  if (separatorIndex <= 0 || separatorIndex === normalizedTitle.length - 1) {
    return {
      schemaName: "public",
      tableName: normalizedTitle || "table",
    };
  }

  return {
    schemaName: normalizedTitle.slice(0, separatorIndex),
    tableName: normalizedTitle.slice(separatorIndex + 1),
  };
}

function resolveTableRecordTitle(
  incomingTitle: string,
  existingTitle: string | null,
): string {
  const trimmedIncomingTitle = incomingTitle.trim();
  const trimmedExistingTitle = existingTitle?.trim() ?? "";

  if (trimmedIncomingTitle.includes(".")) {
    return trimmedIncomingTitle;
  }

  if (trimmedExistingTitle.includes(".")) {
    return trimmedExistingTitle;
  }

  return trimmedIncomingTitle || trimmedExistingTitle || "Table";
}

function isStoredTableRecordWithConnection(
  record: StoredTabRecord,
): record is StoredTabRecord & { type: "table"; connectionId: string } {
  return (
    record.type === "table" &&
    typeof record.connectionId === "string" &&
    record.connectionId.length > 0
  );
}

function toSerializableConnectionProfile(
  profile: ConnectionProfile,
): ConnectionProfile {
  return {
    ...profile,
    sync: profile.sync
      ? {
          enabled: Boolean(profile.sync.enabled),
          ...(profile.sync.serverId ? { serverId: profile.sync.serverId } : {}),
          ...(profile.sync.lastSyncedAt
            ? { lastSyncedAt: profile.sync.lastSyncedAt }
            : {}),
        }
      : undefined,
    target: {
      ...profile.target,
    },
    credentials:
      profile.credentials.storage === "encrypted"
        ? {
            storage: "encrypted",
            envelope: {
              ...profile.credentials.envelope,
            },
          }
        : profile.credentials.storage === "plain"
          ? {
              storage: "plain",
              password: profile.credentials.password,
            }
          : {
              storage: "none",
            },
  };
}

function parseStoredValue<T>(value: unknown, fallback: T): T {
  if (value === undefined) {
    return fallback;
  }

  return value as T;
}

export async function loadConnectionsFromStorage(): Promise<
  ConnectionProfile[]
> {
  return readFromDatabase(async (database) => {
    const records = await database.connections.orderBy("order").toArray();

    return records.map((record) => {
      const profile = toSerializableConnectionProfile(record);

      return {
        id: profile.id,
        name: profile.name,
        type: profile.type,
        target: profile.target,
        credentials: profile.credentials,
        sync: profile.sync,
        showInternalSchemas: profile.showInternalSchemas,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      };
    });
  }, []);
}

export async function saveConnectionsToStorage(
  profiles: ConnectionProfile[],
): Promise<void> {
  const records: StoredConnectionRecord[] = profiles.map((profile, order) => ({
    ...toSerializableConnectionProfile(profile),
    order,
  }));

  await writeToDatabase(async (database) => {
    await database.transaction("rw", database.connections, async () => {
      await database.connections.clear();

      if (records.length > 0) {
        await database.connections.bulkPut(records);
      }
    });
  });
}

export async function loadWorkbenchTabsFromStorage(connectionId: string | null): Promise<{
  queryTabs: StoredWorkbenchQueryTab[];
  tableTabs: StoredWorkbenchTableTab[];
}> {
  if (!connectionId) {
    return {
      queryTabs: [],
      tableTabs: [],
    };
  }

  return readFromDatabase(
    async (database) => {
      const records = (await database.tabs
        .where("connectionId")
        .equals(connectionId)
        .toArray()).sort((left, right) => left.order - right.order);

      const queryTabs = records
        .filter((record): record is StoredTabRecord => record.type === "query")
        .map((tab) => ({
          type: "query" as const,
          id: tab.tabId,
          connectionId,
          title: tab.title,
          sql: tab.sql,
          savedQueryId:
            typeof tab.savedQueryId === "string" &&
            tab.savedQueryId.trim().length > 0
              ? tab.savedQueryId
              : undefined,
        }));

      const tableTabs = records
        .filter(isStoredTableRecordWithConnection)
        .map((tab) => {
          const parsedTitle = parseTableTitle(tab.title);

          return {
            type: "table" as const,
            id: tab.tabId,
            title: tab.title,
            connectionId: tab.connectionId,
            schemaName: parsedTitle.schemaName,
            tableName: parsedTitle.tableName,
            objectType: decodeTableObjectType(tab.sql),
          };
        });

      return {
        queryTabs,
        tableTabs,
      };
    },
    {
      queryTabs: [],
      tableTabs: [],
    },
  );
}

export async function saveWorkbenchTabsToStorage(input: {
  connectionId: string | null;
  queryTabs: StoredWorkbenchQueryTab[];
  tableTabs: StoredWorkbenchTableTab[];
}): Promise<void> {
  const scopedConnectionId = input.connectionId;

  if (!scopedConnectionId) {
    return;
  }

  const timestamp = nowIsoTimestamp();
  await writeToDatabase(async (database) => {
    await database.transaction("rw", database.tabs, async () => {
      const existingRecords = await database.tabs
        .where("connectionId")
        .equals(scopedConnectionId)
        .toArray();
      const existingByTabKey = new Map(
        existingRecords.map((record) => [
          toTabRecordKey(record.type, record.tabId),
          record,
        ]),
      );

      const nextRecords: StoredTabRecord[] = [
        ...input.queryTabs.map((tab, order) => {
          const tabKey = toTabRecordKey("query", tab.id);
          const existingRecord = existingByTabKey.get(tabKey);

          return {
            id: existingRecord?.id ?? toTabRecordKey("query", tab.id),
            type: "query" as const,
            order,
            connectionId: scopedConnectionId,
            tabId: tab.id,
            path: existingRecord?.path ?? toQueryPath(tab.id),
            sql: tab.sql,
            title: tab.title,
            savedQueryId: tab.savedQueryId,
            updatedAt: timestamp,
          };
        }),
        ...input.tableTabs.map((tab, order) => {
          const tabKey = toTabRecordKey("table", tab.id);
          const existingRecord = existingByTabKey.get(tabKey);
          const objectType = tab.objectType ?? "table";

          return {
            id: existingRecord?.id ?? toTabRecordKey("table", tab.id),
            type: "table" as const,
            order: input.queryTabs.length + order,
            connectionId: tab.connectionId,
            tabId: tab.id,
            path: existingRecord?.path ?? toObjectPath(tab.id, objectType),
            sql: encodeTableObjectType(objectType),
            title: tab.title,
            updatedAt: timestamp,
          };
        }),
      ];

      const nextRecordKeys = new Set(
        nextRecords.map((record) => toTabRecordKey(record.type, record.tabId)),
      );
      const staleRecordIds = existingRecords
        .filter((record) => !nextRecordKeys.has(toTabRecordKey(record.type, record.tabId)))
        .map((record) => record.id);

      if (staleRecordIds.length > 0) {
        await database.tabs.bulkDelete(staleRecordIds);
      }

      if (nextRecords.length > 0) {
        await database.tabs.bulkPut(nextRecords);
      }
    });
  });
}

export async function loadAppTabsFromStorage(
  connectionId: string | null,
): Promise<
  Array<StoredAppQueryTab | StoredAppTableTab>
> {
  if (!connectionId) {
    return [];
  }

  return readFromDatabase(async (database) => {
    const records = (await database.tabs
      .where("connectionId")
      .equals(connectionId)
      .toArray()).sort((left, right) => left.order - right.order);

    return records
      .filter(
        (record): record is StoredTabRecord =>
          record.type === "query" || record.type === "table",
      )
      .map((tab) =>
        tab.type === "query"
          ? {
              type: "query",
              id: tab.id,
              connectionId,
              title: tab.title,
              routePath: tab.path || toQueryPath(tab.tabId),
              queryTabId: tab.tabId,
            }
          : {
              type: "table",
              id: tab.id,
              connectionId,
              title: tab.title,
              routePath:
                tab.path ||
                toObjectPath(tab.tabId, decodeTableObjectType(tab.sql)),
              pageKey: toObjectPageKey(
                tab.tabId,
                decodeTableObjectType(tab.sql),
              ),
            },
      );
  }, []);
}

export async function saveAppTabsToStorage(
  connectionId: string | null,
  tabs: Array<StoredAppQueryTab | StoredAppTableTab>,
): Promise<void> {
  const scopedConnectionId = connectionId;

  if (!scopedConnectionId) {
    return;
  }

  const timestamp = nowIsoTimestamp();
  await writeToDatabase(async (database) => {
    await database.transaction("rw", database.tabs, async () => {
      const existingRecords = await database.tabs
        .where("connectionId")
        .equals(scopedConnectionId)
        .toArray();
      const existingByTabKey = new Map(
        existingRecords.map((record) => [
          toTabRecordKey(record.type, record.tabId),
          record,
        ]),
      );

      const records: StoredTabRecord[] = [];

      tabs.forEach((tab, order) => {
        if (tab.type === "query") {
          const tabId = tab.queryTabId.trim();
          if (tabId.length === 0) {
            return;
          }

          const existingRecord = existingByTabKey.get(
            toTabRecordKey("query", tabId),
          );
          records.push({
            id: existingRecord?.id ?? toTabRecordKey("query", tabId),
            type: "query",
            order,
            connectionId: scopedConnectionId,
            tabId,
            path: tab.routePath || toQueryPath(tabId),
            sql: existingRecord?.type === "query" ? existingRecord.sql : "",
            title: tab.title,
            savedQueryId:
              existingRecord?.type === "query"
                ? existingRecord.savedQueryId
                : undefined,
            updatedAt: timestamp,
          });
          return;
        }

        const tableTabId = parseObjectTabIdFromPageKey(tab.pageKey);
        if (!tableTabId) {
          return;
        }

        const existingRecord = existingByTabKey.get(
          toTabRecordKey("table", tableTabId),
        );
        const fallbackObjectType =
          existingRecord?.type === "table"
            ? decodeTableObjectType(existingRecord.sql)
            : tab.pageKey.startsWith("collection:")
              ? "collection"
              : "table";
        records.push({
          id: existingRecord?.id ?? toTabRecordKey("table", tableTabId),
          type: "table",
          order,
          connectionId: scopedConnectionId,
          tabId: tableTabId,
          path: tab.routePath || toObjectPath(tableTabId, fallbackObjectType),
          sql:
            existingRecord?.type === "table"
              ? existingRecord.sql
              : encodeTableObjectType(fallbackObjectType),
          title: resolveTableRecordTitle(
            tab.title,
            existingRecord?.title ?? null,
          ),
          updatedAt: timestamp,
        });
      });

      if (existingRecords.length > 0) {
        await database.tabs.bulkDelete(existingRecords.map((record) => record.id));
      }

      if (records.length > 0) {
        await database.tabs.bulkPut(records);
      }
    });
  });
}

export async function getSettingValue<T>(key: string, fallback: T): Promise<T> {
  return readFromDatabase(async (database) => {
    const record = await database.settings.get(key);

    if (!record) {
      return fallback;
    }

    return parseStoredValue(record.value, fallback);
  }, fallback);
}

export async function setSettingValue<T>(key: string, value: T): Promise<void> {
  await writeToDatabase(async (database) => {
    await database.settings.put({
      key,
      value,
      updatedAt: nowIsoTimestamp(),
    });
  });
}

export async function getVariableValue<T>(
  key: string,
  fallback: T,
): Promise<T> {
  return readFromDatabase(async (database) => {
    const record = await database.variables.get(key);

    if (!record) {
      return fallback;
    }

    return parseStoredValue(record.value, fallback);
  }, fallback);
}

export async function setVariableValue<T>(
  key: string,
  value: T,
): Promise<void> {
  await writeToDatabase(async (database) => {
    await database.variables.put({
      key,
      value,
      updatedAt: nowIsoTimestamp(),
    });
  });
}

export async function loadSavedQueriesFromStorage(): Promise<StoredSavedQuery[]> {
  return readFromDatabase(async (database) => {
    const records = await database.queries.orderBy("updatedAt").reverse().toArray();

    return records.map((record) => ({
      id: record.id,
      connectionId: record.connectionId,
      schemaName: record.schemaName,
      name: record.name,
      sql: record.sql,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }));
  }, []);
}

export async function saveSavedQueryToStorage(
  query: StoredSavedQuery,
): Promise<void> {
  await writeToDatabase(async (database) => {
    await database.queries.put({
      id: query.id,
      connectionId: query.connectionId,
      schemaName: query.schemaName,
      name: query.name,
      sql: query.sql,
      createdAt: query.createdAt,
      updatedAt: query.updatedAt,
    });
  });
}

export async function removeSavedQueryFromStorage(id: string): Promise<void> {
  await writeToDatabase(async (database) => {
    await database.queries.delete(id);
  });
}
