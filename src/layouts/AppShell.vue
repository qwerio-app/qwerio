<script setup lang="ts">
import { computed } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Database, Dot, Minus, Square, X } from "lucide-vue-next";
import AppSidebar from "../components/layout/AppSidebar.vue";
import { getRuntimeMode } from "../core/query-engine-service";
import { useConnectionsStore } from "../stores/connections";
import { useUiStore } from "../stores/ui";

const connectionsStore = useConnectionsStore();
const uiStore = useUiStore();
const runtimeMode = getRuntimeMode();
const isDesktopRuntime = runtimeMode === "desktop";
const desktopWindow = isDesktopRuntime ? getCurrentWindow() : null;

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

const workspaceGridClass = computed(() =>
  uiStore.sidebarCollapsed
    ? "grid-cols-1 md:grid-cols-[64px_minmax(0,1fr)]"
    : "grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]",
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
</script>

<template>
  <div
    class="mx-auto flex min-h-screen w-full max-w-[1920px] flex-col px-2 pb-2 pt-2 md:px-3"
  >
    <header
      class="panel chrome-panel-header mb-2 flex items-center justify-between px-2.5 py-1.5 md:px-3"
    >
      <div
        class="flex items-center gap-2.5"
        :data-tauri-drag-region="isDesktopRuntime ? '' : undefined"
      >
        <div
          class="flex size-8 items-center justify-center border border-[var(--chrome-red)] bg-[#13090b] text-[var(--chrome-red)]"
        >
          <Database :size="14" />
        </div>

        <div class="leading-none">
          <p
            class="font-display text-lg font-semibold tracking-[0.06em] text-[var(--chrome-ink)]"
          >
            LUMDARA
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <div
          class="hidden items-center gap-2 md:flex"
          :data-tauri-drag-region="isDesktopRuntime ? '' : undefined"
        >
          <span
            class="chrome-pill"
            :class="activeConnectionState ? 'chrome-pill-ok' : 'chrome-pill-bad'"
          >
            <Dot :size="14" />
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
