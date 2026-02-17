import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { useStorage } from "@vueuse/core";
import { format } from "sql-formatter";
import { getQueryEngine } from "../core/query-engine-service";
import type { QueryResult } from "../core/types";
import { useAppSettingsStore } from "./app-settings";
import { useConnectionsStore } from "./connections";

export type QueryTab = {
  id: string;
  title: string;
  sql: string;
};

type TableMap = Record<string, Array<{ name: string }>>;

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
  const tabs = useStorage<QueryTab[]>("qwerio.workbench.tabs", [
    {
      id: crypto.randomUUID(),
      title: "Query 1",
      sql: DEFAULT_SQL,
    },
  ]);
  if (tabs.value.length === 0) {
    tabs.value = [
      {
        id: crypto.randomUUID(),
        title: "Query 1",
        sql: DEFAULT_SQL,
      },
    ];
  }

  const activeTabId = useStorage<string>("qwerio.workbench.activeTabId", tabs.value[0].id);
  const isRunning = ref(false);
  const errorMessage = ref<string>("");
  const schemaNames = ref<Array<{ name: string }>>([]);
  const tableMap = ref<TableMap>({});
  const resultByTabId = ref<Record<string, QueryResult | null>>(
    Object.fromEntries(tabs.value.map((tab) => [tab.id, null])),
  );

  const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null);
  const activeResult = computed(() => (activeTab.value ? resultByTabId.value[activeTab.value.id] ?? null : null));

  watch(
    () => tabs.value.map((tab) => tab.id),
    (tabIds) => {
      if (tabIds.length === 0) {
        const fallbackTab: QueryTab = {
          id: crypto.randomUUID(),
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

  function addTab(): QueryTab {
    const appSettingsStore = useAppSettingsStore();
    const nextIndex = getNextQueryIndex(tabs.value);
    const newTab: QueryTab = {
      id: crypto.randomUUID(),
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

  function formatActiveSql(): void {
    const tab = activeTab.value;

    if (!tab) {
      return;
    }

    tab.sql = format(tab.sql, { language: "postgresql" });
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
      return;
    }

    const engine = getQueryEngine();
    await engine.connect(activeConnection);
    const schemas = await engine.listSchemas(activeConnection.id);
    schemaNames.value = schemas;

    const nextMap: TableMap = {};

    await Promise.all(
      schemas.map(async (schema) => {
        nextMap[schema.name] = await engine.listTables(activeConnection.id, schema.name);
      }),
    );

    tableMap.value = nextMap;
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
    addTab,
    closeTab,
    setActiveTab,
    updateActiveSql,
    formatActiveSql,
    executeActiveQuery,
    refreshSchema,
  };
});
