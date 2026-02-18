<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Monitor, Plus, Square, X } from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { getRuntimeMode } from "../../core/query-engine-service";
import { useAppSettingsStore } from "../../stores/app-settings";
import { useAppTabsStore, type AppTab } from "../../stores/app-tabs";
import { useConnectionsStore } from "../../stores/connections";
import { useWorkbenchStore } from "../../stores/workbench";
import AppStatusView from "../../views/AppStatusView.vue";

const route = useRoute();
const router = useRouter();
const appSettingsStore = useAppSettingsStore();
const appTabsStore = useAppTabsStore();
const connectionsStore = useConnectionsStore();
const workbenchStore = useWorkbenchStore();

const runtimeMode = getRuntimeMode();
const isDesktopRuntime = runtimeMode === "desktop";
const desktopWindow = isDesktopRuntime ? getCurrentWindow() : null;

const activeConnectionLabel = computed(() => {
  return connectionsStore.activeProfile?.name ?? "none selected";
});

const activeConnectionState = computed(() =>
  Boolean(connectionsStore.activeProfile),
);

const isSystemStatusOpen = ref(false);
const systemStatusMenuRef = ref<HTMLElement | null>(null);

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
        title: tableTab?.tableName ?? "Table",
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

function toggleSystemStatusMenu(): void {
  isSystemStatusOpen.value = !isSystemStatusOpen.value;
}

function closeSystemStatusMenu(): void {
  isSystemStatusOpen.value = false;
}

function handleDocumentPointerDown(event: MouseEvent): void {
  const eventTarget = event.target;

  if (!(eventTarget instanceof Node)) {
    return;
  }

  if (!systemStatusMenuRef.value?.contains(eventTarget)) {
    closeSystemStatusMenu();
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeSystemStatusMenu();
  }
}

onMounted(() => {
  document.addEventListener("mousedown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeydown);
});

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
      <div
        v-if="appSettingsStore.showSystemStatusButton"
        ref="systemStatusMenuRef"
        class="relative"
      >
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-[3px] border border-[var(--chrome-border-strong)] bg-[#101722] px-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--chrome-ink-dim)] transition hover:border-[#525d74] hover:text-[var(--chrome-ink)]"
          aria-haspopup="menu"
          :aria-expanded="isSystemStatusOpen"
          aria-label="Toggle System Status"
          @click="toggleSystemStatusMenu"
        >
          <Monitor :size="13" />
        </button>

        <div
          v-if="isSystemStatusOpen"
          class="panel absolute right-0 top-[calc(100%+0.4rem)] z-30 w-[min(94vw,680px)] p-2"
          role="menu"
        >
          <AppStatusView />
        </div>
      </div>

      <div
        v-if="appSettingsStore.showConnectionStatusPill"
        class="hidden items-center gap-2 md:flex"
        :data-tauri-drag-region="isDesktopRuntime ? '' : undefined"
      >
        <span
          class="chrome-pill h-7"
          :class="activeConnectionState ? 'chrome-pill-ok' : 'chrome-pill-bad'"
        >
          {{ activeConnectionState ? "connected" : "offline" }}:
          {{ activeConnectionLabel }}
        </span>
      </div>

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
