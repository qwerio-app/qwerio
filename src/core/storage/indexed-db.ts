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

type LegacyStoredWorkbenchQueryTabRecord = StoredWorkbenchQueryTab & {
  scope: "workbench";
  order: number;
  updatedAt?: string;
};

type StoredWorkbenchTableTabRecord = StoredWorkbenchTableTab & {
  scope: "workbench";
  order: number;
  updatedAt?: string;
};

type LegacyStoredAppQueryTabRecord = StoredAppQueryTab & {
  scope: "app";
  order: number;
  updatedAt?: string;
};

type LegacyStoredAppTableTabRecord = StoredAppTableTab & {
  scope: "app";
  order: number;
  updatedAt?: string;
};

type LegacyStoredTabRecord =
  | LegacyStoredWorkbenchQueryTabRecord
  | StoredWorkbenchTableTabRecord
  | LegacyStoredAppQueryTabRecord
  | LegacyStoredAppTableTabRecord;

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

    this.version(1).stores({
      connections: "id, order, updatedAt",
      tabs: "id, scope, type, order, [scope+type], [scope+order], [scope+type+order]",
      settings: "key, updatedAt",
      variables: "key, updatedAt",
    });

    this.version(2)
      .stores({
        connections: "id, order, updatedAt",
        tabs: "id, type, order, tabId, connectionId, [type+tabId], updatedAt",
        settings: "key, updatedAt",
        variables: "key, updatedAt",
      })
      .upgrade(async (transaction) => {
        const tabTable = transaction.table("tabs") as Table<LegacyStoredTabRecord | StoredTabRecord, string>;
        const existingRecords = await tabTable.toArray();
        const migratedRecords = migrateLegacyTabRecords(existingRecords);
        await tabTable.clear();

        if (migratedRecords.length > 0) {
          await tabTable.bulkPut(migratedRecords);
        }
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

function warnAboutStorageFailure(): void {
  if (hasWarnedAboutStorage) {
    return;
  }

  hasWarnedAboutStorage = true;
  console.warn("IndexedDB storage is unavailable. Qwerio is running with in-memory state only.");
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
  } catch {
    warnAboutStorageFailure();
    return fallback;
  }
}

async function writeToDatabase(operation: (database: QwerioAppDatabase) => Promise<void>): Promise<void> {
  if (!appDatabase) {
    return;
  }

  try {
    await operation(appDatabase);
  } catch {
    warnAboutStorageFailure();
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

function asValidTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return Number.isNaN(Date.parse(value)) ? null : value;
}

function resolveUpdatedAt(...values: Array<unknown>): string {
  const timestamps = values
    .map(asValidTimestamp)
    .filter((value): value is string => value !== null)
    .sort((left, right) => Date.parse(left) - Date.parse(right));

  return timestamps[timestamps.length - 1] ?? nowIsoTimestamp();
}

function encodeTableObjectType(objectType: StoredWorkbenchTableTab["objectType"]): string {
  return `${TABLE_OBJECT_TYPE_SQL_PREFIX}${objectType}`;
}

function decodeTableObjectType(sql: string): StoredWorkbenchTableTab["objectType"] {
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

function resolveTableRecordTitle(incomingTitle: string, existingTitle: string | null): string {
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

function isStoredTabRecord(record: LegacyStoredTabRecord | StoredTabRecord): record is StoredTabRecord {
  return "tabId" in record && "path" in record && "connectionId" in record;
}

function isStoredTableRecordWithConnection(
  record: StoredTabRecord,
): record is StoredTabRecord & { type: "table"; connectionId: string } {
  return record.type === "table" && typeof record.connectionId === "string" && record.connectionId.length > 0;
}

function toSerializableConnectionProfile(profile: ConnectionProfile): ConnectionProfile {
  return profile.target.kind === "desktop-tcp"
    ? {
        ...profile,
        target: {
          ...profile.target,
        },
      }
    : {
        ...profile,
        target: {
          ...profile.target,
        },
      };
}

function migrateLegacyTabRecords(records: Array<LegacyStoredTabRecord | StoredTabRecord>): StoredTabRecord[] {
  const migratedUnifiedRecords: StoredTabRecord[] = [];
  const legacyAppRecords: Array<LegacyStoredAppQueryTabRecord | LegacyStoredAppTableTabRecord> = [];
  const legacyWorkbenchQueryByTabId = new Map<string, LegacyStoredWorkbenchQueryTabRecord>();
  const legacyWorkbenchTableByTabId = new Map<string, StoredWorkbenchTableTabRecord>();

  records.forEach((record) => {
    if (isStoredTabRecord(record)) {
      const normalizedTabId = record.tabId.trim();

      if (normalizedTabId.length === 0) {
        return;
      }

      migratedUnifiedRecords.push({
        id: toTabRecordKey(record.type, normalizedTabId),
        type: record.type,
        order: Number.isFinite(record.order) ? record.order : migratedUnifiedRecords.length,
        connectionId: record.type === "table" ? record.connectionId ?? null : null,
        tabId: normalizedTabId,
        path: record.path || (record.type === "query" ? toQueryPath(normalizedTabId) : toTablePath(normalizedTabId)),
        sql:
          record.type === "query"
            ? record.sql ?? ""
            : record.sql || encodeTableObjectType("table"),
        title: record.title || (record.type === "query" ? "Query" : "Table"),
        updatedAt: resolveUpdatedAt(record.updatedAt),
      });
      return;
    }

    if (record.scope === "app") {
      legacyAppRecords.push(record);
      return;
    }

    if (record.type === "query") {
      legacyWorkbenchQueryByTabId.set(record.id, record);
      return;
    }

    legacyWorkbenchTableByTabId.set(record.id, record);
  });

  if (
    legacyAppRecords.length === 0 &&
    legacyWorkbenchQueryByTabId.size === 0 &&
    legacyWorkbenchTableByTabId.size === 0
  ) {
    return migratedUnifiedRecords.sort((left, right) => left.order - right.order);
  }

  const nextRecords: StoredTabRecord[] = [];
  const seenTabKeys = new Set<string>();

  legacyAppRecords
    .sort((left, right) => left.order - right.order)
    .forEach((appRecord) => {
      if (appRecord.type === "query") {
        const tabId = appRecord.queryTabId.trim();
        if (tabId.length === 0) {
          return;
        }

        const tabKey = toTabRecordKey("query", tabId);
        seenTabKeys.add(tabKey);
        const workbenchRecord = legacyWorkbenchQueryByTabId.get(tabId);

        nextRecords.push({
          id: toTabRecordKey("query", tabId),
          type: "query",
          order: nextRecords.length,
          connectionId: null,
          tabId,
          path: appRecord.routePath || toQueryPath(tabId),
          sql: workbenchRecord?.sql ?? "",
          title: workbenchRecord?.title || appRecord.title || "Query",
          updatedAt: resolveUpdatedAt(appRecord.updatedAt, workbenchRecord?.updatedAt),
        });
        return;
      }

      const tableTabId = parseTableTabIdFromPageKey(appRecord.pageKey);
      if (!tableTabId) {
        return;
      }

      const tabKey = toTabRecordKey("table", tableTabId);
      seenTabKeys.add(tabKey);
      const workbenchRecord = legacyWorkbenchTableByTabId.get(tableTabId);

      nextRecords.push({
        id: toTabRecordKey("table", tableTabId),
        type: "table",
        order: nextRecords.length,
        connectionId: workbenchRecord?.connectionId ?? null,
        tabId: tableTabId,
        path: appRecord.routePath || toTablePath(tableTabId),
        sql: workbenchRecord ? encodeTableObjectType(workbenchRecord.objectType ?? "table") : encodeTableObjectType("table"),
        title: workbenchRecord?.title || appRecord.title || "Table",
        updatedAt: resolveUpdatedAt(appRecord.updatedAt, workbenchRecord?.updatedAt),
      });
    });

  [...legacyWorkbenchQueryByTabId.values()]
    .sort((left, right) => left.order - right.order)
    .forEach((queryRecord) => {
      const tabKey = toTabRecordKey("query", queryRecord.id);
      if (seenTabKeys.has(tabKey)) {
        return;
      }

      nextRecords.push({
        id: toTabRecordKey("query", queryRecord.id),
        type: "query",
        order: nextRecords.length,
        connectionId: null,
        tabId: queryRecord.id,
        path: toQueryPath(queryRecord.id),
        sql: queryRecord.sql,
        title: queryRecord.title || "Query",
        updatedAt: resolveUpdatedAt(queryRecord.updatedAt),
      });
    });

  [...legacyWorkbenchTableByTabId.values()]
    .sort((left, right) => left.order - right.order)
    .forEach((tableRecord) => {
      const tabKey = toTabRecordKey("table", tableRecord.id);
      if (seenTabKeys.has(tabKey)) {
        return;
      }

      nextRecords.push({
        id: toTabRecordKey("table", tableRecord.id),
        type: "table",
        order: nextRecords.length,
        connectionId: tableRecord.connectionId ?? null,
        tabId: tableRecord.id,
        path: toTablePath(tableRecord.id),
        sql: encodeTableObjectType(tableRecord.objectType ?? "table"),
        title: tableRecord.title || "Table",
        updatedAt: resolveUpdatedAt(tableRecord.updatedAt),
      });
    });

  migratedUnifiedRecords
    .sort((left, right) => left.order - right.order)
    .forEach((record) => {
      const tabKey = toTabRecordKey(record.type, record.tabId);
      if (seenTabKeys.has(tabKey)) {
        return;
      }

      seenTabKeys.add(tabKey);
      nextRecords.push({
        ...record,
        id: toTabRecordKey(record.type, record.tabId),
        order: nextRecords.length,
      });
    });

  return nextRecords.map((record, order) => ({
    ...record,
    order,
  }));
}

function parseStoredValue<T>(value: unknown, fallback: T): T {
  if (value === undefined) {
    return fallback;
  }

  return value as T;
}

export async function loadConnectionsFromStorage(): Promise<ConnectionProfile[]> {
  return readFromDatabase(async (database) => {
    const records = await database.connections.orderBy("order").toArray();

    return records.map((record) => ({
      id: record.id,
      name: record.name,
      target: toSerializableConnectionProfile(record).target,
      showInternalSchemas: record.showInternalSchemas,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }));
  }, []);
}

export async function saveConnectionsToStorage(profiles: ConnectionProfile[]): Promise<void> {
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
  return readFromDatabase(async (database) => {
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
  }, {
    queryTabs: [],
    tableTabs: [],
  });
}

export async function saveWorkbenchTabsToStorage(input: {
  queryTabs: StoredWorkbenchQueryTab[];
  tableTabs: StoredWorkbenchTableTab[];
}): Promise<void> {
  const timestamp = nowIsoTimestamp();
  await writeToDatabase(async (database) => {
    await database.transaction("rw", database.tabs, async () => {
      const existingRecords = await database.tabs.toArray();
      const existingByTabKey = new Map(existingRecords.map((record) => [toTabRecordKey(record.type, record.tabId), record]));

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

export async function loadAppTabsFromStorage(): Promise<Array<StoredAppQueryTab | StoredAppTableTab>> {
  return readFromDatabase(async (database) => {
    const records = await database.tabs.orderBy("order").toArray();

    return records
      .filter((record): record is StoredTabRecord => record.type === "query" || record.type === "table")
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

export async function saveAppTabsToStorage(tabs: Array<StoredAppQueryTab | StoredAppTableTab>): Promise<void> {
  const timestamp = nowIsoTimestamp();
  await writeToDatabase(async (database) => {
    await database.transaction("rw", database.tabs, async () => {
      const existingRecords = await database.tabs.toArray();
      const existingByTabKey = new Map(existingRecords.map((record) => [toTabRecordKey(record.type, record.tabId), record]));

      const records: StoredTabRecord[] = [];

      tabs.forEach((tab, order) => {
        if (tab.type === "query") {
          const tabId = tab.queryTabId.trim();
          if (tabId.length === 0) {
            return;
          }

          const existingRecord = existingByTabKey.get(toTabRecordKey("query", tabId));
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

        const existingRecord = existingByTabKey.get(toTabRecordKey("table", tableTabId));
        records.push({
          id: toTabRecordKey("table", tableTabId),
          type: "table",
          order,
          connectionId: existingRecord?.type === "table" ? existingRecord.connectionId : null,
          tabId: tableTabId,
          path: tab.routePath || toTablePath(tableTabId),
          sql: existingRecord?.type === "table" ? existingRecord.sql : encodeTableObjectType("table"),
          title: resolveTableRecordTitle(tab.title, existingRecord?.title ?? null),
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

export async function getVariableValue<T>(key: string, fallback: T): Promise<T> {
  return readFromDatabase(async (database) => {
    const record = await database.variables.get(key);

    if (!record) {
      return fallback;
    }

    return parseStoredValue(record.value, fallback);
  }, fallback);
}

export async function setVariableValue<T>(key: string, value: T): Promise<void> {
  await writeToDatabase(async (database) => {
    await database.variables.put({
      key,
      value,
      updatedAt: nowIsoTimestamp(),
    });
  });
}
