import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { format } from "sql-formatter";
import { getQueryEngine } from "../core/query-engine-service";
import type { QueryResult } from "../core/types";
import { useConnectionsStore } from "./connections";

export type QueryTab = {
  id: string;
  title: string;
  sql: string;
};

type TableMap = Record<string, Array<{ name: string }>>;

const DEFAULT_SQL = "select id, name from users limit 100;";

export const useWorkbenchStore = defineStore("workbench", () => {
  const tabs = ref<QueryTab[]>([
    {
      id: crypto.randomUUID(),
      title: "Query 1",
      sql: DEFAULT_SQL,
    },
  ]);
  const activeTabId = ref<string>(tabs.value[0].id);
  const isRunning = ref(false);
  const errorMessage = ref<string>("");
  const schemaNames = ref<Array<{ name: string }>>([]);
  const tableMap = ref<TableMap>({});
  const resultByTabId = ref<Record<string, QueryResult | null>>({
    [tabs.value[0].id]: null,
  });

  const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null);
  const activeResult = computed(() => (activeTab.value ? resultByTabId.value[activeTab.value.id] ?? null : null));

  function addTab(): void {
    const nextIndex = tabs.value.length + 1;
    const newTab: QueryTab = {
      id: crypto.randomUUID(),
      title: `Query ${nextIndex}`,
      sql: "select now();",
    };

    tabs.value.push(newTab);
    activeTabId.value = newTab.id;
    resultByTabId.value[newTab.id] = null;
  }

  function closeTab(tabId: string): void {
    if (tabs.value.length <= 1) {
      return;
    }

    tabs.value = tabs.value.filter((tab) => tab.id !== tabId);
    delete resultByTabId.value[tabId];

    if (!tabs.value.some((tab) => tab.id === activeTabId.value)) {
      activeTabId.value = tabs.value[0].id;
    }
  }

  function setActiveTab(tabId: string): void {
    activeTabId.value = tabId;
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
