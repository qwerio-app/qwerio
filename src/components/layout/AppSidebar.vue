<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import {
  Cable,
  ChevronLeft,
  Database,
  PanelsTopLeft,
  Settings,
} from "lucide-vue-next";
import { useConnectionsStore } from "../../stores/connections";
import { useUiStore } from "../../stores/ui";

const route = useRoute();
const uiStore = useUiStore();
const connectionsStore = useConnectionsStore();

const links = [
  { to: "/workbench", label: "Query Console", icon: PanelsTopLeft },
  { to: "/connections", label: "Connections", icon: Cable },
  { to: "/settings", label: "System", icon: Settings },
];

const sidebarWidthClass = computed(() =>
  uiStore.sidebarCollapsed ? "md:w-[64px]" : "md:w-full",
);

const activeConnectionName = computed(
  () => connectionsStore.activeProfile?.name ?? "none selected",
);

const sidebarHeaderClass = computed(() =>
  uiStore.sidebarCollapsed
    ? "chrome-panel-header mb-2 flex items-center justify-center border border-[var(--chrome-border)] px-1.5 py-2"
    : "chrome-panel-header mb-2 flex items-center justify-between border border-[var(--chrome-border)] px-2.5 py-2",
);

const navItemClass = computed(() =>
  uiStore.sidebarCollapsed
    ? "flex items-center justify-center border py-2 text-xs font-semibold uppercase tracking-[0.13em] transition"
    : "flex items-center gap-2.5 border px-2.5 py-2 text-xs font-semibold uppercase tracking-[0.13em] transition",
);

const profileCardClass = computed(() =>
  uiStore.sidebarCollapsed
    ? "mt-2 border border-[var(--chrome-border)] bg-[#0d1118] p-1.5"
    : "mt-2 border border-[var(--chrome-border)] bg-[#0d1118] p-2",
);
</script>

<template>
  <aside
    :class="[
      'panel lumdara-scroll flex min-h-[220px] flex-col overflow-auto p-2 md:min-h-0',
      sidebarWidthClass,
    ]"
  >
    <div :class="sidebarHeaderClass">
      <p
        v-if="!uiStore.sidebarCollapsed"
        class="font-display text-sm font-semibold uppercase tracking-[0.18em] text-[var(--chrome-ink-dim)]"
      >
        navigator
      </p>

      <button
        type="button"
        class="chrome-btn !p-1.5"
        :aria-label="
          uiStore.sidebarCollapsed ? 'expand sidebar' : 'collapse sidebar'
        "
        @click="uiStore.toggleSidebar"
      >
        <ChevronLeft
          :size="14"
          :class="uiStore.sidebarCollapsed ? 'rotate-180' : ''"
        />
      </button>
    </div>

    <div v-if="!uiStore.sidebarCollapsed" class="mb-2">
      <input type="text" class="chrome-input" placeholder="FILTER OBJECTS..." />
    </div>

    <nav class="flex flex-1 flex-col gap-1">
      <RouterLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        :class="[
          navItemClass,
          route.path === link.to
            ? 'border-[var(--chrome-red)] bg-[var(--chrome-red-soft)] text-[var(--chrome-ink)]'
            : 'border-transparent text-[var(--chrome-ink-dim)] hover:border-[var(--chrome-border-strong)] hover:bg-[#151b24] hover:text-[var(--chrome-ink)]',
        ]"
      >
        <component :is="link.icon" :size="15" class="shrink-0" />
        <span v-if="!uiStore.sidebarCollapsed" class="truncate">{{
          link.label
        }}</span>
      </RouterLink>
    </nav>

    <div :class="profileCardClass">
      <div
        :class="[
          'text-xs uppercase tracking-[0.1em] text-[var(--chrome-ink-dim)]',
          uiStore.sidebarCollapsed ? 'flex items-center justify-center' : 'flex items-center gap-2',
        ]"
      >
        <Database :size="13" class="text-[var(--chrome-red)]" />
        <span v-if="!uiStore.sidebarCollapsed">active profile</span>
      </div>

      <p
        v-if="!uiStore.sidebarCollapsed"
        class="mt-1 truncate text-sm font-semibold text-[var(--chrome-ink)]"
      >
        {{ activeConnectionName }}
      </p>
    </div>
  </aside>
</template>
