import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { format } from "sql-formatter";
import { getQueryEngine } from "../core/query-engine-service";
import { createEmptySchemaObjectMap, type SchemaObjectMap } from "../core/query-engine";
import { SecretPinRequiredError } from "../core/secret-vault";
import {
  buildPaginatedSql,
  clampPageSize,
  isLikelyTabularQuery,
  stripTrailingSemicolons,
} from "../core/sql-pagination";
import type {
  ConnectionProfile,
  DataObjectType,
  DesktopPostgresTlsMode,
  QueryResult,
} from "../core/types";
import { useAppSettingsStore } from "./app-settings";
import { useConnectionsStore } from "./connections";
import { useVaultStore } from "./vault";
import { createNanoId } from "../core/nano-id";
import {
  loadWorkbenchTabsFromStorage,
  saveWorkbenchTabsToStorage,
  type StoredWorkbenchQueryTab,
  type StoredWorkbenchTableTab,
} from "../core/storage/indexed-db";

export type QueryTab = {
  id: string;
  connectionId: string;
  title: string;
  sql: string;
  savedQueryId?: string;
};

export type TableTab = {
  id: string;
  title: string;
  connectionId: string;
  schemaName: string;
  tableName: string;
  objectType?: DataObjectType;
};

type OpenTableTabInput = {
  connectionId: string;
  schemaName: string;
  tableName: string;
  objectType?: DataObjectType;
};

type TableMap = Record<string, Array<{ name: string }>>;
type SchemaObjectsBySchema = Record<string, SchemaObjectMap>;
type QueryExecutionMode = "raw" | "paginated";

type QueryPaginationState = {
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  totalRows: number | null;
  mode: QueryExecutionMode;
  lastConnectionId: string | null;
  lastBaseSql: string;
};

const DEFAULT_SQL = "select id, name from users limit 100;";
const DEFAULT_PAGE_SIZE = 200;

function getDefaultPaginationState(): QueryPaginationState {
  return {
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    hasNextPage: false,
    totalRows: null,
    mode: "raw",
    lastConnectionId: null,
    lastBaseSql: "",
  };
}

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
  const tabs = ref<QueryTab[]>([]);
  const tableTabs = ref<TableTab[]>([]);
  const activeTabId = ref<string>("");
  const hasHydrated = ref(false);
  const isRunning = ref(false);
  const errorMessage = ref<string>("");
  const schemaNames = ref<Array<{ name: string }>>([]);
  const tableMap = ref<TableMap>({});
  const schemaObjectMap = ref<SchemaObjectsBySchema>({});
  const resultByTabId = ref<Record<string, QueryResult | null>>({});
  const paginationByTabId = ref<Record<string, QueryPaginationState>>({});
  const hydratedConnectionId = ref<string | null>(null);

  const connectionStore = useConnectionsStore();
  let hydrationRequestId = 0;

  const activeTab = computed(() =>
    tabs.value.find((tab) => tab.id === activeTabId.value) ?? null,
  );
  const activeResult = computed(() =>
    activeTab.value ? resultByTabId.value[activeTab.value.id] ?? null : null,
  );
  const activePagination = computed<QueryPaginationState>(() =>
    activeTab.value
      ? paginationByTabId.value[activeTab.value.id] ??
        getDefaultPaginationState()
      : getDefaultPaginationState(),
  );

  function resolveScopeConnectionId(): string {
    return connectionStore.activeConnectionId ?? "";
  }

  async function hydrateTabsForConnection(connectionId: string | null): Promise<void> {
    const requestId = ++hydrationRequestId;

    const storedTabs = connectionId
      ? await loadWorkbenchTabsFromStorage(connectionId)
      : {
          queryTabs: [] as StoredWorkbenchQueryTab[],
          tableTabs: [] as StoredWorkbenchTableTab[],
        };

    if (requestId !== hydrationRequestId) {
      return;
    }

    tabs.value = storedTabs.queryTabs.map((tab) => ({
      id: tab.id,
      connectionId: tab.connectionId,
      title: tab.title,
      sql: tab.sql,
      savedQueryId: tab.savedQueryId,
    }));
    tableTabs.value = storedTabs.tableTabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      connectionId: tab.connectionId,
      schemaName: tab.schemaName,
      tableName: tab.tableName,
      objectType: tab.objectType,
    }));

    activeTabId.value = tabs.value[0]?.id ?? "";
    hydratedConnectionId.value = connectionId;
    hasHydrated.value = true;
  }

  watch(
    () =>
      [connectionStore.hasHydrated, connectionStore.activeConnectionId] as const,
    ([connectionsHydrated, connectionId]) => {
      if (!connectionsHydrated) {
        return;
      }

      void hydrateTabsForConnection(connectionId);
    },
    { immediate: true },
  );

  watch(
    () => tabs.value.map((tab) => tab.id),
    (tabIds) => {
      if (tabIds.length === 0) {
        activeTabId.value = "";
        resultByTabId.value = {};
        paginationByTabId.value = {};
        return;
      }

      if (!tabIds.includes(activeTabId.value)) {
        activeTabId.value = tabIds[0];
      }

      const nextResults: Record<string, QueryResult | null> = {};
      const nextPagination: Record<string, QueryPaginationState> = {};

      tabIds.forEach((tabId) => {
        nextResults[tabId] = resultByTabId.value[tabId] ?? null;
        nextPagination[tabId] =
          paginationByTabId.value[tabId] ?? getDefaultPaginationState();
      });

      resultByTabId.value = nextResults;
      paginationByTabId.value = nextPagination;
    },
    { immediate: true },
  );

  watch(
    [tabs, tableTabs, () => connectionStore.activeConnectionId],
    ([queryTabs, nextTableTabs, activeConnectionId]) => {
      if (
        !hasHydrated.value ||
        !activeConnectionId ||
        hydratedConnectionId.value !== activeConnectionId
      ) {
        return;
      }

      const storedQueryTabs: StoredWorkbenchQueryTab[] = queryTabs.map(
        (tab) => ({
          type: "query",
          id: tab.id,
          connectionId: activeConnectionId,
          title: tab.title,
          sql: tab.sql,
          savedQueryId: tab.savedQueryId,
        }),
      );
      const storedTableTabs: StoredWorkbenchTableTab[] = nextTableTabs.map(
        (tab) => ({
          type: "table",
          id: tab.id,
          title: tab.title,
          connectionId: tab.connectionId,
          schemaName: tab.schemaName,
          tableName: tab.tableName,
          objectType: tab.objectType ?? "table",
        }),
      );

      void saveWorkbenchTabsToStorage({
        connectionId: activeConnectionId,
        queryTabs: storedQueryTabs,
        tableTabs: storedTableTabs,
      });
    },
    { deep: true },
  );

  function createQueryTab(input: {
    title: string;
    sql: string;
    savedQueryId?: string;
  }): QueryTab {
    const connectionId = resolveScopeConnectionId();
    const tab: QueryTab = {
      id: createNanoId(),
      connectionId,
      title: input.title,
      sql: input.sql,
      savedQueryId: input.savedQueryId,
    };

    tabs.value.push(tab);
    activeTabId.value = tab.id;
    resultByTabId.value[tab.id] = null;
    paginationByTabId.value[tab.id] = getDefaultPaginationState();
    return tab;
  }

  function addTab(): QueryTab {
    const appSettingsStore = useAppSettingsStore();
    const nextIndex = getNextQueryIndex(tabs.value);
    return createQueryTab({
      title: `Query ${nextIndex}`,
      sql: appSettingsStore.newQueryTemplateSql.trim() || DEFAULT_SQL,
    });
  }

  function addTabFromSavedQuery(input: {
    savedQueryId?: string;
    title: string;
    sql: string;
  }): QueryTab {
    return createQueryTab({
      title: input.title.trim() || `Query ${getNextQueryIndex(tabs.value)}`,
      sql: input.sql.trim(),
      savedQueryId: input.savedQueryId,
    });
  }

  function openSavedQueryTab(input: {
    savedQueryId: string;
    title: string;
    sql: string;
  }): QueryTab {
    const normalizedSavedQueryId = input.savedQueryId.trim();
    const normalizedTitle =
      input.title.trim() || `Query ${getNextQueryIndex(tabs.value)}`;
    const normalizedSql = input.sql.trim();

    if (normalizedSavedQueryId.length > 0) {
      const existingTab =
        tabs.value.find((tab) => tab.savedQueryId === normalizedSavedQueryId) ??
        null;

      if (existingTab) {
        existingTab.title = normalizedTitle;
        existingTab.sql = normalizedSql;
        activeTabId.value = existingTab.id;
        return existingTab;
      }
    }

    return createQueryTab({
      title: normalizedTitle,
      sql: normalizedSql,
      savedQueryId:
        normalizedSavedQueryId.length > 0 ? normalizedSavedQueryId : undefined,
    });
  }

  function closeTab(tabId: string): boolean {
    const tabExists = tabs.value.some((tab) => tab.id === tabId);
    if (!tabExists) {
      return false;
    }

    tabs.value = tabs.value.filter((tab) => tab.id !== tabId);
    delete resultByTabId.value[tabId];
    delete paginationByTabId.value[tabId];

    if (!tabs.value.some((tab) => tab.id === activeTabId.value)) {
      activeTabId.value = tabs.value[0]?.id ?? "";
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

  function bindActiveTabToSavedQuery(input: {
    savedQueryId: string;
    title: string;
  }): void {
    const tab = activeTab.value;

    if (!tab) {
      return;
    }

    const normalizedSavedQueryId = input.savedQueryId.trim();

    if (!normalizedSavedQueryId) {
      return;
    }

    tab.savedQueryId = normalizedSavedQueryId;
    tab.title = input.title.trim() || tab.title;
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

    const activeConnection = connectionStore.activeProfile;
    const language =
      activeConnection?.target.dialect === "mysql"
        ? "mysql"
        : activeConnection?.target.dialect === "sqlite"
          ? "sqlite"
          : activeConnection?.target.dialect === "sqlserver"
            ? "transactsql"
            : activeConnection?.target.dialect === "postgres"
              ? "postgresql"
              : null;

    if (!language) {
      return;
    }

    tab.sql = format(tab.sql, { language });
  }

  function resolveResultPageSize(): number {
    const appSettingsStore = useAppSettingsStore();
    return clampPageSize(appSettingsStore.resultsPageSize, DEFAULT_PAGE_SIZE);
  }

  function resolveConnectionById(connectionId: string): ConnectionProfile | null {
    return (
      connectionStore.profiles.find((profile) => profile.id === connectionId) ??
      null
    );
  }

  function applyResolvedDesktopTlsMode(
    connection: ConnectionProfile,
    connectResult: { resolvedDesktopTlsMode?: DesktopPostgresTlsMode },
  ): void {
    if (
      connection.target.kind !== "desktop-tcp" ||
      connection.target.dialect !== "postgres" ||
      !connectResult.resolvedDesktopTlsMode
    ) {
      return;
    }

    connectionStore.setDesktopPostgresTlsMode(
      connection.id,
      connectResult.resolvedDesktopTlsMode,
    );
  }

  async function executeQueryPage(input: {
    tab: QueryTab;
    connection: ConnectionProfile;
    baseSql: string;
    page: number;
  }): Promise<void> {
    isRunning.value = true;
    errorMessage.value = "";

    try {
      const engine = getQueryEngine();
      const connectResult = await engine.connect(input.connection);
      applyResolvedDesktopTlsMode(input.connection, connectResult);

      const normalizedBaseSql = stripTrailingSemicolons(input.baseSql);
      const shouldPaginate = isLikelyTabularQuery(normalizedBaseSql);

      if (!shouldPaginate) {
        const rawResult = await engine.execute({
          connectionId: input.connection.id,
          sql: normalizedBaseSql,
        });

        resultByTabId.value[input.tab.id] = rawResult;
        paginationByTabId.value[input.tab.id] = {
          ...getDefaultPaginationState(),
          mode: "raw",
          page: 1,
          pageSize: resolveResultPageSize(),
          totalRows: rawResult.rowCount,
          lastConnectionId: input.connection.id,
          lastBaseSql: normalizedBaseSql,
        };
        return;
      }

      const pageSize = resolveResultPageSize();
      const paginatedSql = buildPaginatedSql({
        dialect: input.connection.target.dialect,
        sql: normalizedBaseSql,
        page: input.page,
        pageSize,
        fetchExtraRow: true,
      });
      const result = await engine.execute({
        connectionId: input.connection.id,
        sql: paginatedSql,
      });
      const hasNextPage = result.rows.length > pageSize;
      const rows = hasNextPage ? result.rows.slice(0, pageSize) : result.rows;

      resultByTabId.value[input.tab.id] = {
        ...result,
        rows,
        rowCount: rows.length,
      };
      paginationByTabId.value[input.tab.id] = {
        page: input.page,
        pageSize,
        hasNextPage,
        totalRows: null,
        mode: "paginated",
        lastConnectionId: input.connection.id,
        lastBaseSql: normalizedBaseSql,
      };
    } catch (error) {
      if (error instanceof SecretPinRequiredError) {
        const vaultStore = useVaultStore();
        vaultStore.requestUnlockPrompt(error.envelope);
      }

      errorMessage.value =
        error instanceof Error
          ? error.message
          : "Query execution failed. Check your connection and SQL.";
    } finally {
      isRunning.value = false;
    }
  }

  async function executeActiveQuery(): Promise<void> {
    const tab = activeTab.value;

    if (!tab) {
      return;
    }

    const activeConnection = connectionStore.activeProfile;

    if (!activeConnection) {
      errorMessage.value = "Add and select a connection before running queries.";
      return;
    }

    await executeQueryPage({
      tab,
      connection: activeConnection,
      baseSql: tab.sql,
      page: 1,
    });
  }

  async function loadActiveQueryPage(page: number): Promise<void> {
    const tab = activeTab.value;

    if (!tab) {
      return;
    }

    const state = paginationByTabId.value[tab.id];

    if (!state || state.mode !== "paginated" || !state.lastConnectionId) {
      return;
    }

    const connection = resolveConnectionById(state.lastConnectionId);

    if (!connection) {
      errorMessage.value =
        "The connection used by this result no longer exists. Run the query again.";
      return;
    }

    await executeQueryPage({
      tab,
      connection,
      baseSql: state.lastBaseSql,
      page: Math.max(1, Math.floor(page)),
    });
  }

  async function refreshSchema(): Promise<void> {
    const activeConnection = connectionStore.activeProfile;

    if (!activeConnection) {
      schemaNames.value = [];
      tableMap.value = {};
      schemaObjectMap.value = {};
      return;
    }

    try {
      const engine = getQueryEngine();
      const connectResult = await engine.connect(activeConnection);
      applyResolvedDesktopTlsMode(activeConnection, connectResult);
      let schemas = await engine.listSchemas(activeConnection.id);

      if (
        schemas.length === 0 &&
        (activeConnection.target.dialect === "postgres" ||
          activeConnection.target.dialect === "mysql" ||
          activeConnection.target.dialect === "sqlite" ||
          activeConnection.target.dialect === "sqlserver")
      ) {
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
    } catch (error) {
      if (error instanceof SecretPinRequiredError) {
        const vaultStore = useVaultStore();
        vaultStore.requestUnlockPrompt(error.envelope);
      }

      throw error;
    }
  }

  return {
    tabs,
    hasHydrated,
    activeTab,
    activeTabId,
    activeResult,
    activePagination,
    isRunning,
    errorMessage,
    schemaNames,
    tableMap,
    schemaObjectMap,
    tableTabs,
    addTab,
    addTabFromSavedQuery,
    openSavedQueryTab,
    closeTab,
    setActiveTab,
    updateActiveSql,
    bindActiveTabToSavedQuery,
    openTableTab,
    getTableTab,
    removeTableTab,
    formatActiveSql,
    executeActiveQuery,
    loadActiveQueryPage,
    refreshSchema,
  };
});
