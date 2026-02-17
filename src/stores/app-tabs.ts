import { computed } from "vue";
import { defineStore } from "pinia";
import { useStorage } from "@vueuse/core";

export type QueryAppTab = {
  id: string;
  kind: "query";
  title: string;
  routePath: "/workbench";
  queryTabId: string;
};

export type PageAppTab = {
  id: string;
  kind: "page";
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
  activate?: boolean;
};

type OpenPageTabInput = {
  pageKey: string;
  title: string;
  routePath: string;
  activate?: boolean;
};

export const useAppTabsStore = defineStore("app-tabs", () => {
  const tabs = useStorage<AppTab[]>("qwerio.ui.appTabs", []);
  const activeTabId = useStorage<string | null>("qwerio.ui.activeAppTabId", null);

  function ensureActiveTab(): void {
    if (tabs.value.length === 0) {
      activeTabId.value = null;
      return;
    }

    if (!activeTabId.value || !tabs.value.some((tab) => tab.id === activeTabId.value)) {
      activeTabId.value = tabs.value[tabs.value.length - 1].id;
    }
  }

  ensureActiveTab();

  const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null);

  function setActiveTab(tabId: string): void {
    if (!tabs.value.some((tab) => tab.id === tabId)) {
      return;
    }

    activeTabId.value = tabId;
  }

  function openQueryTab({ queryTabId, title, activate = true }: OpenQueryTabInput): QueryAppTab {
    let tab = tabs.value.find((item): item is QueryAppTab => item.kind === "query" && item.queryTabId === queryTabId);

    if (!tab) {
      tab = {
        id: crypto.randomUUID(),
        kind: "query",
        title,
        routePath: "/workbench",
        queryTabId,
      };
      tabs.value.push(tab);
    } else if (tab.title !== title) {
      tab.title = title;
    }

    if (activate) {
      activeTabId.value = tab.id;
    }

    return tab;
  }

  function openPageTab({ pageKey, title, routePath, activate = true }: OpenPageTabInput): PageAppTab {
    let tab = tabs.value.find((item): item is PageAppTab => item.kind === "page" && item.pageKey === pageKey);

    if (!tab) {
      tab = {
        id: crypto.randomUUID(),
        kind: "page",
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
      return true;
    });

    ensureActiveTab();
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    setActiveTab,
    openQueryTab,
    openPageTab,
    closeTab,
    syncQueryTabs,
  };
});
