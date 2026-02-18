<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Cable, SlidersHorizontal } from "lucide-vue-next";
import { useUiStore } from "../../stores/ui";

const route = useRoute();
const router = useRouter();
const uiStore = useUiStore();

const primaryLinks = [
  { to: "/connections", label: "Connections", icon: Cable },
];
const settingsLink = {
  to: "/settings",
  label: "Settings",
  icon: SlidersHorizontal,
};

const sidebarWidthClass = computed(() =>
  uiStore.sidebarCollapsed ? "md:w-auto" : "md:w-[260px]",
);

const navItemClass = computed(() =>
  uiStore.sidebarCollapsed
    ? "flex items-center justify-center border py-2.5 text-xs font-semibold uppercase tracking-[0.13em] transition"
    : "flex items-center gap-2.5 border px-2.5 py-2 text-xs font-semibold uppercase tracking-[0.13em] transition",
);

async function handleLinkNavigation(to: string): Promise<void> {
  if (route.path !== to) {
    await router.push(to);
  }
}
</script>

<template>
  <aside
    :class="[
      'panel qwerio-scroll flex w-full min-h-[180px] shrink-0 flex-col overflow-y-auto p-2 md:h-full md:min-h-0',
      sidebarWidthClass,
    ]"
  >
    <div
      :class="
        uiStore.sidebarCollapsed
          ? 'mb-2 flex items-center justify-center border-b border-[var(--chrome-border)] pb-2'
          : 'mb-2 flex items-center gap-2 border-b border-[var(--chrome-border)] pb-2'
      "
    >
      <button
        type="button"
        class="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-[var(--chrome-border-strong)] bg-[#101722] transition hover:border-[#525d74]"
        :aria-label="
          uiStore.sidebarCollapsed ? 'expand sidebar' : 'collapse sidebar'
        "
        @click="uiStore.toggleSidebar"
      >
        <img src="/logo.png" alt="Qwerio" class="size-8 object-cover" />
      </button>

      <div v-if="!uiStore.sidebarCollapsed" class="min-w-0 leading-none">
        <p
          class="font-display text-base font-semibold uppercase tracking-[0.08em] text-[var(--chrome-ink)]"
        >
          QWERIO
        </p>
      </div>
    </div>

    <nav class="flex flex-1 flex-col">
      <div class="flex flex-col gap-1">
        <button
          v-for="link in primaryLinks"
          :key="link.to"
          type="button"
          :class="[
            navItemClass,
            route.path.startsWith(link.to)
              ? 'border-[var(--chrome-red)] bg-[var(--chrome-red-soft)] text-[var(--chrome-ink)]'
              : 'border-transparent text-[var(--chrome-ink-dim)] hover:border-[var(--chrome-border-strong)] hover:bg-[#151b24] hover:text-[var(--chrome-ink)]',
          ]"
          @click="handleLinkNavigation(link.to)"
        >
          <component :is="link.icon" :size="15" class="shrink-0" />
          <span v-if="!uiStore.sidebarCollapsed" class="truncate">{{
            link.label
          }}</span>
        </button>
      </div>

      <div
        class="flex flex-col mt-auto border-t border-[var(--chrome-border)] pt-2"
      >
        <button
          type="button"
          :class="[
            navItemClass,
            route.path === settingsLink.to
              ? 'border-[var(--chrome-red)] bg-[var(--chrome-red-soft)] text-[var(--chrome-ink)]'
              : 'border-transparent text-[var(--chrome-ink-dim)] hover:border-[var(--chrome-border-strong)] hover:bg-[#151b24] hover:text-[var(--chrome-ink)]',
          ]"
          @click="handleLinkNavigation(settingsLink.to)"
        >
          <component :is="settingsLink.icon" :size="15" class="shrink-0" />
          <span v-if="!uiStore.sidebarCollapsed" class="truncate">
            {{ settingsLink.label }}
          </span>
        </button>
      </div>
    </nav>
  </aside>
</template>
