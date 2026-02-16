<script setup lang="ts">
import { computed } from "vue";
import { Bell, Cog, Database, Dot, UserCircle2 } from "lucide-vue-next";
import AppSidebar from "../components/layout/AppSidebar.vue";
import { getRuntimeMode } from "../core/query-engine-service";
import { useConnectionsStore } from "../stores/connections";
import { useUiStore } from "../stores/ui";
import { useWorkbenchStore } from "../stores/workbench";

const runtimeMode = getRuntimeMode();
const connectionsStore = useConnectionsStore();
const uiStore = useUiStore();
const workbenchStore = useWorkbenchStore();

const activeConnectionLabel = computed(() => {
  const active = connectionsStore.activeProfile;

  if (!active) {
    return "NO ACTIVE CONNECTION";
  }

  if (active.target.kind === "desktop-tcp") {
    return `${active.target.host}:${active.target.port}`;
  }

  return active.target.endpoint;
});

const activeConnectionState = computed(() =>
  Boolean(connectionsStore.activeProfile),
);

const activeResultMeta = computed(() => {
  const result = workbenchStore.activeResult;

  if (!result) {
    return "Rows: --";
  }

  return `Rows: ${result.rowCount} / ${result.elapsedMs}ms`;
});

const workspaceGridClass = computed(() =>
  uiStore.sidebarCollapsed
    ? "grid-cols-1 md:grid-cols-[64px_minmax(0,1fr)]"
    : "grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]",
);
</script>

<template>
  <div
    class="mx-auto flex min-h-screen w-full max-w-[1920px] flex-col px-2 pb-2 pt-2 md:px-3"
  >
    <header
      class="panel chrome-panel-header mb-2 flex items-center justify-between px-3 py-2 md:px-4"
    >
      <div class="flex items-center gap-3">
        <div
          class="flex size-9 items-center justify-center border border-[var(--chrome-red)] bg-[#13090b] text-[var(--chrome-red)]"
        >
          <Database :size="17" />
        </div>

        <div class="leading-none">
          <p
            class="font-display text-xl font-semibold tracking-[0.06em] text-[var(--chrome-ink)]"
          >
            LUMDARA
          </p>
        </div>
      </div>

      <div class="hidden items-center gap-2 md:flex">
        <span
          class="chrome-pill"
          :class="activeConnectionState ? 'chrome-pill-ok' : 'chrome-pill-bad'"
        >
          <Dot :size="14" />
          {{ activeConnectionState ? "connected" : "offline" }}:
          {{ activeConnectionLabel }}
        </span>
      </div>
    </header>

    <div :class="['grid min-h-0 flex-1 gap-2', workspaceGridClass]">
      <AppSidebar />

      <main
        class="panel min-h-[calc(100vh-160px)] overflow-hidden p-2 md:p-2.5"
      >
        <RouterView />
      </main>
    </div>
  </div>
</template>
