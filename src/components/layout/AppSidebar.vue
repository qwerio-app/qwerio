<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useVaultStore } from "../../stores/vault";
import { useRoute, useRouter } from "vue-router";
import {
  Braces,
  Cable,
  ChevronRight,
  Database,
  RefreshCcw,
  SlidersHorizontal,
  Table2,
} from "lucide-vue-next";
import { useConnectionsStore } from "../../stores/connections";
import { useUiStore } from "../../stores/ui";
import { useWorkbenchStore } from "../../stores/workbench";

const route = useRoute();
const router = useRouter();
const uiStore = useUiStore();
const vaultStore = useVaultStore();
const connectionsStore = useConnectionsStore();
const workbenchStore = useWorkbenchStore();

const footerLinks = [
  { to: "/connections", label: "Connections", icon: Cable },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal },
];
const expandedSchemas = ref<Record<string, boolean>>({});
const isRefreshingSchema = ref(false);
const schemaLoadError = ref("");

const activeConnection = computed(() => connectionsStore.activeProfile);
const activeConnectionName = computed(
  () => activeConnection.value?.name ?? "No active connection",
);
const activeConnectionDescription = computed(() => {
  if (!activeConnection.value) {
    return "Select a connection to browse database objects.";
  }

  const source =
    activeConnection.value.target.kind === "desktop-tcp"
      ? "Desktop"
      : activeConnection.value.target.provider === "neon"
        ? "Neon"
        : "PlanetScale";

  return `${activeConnection.value.target.dialect.toUpperCase()} · ${source}`;
});

const schemaObjects = computed(() =>
  workbenchStore.schemaNames.map((schema) => ({
    name: schema.name,
    tables: workbenchStore.tableMap[schema.name] ?? [],
  })),
);

const sidebarWidthClass = computed(() =>
  uiStore.sidebarCollapsed ? "md:w-auto" : "md:w-[260px]",
);

const navItemClass = computed(() =>
  uiStore.sidebarCollapsed
    ? "flex items-center justify-center border py-2.5 text-xs font-semibold uppercase tracking-[0.13em] transition"
    : "flex items-center gap-2.5 border px-2.5 py-2 text-xs font-semibold uppercase tracking-[0.13em] transition",
);

function isLinkActive(to: string): boolean {
  if (to === "/settings") {
    return route.path === to;
  }

  return route.path.startsWith(to);
}

function isSchemaExpanded(schemaName: string): boolean {
  return expandedSchemas.value[schemaName] ?? false;
}

function toggleSchema(schemaName: string): void {
  expandedSchemas.value = {
    ...expandedSchemas.value,
    [schemaName]: !isSchemaExpanded(schemaName),
  };
}

async function refreshSchema(): Promise<void> {
  if (isRefreshingSchema.value) {
    return;
  }

  isRefreshingSchema.value = true;
  schemaLoadError.value = "";

  try {
    await workbenchStore.refreshSchema();
  } catch (error) {
    schemaLoadError.value =
      error instanceof Error ? error.message : "Failed to load schema.";
  } finally {
    isRefreshingSchema.value = false;
  }
}

async function openTable(schemaName: string, tableName: string): Promise<void> {
  if (!activeConnection.value) {
    return;
  }

  const tableTab = workbenchStore.openTableTab({
    connectionId: activeConnection.value.id,
    schemaName,
    tableName,
  });

  await router.push(`/tables/${tableTab.id}`);
}

async function handleLinkNavigation(to: string): Promise<void> {
  if (route.path !== to) {
    await router.push(to);
  }
}

watch(
  () => workbenchStore.schemaNames.map((schema) => schema.name),
  (schemaNames) => {
    const nextExpanded: Record<string, boolean> = {};

    schemaNames.forEach((schemaName) => {
      nextExpanded[schemaName] = expandedSchemas.value[schemaName] ?? false;
    });

    expandedSchemas.value = nextExpanded;
  },
  { immediate: true },
);

watch(
  () => connectionsStore.activeConnectionId,
  async (connectionId, previousConnectionId) => {
    if (connectionId !== previousConnectionId) {
      expandedSchemas.value = {};
    }

    await refreshSchema();
  },
  { immediate: true },
);

watch(
  () => vaultStore.needsUnlockPrompt,
  async (needsUnlockPrompt, previousNeedsUnlockPrompt) => {
    if (previousNeedsUnlockPrompt && !needsUnlockPrompt) {
      await refreshSchema();
    }
  },
);
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
        class="inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-[var(--chrome-border-strong)] bg-[#101722] transition hover:border-[#525d74]"
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

    <nav class="flex min-h-0 flex-1 flex-col gap-2">
      <section
        :class="
          uiStore.sidebarCollapsed
            ? 'flex flex-col items-center gap-2 border border-[var(--chrome-border)] bg-[#0f141c] px-1.5 py-2'
            : 'flex min-h-0 flex-1 flex-col border border-[var(--chrome-border)] bg-[#0f141c]'
        "
      >
        <div
          :class="
            uiStore.sidebarCollapsed
              ? 'flex flex-col items-center gap-2'
              : 'flex items-center justify-between gap-2 border-b border-[var(--chrome-border)] px-2 py-2'
          "
        >
          <div
            :class="
              uiStore.sidebarCollapsed
                ? 'flex size-7 items-center justify-center border border-[var(--chrome-border)] bg-[#141a24]'
                : 'min-w-0'
            "
          >
            <Database
              :size="uiStore.sidebarCollapsed ? 13 : 16"
              class="text-[var(--chrome-cyan)]"
            />
          </div>

          <div v-if="!uiStore.sidebarCollapsed" class="min-w-0 flex-1">
            <p
              class="truncate text-xs font-semibold tracking-[0.04em] text-[var(--chrome-ink)]"
            >
              {{ activeConnectionName }}
            </p>
            <p class="truncate text-[10px] text-[var(--chrome-ink-dim)]">
              {{ activeConnectionDescription }}
            </p>
          </div>

          <button
            type="button"
            class="inline-flex size-7 shrink-0 items-center justify-center border border-transparent text-[var(--chrome-ink-dim)] transition hover:border-[var(--chrome-border-strong)] hover:bg-[#141a24] hover:text-[var(--chrome-ink)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="refresh schema"
            :disabled="!activeConnection || isRefreshingSchema"
            @click="refreshSchema"
          >
            <RefreshCcw
              :size="12"
              :class="isRefreshingSchema ? 'animate-spin' : ''"
            />
          </button>
        </div>

        <div
          v-if="!uiStore.sidebarCollapsed"
          class="qwerio-scroll min-h-0 flex-1 overflow-auto p-1.5"
        >
          <p
            v-if="schemaLoadError"
            class="border border-[var(--chrome-red)] bg-[var(--chrome-red-soft)] px-2 py-1.5 text-[11px] text-[var(--chrome-ink)]"
          >
            {{ schemaLoadError }}
          </p>

          <p
            v-else-if="!activeConnection"
            class="chrome-empty p-2 text-[11px] leading-relaxed"
          >
            Select a connection to inspect schemas.
          </p>

          <p
            v-else-if="schemaObjects.length === 0"
            class="chrome-empty p-2 text-[11px]"
          >
            No top-level objects found.
          </p>

          <div v-else class="flex flex-col gap-1">
            <section
              v-for="schema in schemaObjects"
              :key="schema.name"
              class="border border-[var(--chrome-border)] bg-[#111723]"
            >
              <button
                type="button"
                class="flex w-full items-center gap-1.5 px-1.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--chrome-ink-dim)] transition hover:bg-[#151c29] hover:text-[var(--chrome-ink)]"
                @click="toggleSchema(schema.name)"
              >
                <ChevronRight
                  :size="12"
                  :class="
                    isSchemaExpanded(schema.name)
                      ? 'shrink-0 rotate-90 text-[var(--chrome-ink)]'
                      : 'shrink-0 text-[var(--chrome-ink-dim)]'
                  "
                />
                <Braces :size="12" class="shrink-0 text-[var(--chrome-red)]" />
                <span class="truncate">{{ schema.name }}</span>
                <span
                  class="ml-auto text-[10px] text-[var(--chrome-ink-muted)]"
                >
                  {{ schema.tables.length }}
                </span>
              </button>

              <ul
                v-if="isSchemaExpanded(schema.name)"
                class="m-0 list-none border-t border-[var(--chrome-border)] p-1"
              >
                <li v-if="schema.tables.length === 0">
                  <div
                    class="flex items-center gap-1.5 px-1.5 py-1 text-[11px] text-[var(--chrome-ink-muted)]"
                  >
                    <Table2 :size="11" class="text-[var(--chrome-yellow)]" />
                    <span>No tables</span>
                  </div>
                </li>

                <li
                  v-for="table in schema.tables"
                  :key="table.name"
                  class="mb-0.5 last:mb-0"
                >
                  <button
                    type="button"
                    class="flex w-full items-center gap-1.5 border border-transparent px-1.5 py-1 text-left text-[11px] text-[var(--chrome-ink-dim)] transition hover:border-[var(--chrome-border)] hover:bg-[#151c29] hover:text-[var(--chrome-ink)]"
                    @click="openTable(schema.name, table.name)"
                  >
                    <Table2
                      :size="11"
                      class="shrink-0 text-[var(--chrome-yellow)]"
                    />
                    <span class="truncate">{{ table.name }}</span>
                  </button>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </section>

      <div
        class="mt-auto flex flex-col gap-1 border-t border-[var(--chrome-border)] pt-2"
      >
        <button
          v-for="link in footerLinks"
          :key="link.to"
          type="button"
          :class="[
            navItemClass,
            isLinkActive(link.to)
              ? 'border-[var(--chrome-red)] bg-[var(--chrome-red-soft)] text-[var(--chrome-ink)]'
              : 'border-transparent text-[var(--chrome-ink-dim)] hover:border-[var(--chrome-border-strong)] hover:bg-[#151b24] hover:text-[var(--chrome-ink)]',
          ]"
          @click="handleLinkNavigation(link.to)"
        >
          <component :is="link.icon" :size="15" class="shrink-0" />
          <span v-if="!uiStore.sidebarCollapsed" class="truncate">
            {{ link.label }}
          </span>
        </button>
      </div>
    </nav>
  </aside>
</template>
