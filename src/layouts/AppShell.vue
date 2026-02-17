<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Monitor, Square, X } from "lucide-vue-next";
import AppSidebar from "../components/layout/AppSidebar.vue";
import { getRuntimeMode } from "../core/query-engine-service";
import { useConnectionsStore } from "../stores/connections";
import { useUiStore } from "../stores/ui";
import SettingsView from "../views/SettingsView.vue";

const connectionsStore = useConnectionsStore();
const uiStore = useUiStore();
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
</script>

<template>
  <div
    class="mx-auto flex min-h-screen w-full max-w-[1920px] flex-col px-2 pb-2 pt-2 md:px-3"
  >
    <header
      class="panel chrome-panel-header mb-2 flex items-center justify-between px-2.5 py-1.5 md:px-3"
    >
      <div
        class="flex items-center gap-1.5"
        :data-tauri-drag-region="isDesktopRuntime ? '' : undefined"
      >
        <div class="overflow-hidden">
          <img
            src="/logo.png"
            alt="Lumdara logo"
            class="size-10 object-cover"
          />
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
        <div ref="systemStatusMenuRef" class="relative">
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
            <SettingsView />
          </div>
        </div>

        <div
          class="hidden items-center gap-2 md:flex"
          :data-tauri-drag-region="isDesktopRuntime ? '' : undefined"
        >
          <span
            class="chrome-pill h-7"
            :class="
              activeConnectionState ? 'chrome-pill-ok' : 'chrome-pill-bad'
            "
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
