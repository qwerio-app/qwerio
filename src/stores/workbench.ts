import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { format } from "sql-formatter";
import { getQueryEngine } from "../core/query-engine-service";
import { createEmptySchemaObjectMap, type SchemaObjectMap } from "../core/query-engine";
import type { QueryResult } from "../core/types";
import { useAppSettingsStore } from "./app-settings";
import { useConnectionsStore } from "./connections";
import { createNanoId } from "../core/nano-id";
import {
  loadWorkbenchTabsFromStorage,
  saveWorkbenchTabsToStorage,
  type StoredWorkbenchQueryTab,
  type StoredWorkbenchTableTab,
} from "../core/storage/indexed-db";

export type QueryTab = {
  id: string;
  title: string;
  sql: string;
};

export type TableTab = {
  id: string;
  title: string;
  connectionId: string;
  schemaName: string;
  tableName: string;
  objectType?: "table" | "view";
};

type OpenTableTabInput = {
  connectionId: string;
  schemaName: string;
  tableName: string;
  objectType?: "table" | "view";
};

type TableMap = Record<string, Array<{ name: string }>>;
type SchemaObjectsBySchema = Record<string, SchemaObjectMap>;

const DEFAULT_SQL = "select id, name from users limit 100;";
function getNextQueryIndex(tabs: QueryTab[]): number {
  const maxIndex = tabs.reduce((currentMax, tab) => {
    const match = /^Query (\d+)$/.exec(tab.title);

    if (!match) {
      return currentMax;
    }

    return Math.max(currentMax, Number(match[1]));
  }, 0);

  return maxIndex + 1;
}

export const useWorkbenchStore = defineStore("workbench", () => {
  const tabs = ref<QueryTab[]>([
    {
      id: createNanoId(),
      title: "Query 1",
      sql: DEFAULT_SQL,
    },
  ]);
  const tableTabs = ref<TableTab[]>([]);
  const activeTabId = ref<string>(tabs.value[0].id);
  const hasHydrated = ref(false);
  const isRunning = ref(false);
  const errorMessage = ref<string>("");
  const schemaNames = ref<Array<{ name: string }>>([]);
  const tableMap = ref<TableMap>({});
  const schemaObjectMap = ref<SchemaObjectsBySchema>({});
  const resultByTabId = ref<Record<string, QueryResult | null>>(
    Object.fromEntries(tabs.value.map((tab) => [tab.id, null])),
  );

  const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null);
  const activeResult = computed(() => (activeTab.value ? resultByTabId.value[activeTab.value.id] ?? null : null));

  void (async () => {
    const storedTabs = await loadWorkbenchTabsFromStorage();
    tabs.value = storedTabs.queryTabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      sql: tab.sql,
    }));
    tableTabs.value = storedTabs.tableTabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      connectionId: tab.connectionId,
      schemaName: tab.schemaName,
      tableName: tab.tableName,
      objectType: tab.objectType,
    }));

    if (tabs.value.length === 0) {
      tabs.value = [
        {
          id: createNanoId(),
          title: "Query 1",
          sql: DEFAULT_SQL,
        },
      ];
    }

    activeTabId.value = tabs.value[0].id;

    hasHydrated.value = true;
  })();

  watch(
    () => tabs.value.map((tab) => tab.id),
    (tabIds) => {
      if (tabIds.length === 0) {
        const fallbackTab: QueryTab = {
          id: createNanoId(),
          title: "Query 1",
          sql: DEFAULT_SQL,
        };
        tabs.value = [fallbackTab];
        activeTabId.value = fallbackTab.id;
        resultByTabId.value = { [fallbackTab.id]: null };
        return;
      }

      if (!tabIds.includes(activeTabId.value)) {
        activeTabId.value = tabIds[0];
      }

      const nextResults: Record<string, QueryResult | null> = {};

      tabIds.forEach((tabId) => {
        nextResults[tabId] = resultByTabId.value[tabId] ?? null;
      });

      resultByTabId.value = nextResults;
    },
    { immediate: true },
  );

  watch(
    [tabs, tableTabs],
    ([queryTabs, nextTableTabs]) => {
      if (!hasHydrated.value) {
        return;
      }

      const storedQueryTabs: StoredWorkbenchQueryTab[] = queryTabs.map((tab) => ({
        type: "query",
        id: tab.id,
        title: tab.title,
        sql: tab.sql,
      }));
      const storedTableTabs: StoredWorkbenchTableTab[] = nextTableTabs.map((tab) => ({
        type: "table",
        id: tab.id,
        title: tab.title,
        connectionId: tab.connectionId,
        schemaName: tab.schemaName,
        tableName: tab.tableName,
        objectType: tab.objectType ?? "table",
      }));

      void saveWorkbenchTabsToStorage({
        queryTabs: storedQueryTabs,
        tableTabs: storedTableTabs,
      });
    },
    { deep: true },
  );

  function addTab(): QueryTab {
    const appSettingsStore = useAppSettingsStore();
    const nextIndex = getNextQueryIndex(tabs.value);
    const newTab: QueryTab = {
      id: createNanoId(),
      title: `Query ${nextIndex}`,
      sql: appSettingsStore.newQueryTemplateSql.trim() || DEFAULT_SQL,
    };

    tabs.value.push(newTab);
    activeTabId.value = newTab.id;
    resultByTabId.value[newTab.id] = null;

    return newTab;
  }

  function closeTab(tabId: string): boolean {
    if (tabs.value.length <= 1) {
      return false;
    }

    const tabExists = tabs.value.some((tab) => tab.id === tabId);
    if (!tabExists) {
      return false;
    }

    tabs.value = tabs.value.filter((tab) => tab.id !== tabId);
    delete resultByTabId.value[tabId];

    if (!tabs.value.some((tab) => tab.id === activeTabId.value)) {
      activeTabId.value = tabs.value[0].id;
    }

    return true;
  }

  function setActiveTab(tabId: string): boolean {
    if (!tabs.value.some((tab) => tab.id === tabId)) {
      return false;
    }

    activeTabId.value = tabId;
    return true;
  }

  function updateActiveSql(sql: string): void {
    const tab = activeTab.value;

    if (!tab) {
      return;
    }

    tab.sql = sql;
  }

  function openTableTab({
    connectionId,
    schemaName,
    tableName,
    objectType = "table",
  }: OpenTableTabInput): TableTab {
    let tab = tableTabs.value.find(
      (item) =>
        item.connectionId === connectionId &&
        item.schemaName === schemaName &&
        item.tableName === tableName &&
        (item.objectType ?? "table") === objectType,
    );
    const title = `${schemaName}.${tableName}`;

    if (!tab) {
      tab = {
        id: createNanoId(),
        title,
        connectionId,
        schemaName,
        tableName,
        objectType,
      };
      tableTabs.value = [tab, ...tableTabs.value];
    } else {
      tab.title = title;
      tab.objectType = objectType;
    }

    return tab;
  }

  function getTableTab(tableTabId: string): TableTab | null {
    return tableTabs.value.find((tab) => tab.id === tableTabId) ?? null;
  }

  function removeTableTab(tableTabId: string): void {
    tableTabs.value = tableTabs.value.filter((tab) => tab.id !== tableTabId);
  }

  function formatActiveSql(): void {
    const tab = activeTab.value;

    if (!tab) {
      return;
    }

    const connectionStore = useConnectionsStore();
    const activeConnection = connectionStore.activeProfile;
    const language =
      activeConnection?.target.dialect === "mysql"
        ? "mysql"
        : activeConnection?.target.dialect === "sqlite"
          ? "sqlite"
        : activeConnection?.target.dialect === "sqlserver"
          ? "transactsql"
          : "postgresql";

    tab.sql = format(tab.sql, { language });
  }

  async function executeActiveQuery(): Promise<void> {
    const tab = activeTab.value;

    if (!tab) {
      return;
    }

    const connectionStore = useConnectionsStore();
    const activeConnection = connectionStore.activeProfile;

    if (!activeConnection) {
      errorMessage.value = "Add and select a connection before running queries.";
      return;
    }

    isRunning.value = true;
    errorMessage.value = "";

    try {
      const engine = getQueryEngine();
      await engine.connect(activeConnection);

      const result = await engine.execute({
        connectionId: activeConnection.id,
        sql: tab.sql,
      });

      resultByTabId.value[tab.id] = result;
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : "Query execution failed. Check your connection and SQL.";
    } finally {
      isRunning.value = false;
    }
  }

  async function refreshSchema(): Promise<void> {
    const connectionStore = useConnectionsStore();
    const activeConnection = connectionStore.activeProfile;

    if (!activeConnection) {
      schemaNames.value = [];
      tableMap.value = {};
      schemaObjectMap.value = {};
      return;
    }

    const engine = getQueryEngine();
    await engine.connect(activeConnection);
    let schemas = await engine.listSchemas(activeConnection.id);

    if (schemas.length === 0) {
      try {
        const fallbackSql =
          activeConnection.target.dialect === "postgres"
            ? "select current_schema() as name"
            : activeConnection.target.dialect === "mysql"
              ? "select database() as name"
              : activeConnection.target.dialect === "sqlite"
                ? "select 'main' as name"
                : "select schema_name() as name";
        const fallbackResult = await engine.execute({
          connectionId: activeConnection.id,
          sql: fallbackSql,
        });
        const fallbackName = String(fallbackResult.rows[0]?.name ?? "").trim();

        if (fallbackName.length > 0) {
          schemas = [{ name: fallbackName }];
        }
      } catch {
        // Keep empty schema list when fallback lookup is unavailable.
      }
    }

    schemaNames.value = schemas;

    const nextMap: TableMap = {};
    const nextObjectMap: SchemaObjectsBySchema = {};

    await Promise.all(
      schemas.map(async (schema) => {
        const objects = await engine.listSchemaObjects(activeConnection.id, schema.name);
        nextMap[schema.name] = objects.tables;
        nextObjectMap[schema.name] = {
          ...createEmptySchemaObjectMap(),
          ...objects,
        };
      }),
    );

    tableMap.value = nextMap;
    schemaObjectMap.value = nextObjectMap;
  }

  return {
    tabs,
    activeTab,
    activeTabId,
    activeResult,
    isRunning,
    errorMessage,
    schemaNames,
    tableMap,
    schemaObjectMap,
    tableTabs,
    addTab,
    closeTab,
    setActiveTab,
    updateActiveSql,
    openTableTab,
    getTableTab,
    removeTableTab,
    formatActiveSql,
    executeActiveQuery,
    refreshSchema,
  };
});
