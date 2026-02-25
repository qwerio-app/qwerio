import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import {
  getVariableValue,
  loadAppTabsFromStorage,
  saveAppTabsToStorage,
  setVariableValue,
  type StoredAppQueryTab,
  type StoredAppTableTab,
} from "../core/storage/indexed-db";
import { useConnectionsStore } from "./connections";

export type QueryAppTab = {
  id: string;
  kind: "query";
  connectionId: string;
  title: string;
  routePath: string;
  queryTabId: string;
};

export type PageAppTab = {
  id: string;
  kind: "page";
  connectionId: string;
  title: string;
  routePath: string;
  pageKey: string;
};

export type AppTab = QueryAppTab | PageAppTab;

type QueryTabSnapshot = {
  id: string;
  title: string;
};

type OpenQueryTabInput = {
  queryTabId: string;
  title: string;
  routePath: string;
  activate?: boolean;
};

type OpenPageTabInput = {
  pageKey: string;
  title: string;
  routePath: string;
  activate?: boolean;
};

const ACTIVE_APP_TAB_ID_KEY = "variables.appTabs.activeTabId";

function toQueryAppTabId(queryTabId: string): string {
  return `query:${queryTabId}`;
}

function toPageAppTabId(pageKey: string): string {
  return pageKey;
}

function isTabbablePageKey(pageKey: string): boolean {
  return pageKey.startsWith("table:") || pageKey.startsWith("collection:");
}

function isTabbableAppTab(tab: AppTab): boolean {
  if (tab.kind === "query") {
    return true;
  }

  return isTabbablePageKey(tab.pageKey);
}

export const useAppTabsStore = defineStore("app-tabs", () => {
  const tabs = ref<AppTab[]>([]);
  const activeTabId = ref<string | null>(null);
  const hasHydrated = ref(false);
  const hydratedConnectionId = ref<string | null>(null);

  const connectionStore = useConnectionsStore();
  let hydrationRequestId = 0;
  let hasLoadedActiveTabId = false;

  async function hydrateTabsForConnection(connectionId: string | null): Promise<void> {
    const requestId = ++hydrationRequestId;

    if (!hasLoadedActiveTabId) {
      activeTabId.value = await getVariableValue<string | null>(
        ACTIVE_APP_TAB_ID_KEY,
        null,
      );
      hasLoadedActiveTabId = true;
    }

    const storedTabs = await loadAppTabsFromStorage(connectionId);

    if (requestId !== hydrationRequestId) {
      return;
    }

    tabs.value = storedTabs.map((tab) =>
      tab.type === "query"
        ? {
            id: toQueryAppTabId(tab.queryTabId),
            kind: "query",
            connectionId: tab.connectionId,
            title: tab.title,
            routePath: tab.routePath,
            queryTabId: tab.queryTabId,
          }
        : {
            id: toPageAppTabId(tab.pageKey),
            kind: "page",
            connectionId: tab.connectionId,
            title: tab.title,
            routePath: tab.routePath,
            pageKey: tab.pageKey,
          },
    );

    ensureActiveTab();
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
    tabs,
    (nextTabs) => {
      const activeConnectionId = connectionStore.activeConnectionId;

      if (
        !hasHydrated.value ||
        !activeConnectionId ||
        hydratedConnectionId.value !== activeConnectionId
      ) {
        return;
      }

      const storedTabs: Array<StoredAppQueryTab | StoredAppTableTab> = nextTabs.map(
        (tab) =>
          tab.kind === "query"
            ? {
                type: "query",
                id: tab.id,
                connectionId: activeConnectionId,
                title: tab.title,
                routePath: tab.routePath,
                queryTabId: tab.queryTabId,
              }
            : {
                type: "table",
                id: tab.id,
                connectionId: activeConnectionId,
                title: tab.title,
                routePath: tab.routePath,
                pageKey: tab.pageKey,
              },
      );

      void saveAppTabsToStorage(activeConnectionId, storedTabs);
    },
    { deep: true },
  );

  watch(activeTabId, (value) => {
    if (!hasHydrated.value) {
      return;
    }

    void setVariableValue(ACTIVE_APP_TAB_ID_KEY, value);
  });

  function sanitizeTabs(): void {
    tabs.value = tabs.value.filter(isTabbableAppTab);
  }

  function ensureActiveTab(): void {
    sanitizeTabs();

    if (tabs.value.length === 0) {
      activeTabId.value = null;
      return;
    }

    if (!activeTabId.value || !tabs.value.some((tab) => tab.id === activeTabId.value)) {
      activeTabId.value = tabs.value[tabs.value.length - 1].id;
    }
  }

  ensureActiveTab();

  const activeTab = computed(
    () => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null,
  );

  function resolveScopeConnectionId(): string {
    return connectionStore.activeConnectionId ?? "";
  }

  function setActiveTab(tabId: string): void {
    if (!tabs.value.some((tab) => tab.id === tabId)) {
      return;
    }

    activeTabId.value = tabId;
  }

  function clearActiveTab(): void {
    activeTabId.value = null;
  }

  function openQueryTab({ queryTabId, title, routePath, activate = true }: OpenQueryTabInput): QueryAppTab {
    let tab = tabs.value.find(
      (item): item is QueryAppTab =>
        item.kind === "query" && item.queryTabId === queryTabId,
    );

    if (!tab) {
      tab = {
        id: toQueryAppTabId(queryTabId),
        kind: "query",
        connectionId: resolveScopeConnectionId(),
        title,
        routePath,
        queryTabId,
      };
      tabs.value.push(tab);
    } else {
      tab.routePath = routePath;
      if (tab.title !== title) {
        tab.title = title;
      }
    }

    if (activate) {
      activeTabId.value = tab.id;
    }

    return tab;
  }

  function openPageTab({ pageKey, title, routePath, activate = true }: OpenPageTabInput): PageAppTab {
    if (!isTabbablePageKey(pageKey)) {
      throw new Error(`Unsupported page tab key: ${pageKey}`);
    }

    let tab = tabs.value.find(
      (item): item is PageAppTab => item.kind === "page" && item.pageKey === pageKey,
    );

    if (!tab) {
      tab = {
        id: toPageAppTabId(pageKey),
        kind: "page",
        connectionId: resolveScopeConnectionId(),
        title,
        routePath,
        pageKey,
      };
      tabs.value.push(tab);
    } else {
      tab.title = title;
      tab.routePath = routePath;
    }

    if (activate) {
      activeTabId.value = tab.id;
    }

    return tab;
  }

  function closeTab(tabId: string): AppTab | null {
    const closingIndex = tabs.value.findIndex((tab) => tab.id === tabId);

    if (closingIndex === -1) {
      return activeTab.value;
    }

    tabs.value.splice(closingIndex, 1);

    if (tabs.value.length === 0) {
      activeTabId.value = null;
      return null;
    }

    const nextIndex = Math.min(closingIndex, tabs.value.length - 1);
    const nextTab = tabs.value[nextIndex];
    activeTabId.value = nextTab.id;

    return nextTab;
  }

  function syncQueryTabs(queryTabs: QueryTabSnapshot[]): void {
    const queryTabById = new Map(queryTabs.map((tab) => [tab.id, tab]));

    tabs.value = tabs.value.filter((tab) => {
      if (tab.kind !== "query") {
        return true;
      }

      const sourceTab = queryTabById.get(tab.queryTabId);
      if (!sourceTab) {
        return false;
      }

      tab.title = sourceTab.title;
      tab.routePath = `/query/${sourceTab.id}`;
      return true;
    });

    ensureActiveTab();
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    setActiveTab,
    clearActiveTab,
    openQueryTab,
    openPageTab,
    closeTab,
    syncQueryTabs,
  };
});
