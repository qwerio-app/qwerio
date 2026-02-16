<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { Cable, Database, PanelsTopLeft, Settings } from "lucide-vue-next";
import { useUiStore } from "../../stores/ui";

const route = useRoute();
const uiStore = useUiStore();

const links = [
  { to: "/workbench", label: "Workbench", icon: PanelsTopLeft },
  { to: "/connections", label: "Connections", icon: Cable },
  { to: "/settings", label: "Settings", icon: Settings },
];

const sidebarWidthClass = computed(() =>
  uiStore.sidebarCollapsed ? "w-[84px]" : "w-[252px]",
);
</script>

<template>
  <aside :class="['panel hidden flex-col p-3 md:flex', sidebarWidthClass]">
    <button
      type="button"
      class="mb-4 flex items-center gap-2 rounded-xl border border-black/10 bg-white/85 px-2 py-2 text-left transition hover:bg-white"
      @click="uiStore.toggleSidebar"
    >
      <div
        class="shrink-0 flex size-9 items-center justify-center rounded-lg border border-black/10 bg-gradient-to-br from-emerald-100 to-orange-100 text-emerald-700"
      >
        <Database :size="18" />
      </div>
      <span
        v-if="!uiStore.sidebarCollapsed"
        class="font-display text-base font-semibold tracking-tight"
        >Lumdara</span
      >
    </button>

    <nav class="flex flex-1 flex-col gap-1">
      <RouterLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        :class="[
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
          route.path === link.to
            ? 'bg-teal-700 text-white shadow-soft'
            : 'text-slate-700 hover:bg-slate-900/5 hover:text-slate-900',
        ]"
      >
        <component :is="link.icon" :size="17" class="shrink-0" />
        <span v-if="!uiStore.sidebarCollapsed">{{ link.label }}</span>
      </RouterLink>
    </nav>

    <div
      class="panel-tight mt-3 px-3 py-2 text-xs text-slate-600"
      v-if="!uiStore.sidebarCollapsed"
    >
      Browser mode supports cloud providers with HTTP SQL endpoints.
    </div>
  </aside>
</template>
