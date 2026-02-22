<script setup lang="ts">
import { ref, watch } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Plus, Square, UserRound, X } from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { getRuntimeMode } from "../../core/query-engine-service";
import { useAppTabsStore, type AppTab } from "../../stores/app-tabs";
import { useWorkbenchStore } from "../../stores/workbench";

const route = useRoute();
const router = useRouter();
const appTabsStore = useAppTabsStore();
const workbenchStore = useWorkbenchStore();

const runtimeMode = getRuntimeMode();
const isDesktopRuntime = runtimeMode === "desktop";
const desktopWindow = isDesktopRuntime ? getCurrentWindow() : null;
const userAvatarUrl = ref<string | null>(null);

function toQueryRoutePath(queryTabId: string): string {
  return `/query/${queryTabId}`;
}

function toTableRoutePath(tableTabId: string): string {
  return `/tables/${tableTabId}`;
}

function getTabTitle(tab: AppTab): string {
  if (tab.kind === "query") {
    return tab.title;
  }

  if (!tab.pageKey.startsWith("table:")) {
    return tab.title;
  }

  const tableTabId = tab.pageKey.slice("table:".length);
  const tableTab = workbenchStore.getTableTab(tableTabId);

  if (tableTab?.tableName) {
    return tableTab.tableName;
  }

  const dotIndex = tab.title.lastIndexOf(".");
  return dotIndex >= 0 ? tab.title.slice(dotIndex + 1) : tab.title;
}

watch(
  () => workbenchStore.tabs.map((tab) => ({ id: tab.id, title: tab.title })),
  (queryTabs) => {
    appTabsStore.syncQueryTabs(queryTabs);
  },
  { immediate: true },
);

watch(
  () => [
    route.name,
    route.path,
    route.params.queryTabId,
    route.params.tableTabId,
    workbenchStore.activeTabId,
  ] as const,
  () => {
    if (route.name === "query") {
      const queryTabId =
        typeof route.params.queryTabId === "string"
          ? route.params.queryTabId
          : workbenchStore.activeTab?.id;
      const queryTab = queryTabId
        ? workbenchStore.tabs.find((tab) => tab.id === queryTabId) ?? workbenchStore.activeTab
        : workbenchStore.activeTab;

      if (!queryTab) {
        return;
      }

      appTabsStore.openQueryTab({
        queryTabId: queryTab.id,
        title: queryTab.title,
        routePath: toQueryRoutePath(queryTab.id),
        activate: true,
      });
      return;
    }

    if (route.name === "table") {
      const tableTabId =
        typeof route.params.tableTabId === "string" ? route.params.tableTabId : "";
      const tableTab = tableTabId ? workbenchStore.getTableTab(tableTabId) : null;

      appTabsStore.openPageTab({
        pageKey: `table:${tableTabId}`,
        title: tableTab?.title ?? "Table",
        routePath: tableTabId ? toTableRoutePath(tableTabId) : route.path,
        activate: true,
      });
      return;
    }

    appTabsStore.clearActiveTab();
  },
  { immediate: true },
);

async function minimizeWindow(): Promise<void> {
  if (!desktopWindow) {
    return;
  }

  await desktopWindow.minimize();
}

async function toggleMaximizeWindow(): Promise<void> {
  if (!desktopWindow) {
    return;
  }

  await desktopWindow.toggleMaximize();
}

async function closeWindow(): Promise<void> {
  if (!desktopWindow) {
    return;
  }

  await desktopWindow.close();
}

function handleProfileButtonClick(): void {}

async function activateTab(tab: AppTab): Promise<void> {
  appTabsStore.setActiveTab(tab.id);

  if (tab.kind === "query") {
    workbenchStore.setActiveTab(tab.queryTabId);
  }

  if (route.path !== tab.routePath) {
    await router.push(tab.routePath);
  }
}

async function openNewQueryTab(): Promise<void> {
  const queryTab = workbenchStore.addTab();
  const appTab = appTabsStore.openQueryTab({
    queryTabId: queryTab.id,
    title: queryTab.title,
    routePath: toQueryRoutePath(queryTab.id),
    activate: true,
  });

  await activateTab(appTab);
}

async function closeTab(tab: AppTab): Promise<void> {
  if (tab.kind === "query") {
    const closed = workbenchStore.closeTab(tab.queryTabId);

    if (!closed) {
      return;
    }
  } else if (tab.pageKey.startsWith("table:")) {
    const tableTabId = tab.pageKey.slice("table:".length);
    workbenchStore.removeTableTab(tableTabId);
  }

  const nextTab = appTabsStore.closeTab(tab.id);

  if (nextTab) {
    await activateTab(nextTab);
    return;
  }

  const fallbackQuery = workbenchStore.activeTab ?? workbenchStore.addTab();
  const fallbackAppTab = appTabsStore.openQueryTab({
    queryTabId: fallbackQuery.id,
    title: fallbackQuery.title,
    routePath: toQueryRoutePath(fallbackQuery.id),
    activate: true,
  });

  await activateTab(fallbackAppTab);
}
</script>

<template>
  <header
    class="panel chrome-panel-header flex items-center justify-between gap-2 px-2.5 py-2 md:px-3"
  >
    <div
      class="qwerio-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5"
    >
      <button
        v-for="tab in appTabsStore.tabs"
        :key="tab.id"
        type="button"
        :class="[
          'inline-flex shrink-0 items-center gap-2 border px-2.5 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] transition',
          tab.id === appTabsStore.activeTabId
            ? 'border-[var(--chrome-red)] bg-[var(--chrome-red-soft)] text-[var(--chrome-ink)]'
            : 'border-[var(--chrome-border)] bg-[#11161f] text-[var(--chrome-ink-dim)] hover:border-[var(--chrome-border-strong)] hover:text-[var(--chrome-ink)]',
        ]"
        @click="activateTab(tab)"
      >
        <span class="max-w-36 truncate">{{ getTabTitle(tab) }}</span>
        <X :size="13" class="opacity-80" @click.stop="closeTab(tab)" />
      </button>

      <button
        type="button"
        class="inline-flex shrink-0 items-center justify-center text-xs border border-[var(--chrome-border)] bg-[#11161f] px-1 py-1.5 text-[var(--chrome-ink-dim)] transition hover:border-[var(--chrome-border-strong)] hover:text-[var(--chrome-ink)]"
        aria-label="New query tab"
        @click="openNewQueryTab"
      >
        &nbsp;<Plus :size="13" />&nbsp;
      </button>
    </div>

    <div class="ml-auto flex shrink-0 items-center gap-2">
      <button
        type="button"
        class="inline-flex size-7 shrink-0 items-center justify-center rounded-[3px] border border-[var(--chrome-border-strong)] bg-[#101722] transition hover:border-[#525d74] hover:text-[var(--chrome-ink)]"
        aria-label="User profile"
        @click="handleProfileButtonClick"
      >
        <img
          v-if="userAvatarUrl"
          :src="userAvatarUrl"
          alt="User avatar"
          class="size-5 rounded-full object-cover"
        />
        <UserRound v-else :size="14" class="text-[var(--chrome-ink-muted)]" />
      </button>

      <span
        v-if="isDesktopRuntime"
        class="inline-flex items-center rounded-[3px] border border-[var(--chrome-border)] bg-[#0f141d]"
      >
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center border-r border-[var(--chrome-border)] text-[var(--chrome-ink-dim)] transition hover:bg-[#1a212f] hover:text-[var(--chrome-ink)]"
          aria-label="Minimize window"
          @click="minimizeWindow"
        >
          <Minus :size="13" />
        </button>
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center border-r border-[var(--chrome-border)] text-[var(--chrome-ink-dim)] transition hover:bg-[#1a212f] hover:text-[var(--chrome-ink)]"
          aria-label="Maximize window"
          @click="toggleMaximizeWindow"
        >
          <Square :size="11" />
        </button>
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center text-[#ff8f8f] transition hover:bg-[#3a1117] hover:text-[#ffb3b3]"
          aria-label="Close window"
          @click="closeWindow"
        >
          <X :size="13" />
        </button>
      </span>
    </div>
  </header>
</template>
