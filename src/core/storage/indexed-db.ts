import Dexie, { type Table } from "dexie";
import type { ConnectionProfile } from "../types";

const DATABASE_NAME = "qwerio.app";
const TABLE_OBJECT_TYPE_SQL_PREFIX = "__qwerio_object_type__:";

export type StoredWorkbenchQueryTab = {
  type: "query";
  id: string;
  title: string;
  sql: string;
};

export type StoredWorkbenchTableTab = {
  type: "table";
  id: string;
  title: string;
  connectionId: string;
  schemaName: string;
  tableName: string;
  objectType: "table" | "view";
};

export type StoredAppQueryTab = {
  type: "query";
  id: string;
  title: string;
  routePath: string;
  queryTabId: string;
};

export type StoredAppTableTab = {
  type: "table";
  id: string;
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

class QwerioAppDatabase extends Dexie {
  connections!: Table<StoredConnectionRecord, string>;
  tabs!: Table<StoredTabRecord, string>;
  settings!: Table<StoredSettingRecord, string>;
  variables!: Table<StoredVariableRecord, string>;

  constructor() {
    super(DATABASE_NAME);

    this.version(2).stores({
      connections: "id, order, updatedAt",
      tabs: "id, type, order, tabId, connectionId, [type+tabId], updatedAt",
      settings: "key, updatedAt",
      variables: "key, updatedAt",
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

function toTablePageKey(tabId: string): string {
  return `table:${tabId}`;
}

function parseTableTabIdFromPageKey(pageKey: string): string | null {
  if (!pageKey.startsWith("table:")) {
    return null;
  }

  const tabId = pageKey.slice("table:".length).trim();
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
  return value === "view" ? "view" : "table";
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

export async function loadWorkbenchTabsFromStorage(): Promise<{
  queryTabs: StoredWorkbenchQueryTab[];
  tableTabs: StoredWorkbenchTableTab[];
}> {
  return readFromDatabase(
    async (database) => {
      const records = await database.tabs.orderBy("order").toArray();

      const queryTabs = records
        .filter((record): record is StoredTabRecord => record.type === "query")
        .sort((left, right) => left.order - right.order)
        .map((tab) => ({
          type: "query" as const,
          id: tab.tabId,
          title: tab.title,
          sql: tab.sql,
        }));

      const tableTabs = records
        .filter(isStoredTableRecordWithConnection)
        .sort((left, right) => left.order - right.order)
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
  queryTabs: StoredWorkbenchQueryTab[];
  tableTabs: StoredWorkbenchTableTab[];
}): Promise<void> {
  const timestamp = nowIsoTimestamp();
  await writeToDatabase(async (database) => {
    await database.transaction("rw", database.tabs, async () => {
      const existingRecords = await database.tabs.toArray();
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
            order: existingRecord?.order ?? order,
            connectionId: null,
            tabId: tab.id,
            path: existingRecord?.path ?? toQueryPath(tab.id),
            sql: tab.sql,
            title: tab.title,
            updatedAt: timestamp,
          };
        }),
        ...input.tableTabs.map((tab, order) => {
          const tabKey = toTabRecordKey("table", tab.id);
          const existingRecord = existingByTabKey.get(tabKey);

          return {
            id: existingRecord?.id ?? toTabRecordKey("table", tab.id),
            type: "table" as const,
            order: existingRecord?.order ?? input.queryTabs.length + order,
            connectionId: tab.connectionId,
            tabId: tab.id,
            path: existingRecord?.path ?? toTablePath(tab.id),
            sql: encodeTableObjectType(tab.objectType ?? "table"),
            title: tab.title,
            updatedAt: timestamp,
          };
        }),
      ];

      if (nextRecords.length > 0) {
        await database.tabs.bulkPut(nextRecords);
      }
    });
  });
}

export async function loadAppTabsFromStorage(): Promise<
  Array<StoredAppQueryTab | StoredAppTableTab>
> {
  return readFromDatabase(async (database) => {
    const records = await database.tabs.orderBy("order").toArray();

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
              title: tab.title,
              routePath: tab.path || toQueryPath(tab.tabId),
              queryTabId: tab.tabId,
            }
          : {
              type: "table",
              id: tab.id,
              title: tab.title,
              routePath: tab.path || toTablePath(tab.tabId),
              pageKey: toTablePageKey(tab.tabId),
            },
      );
  }, []);
}

export async function saveAppTabsToStorage(
  tabs: Array<StoredAppQueryTab | StoredAppTableTab>,
): Promise<void> {
  const timestamp = nowIsoTimestamp();
  await writeToDatabase(async (database) => {
    await database.transaction("rw", database.tabs, async () => {
      const existingRecords = await database.tabs.toArray();
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
            id: toTabRecordKey("query", tabId),
            type: "query",
            order,
            connectionId: null,
            tabId,
            path: tab.routePath || toQueryPath(tabId),
            sql: existingRecord?.type === "query" ? existingRecord.sql : "",
            title: tab.title,
            updatedAt: timestamp,
          });
          return;
        }

        const tableTabId = parseTableTabIdFromPageKey(tab.pageKey);
        if (!tableTabId) {
          return;
        }

        const existingRecord = existingByTabKey.get(
          toTabRecordKey("table", tableTabId),
        );
        records.push({
          id: toTabRecordKey("table", tableTabId),
          type: "table",
          order,
          connectionId:
            existingRecord?.type === "table"
              ? existingRecord.connectionId
              : null,
          tabId: tableTabId,
          path: tab.routePath || toTablePath(tableTabId),
          sql:
            existingRecord?.type === "table"
              ? existingRecord.sql
              : encodeTableObjectType("table"),
          title: resolveTableRecordTitle(
            tab.title,
            existingRecord?.title ?? null,
          ),
          updatedAt: timestamp,
        });
      });

      await database.tabs.clear();

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
