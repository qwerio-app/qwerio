<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useVaultStore } from "../../stores/vault";
import { useRoute, useRouter } from "vue-router";
import {
  Braces,
  Cable,
  Check,
  ChevronRight,
  Database,
  FileCode,
  RefreshCcw,
  Settings,
  Table2,
  Trash2,
} from "lucide-vue-next";
import { useAppSettingsStore } from "../../stores/app-settings";
import { useConnectionsStore } from "../../stores/connections";
import { useSavedQueriesStore } from "../../stores/saved-queries";
import { useUiStore } from "../../stores/ui";
import { useWorkbenchStore } from "../../stores/workbench";

const route = useRoute();
const router = useRouter();
const appSettingsStore = useAppSettingsStore();
const uiStore = useUiStore();
const vaultStore = useVaultStore();
const connectionsStore = useConnectionsStore();
const workbenchStore = useWorkbenchStore();
const savedQueriesStore = useSavedQueriesStore();

const footerLinks = [
  { to: "/connections", label: "Connections", icon: Cable },
  { to: "/settings", label: "Settings", icon: Settings },
];
const expandedSchemas = ref<Record<string, boolean>>({});
const expandedSchemaGroups = ref<
  Record<string, Record<SidebarSchemaGroupKey, boolean>>
>({});
const isRefreshingSchema = ref(false);
const isConnectionOnline = ref(false);
const schemaLoadError = ref("");
const INTERNAL_SCHEMA_NAMES = new Set([
  "pg_catalog",
  "pg_toast",
  "information_schema",
  "sys",
]);

const activeConnection = computed(() => connectionsStore.activeProfile);
const savedConnectionsCount = computed(() => connectionsStore.profiles.length);
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
        : activeConnection.value.target.provider === "proxy"
          ? "Proxy"
          : "PlanetScale";

  return `${activeConnection.value.target.dialect.toUpperCase()} · ${source}`;
});
const showInternalSchemasForConnection = computed(() =>
  Boolean(activeConnection.value?.showInternalSchemas),
);

const schemaGroupMeta = [
  { key: "queries", label: "my queries", advanced: false },
  { key: "tables", label: "tables", advanced: false },
  { key: "views", label: "views", advanced: false },
  { key: "functions", label: "functions", advanced: true },
  { key: "procedures", label: "procedures", advanced: true },
  { key: "triggers", label: "triggers", advanced: true },
  { key: "indexes", label: "indexes", advanced: true },
  { key: "sequences", label: "sequences", advanced: true },
] as const;

type SidebarSchemaGroupKey = (typeof schemaGroupMeta)[number]["key"];

type SidebarSchemaObject = {
  name: string;
  totalCount: number;
  groups: Array<{
    key: SidebarSchemaGroupKey;
    label: string;
    items: Array<{ id?: string; name: string }>;
  }>;
};

const visibleSchemaGroupMeta = computed(() =>
  schemaGroupMeta.filter(
    (groupMeta) =>
      appSettingsStore.showAdvancedSchemaGroups || !groupMeta.advanced,
  ),
);

function isInternalSchemaName(schemaName: string): boolean {
  return INTERNAL_SCHEMA_NAMES.has(schemaName.trim().toLowerCase());
}

const visibleSchemas = computed(() => {
  if (showInternalSchemasForConnection.value) {
    return workbenchStore.schemaNames;
  }

  return workbenchStore.schemaNames.filter(
    (schema) => !isInternalSchemaName(schema.name),
  );
});

const hasOnlyHiddenInternalSchemas = computed(
  () =>
    !showInternalSchemasForConnection.value &&
    workbenchStore.schemaNames.length > 0 &&
    visibleSchemas.value.length === 0,
);

const schemaObjects = computed<SidebarSchemaObject[]>(() =>
  visibleSchemas.value.map((schema) => {
    const schemaObjectGroup = workbenchStore.schemaObjectMap[schema.name];
    const groups = visibleSchemaGroupMeta.value.map((groupMeta) => ({
      key: groupMeta.key,
      label: groupMeta.label,
      items:
        groupMeta.key === "queries"
          ? activeConnection.value
            ? savedQueriesStore
                .getQueriesForConnectionSchema(
                  activeConnection.value.id,
                  schema.name,
                )
                .map((savedQuery) => ({
                  id: savedQuery.id,
                  name: savedQuery.name,
                }))
            : []
          : (schemaObjectGroup?.[groupMeta.key] ??
            (groupMeta.key === "tables"
              ? (workbenchStore.tableMap[schema.name] ?? [])
              : [])),
    }));
    const totalCount = groups.reduce(
      (currentCount, group) => currentCount + group.items.length,
      0,
    );

    return {
      name: schema.name,
      totalCount,
      groups,
    };
  }),
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

function isSchemaGroupExpanded(
  schemaName: string,
  groupKey: SidebarSchemaGroupKey,
): boolean {
  return (
    expandedSchemaGroups.value[schemaName]?.[groupKey] ??
    (groupKey === "tables" || groupKey === "queries")
  );
}

function toggleSchemaGroup(
  schemaName: string,
  groupKey: SidebarSchemaGroupKey,
): void {
  const currentSchemaGroups = expandedSchemaGroups.value[schemaName] ?? {};
  expandedSchemaGroups.value = {
    ...expandedSchemaGroups.value,
    [schemaName]: {
      ...currentSchemaGroups,
      [groupKey]: !isSchemaGroupExpanded(schemaName, groupKey),
    },
  };
}

function isOpenableRelationGroup(groupKey: SidebarSchemaGroupKey): boolean {
  return groupKey === "tables" || groupKey === "views";
}

async function openSavedQuery(queryId: string): Promise<void> {
  const savedQuery =
    savedQueriesStore.queries.find((query) => query.id === queryId) ?? null;

  if (!savedQuery) {
    return;
  }

  const queryTab = workbenchStore.openSavedQueryTab({
    savedQueryId: savedQuery.id,
    title: savedQuery.name,
    sql: savedQuery.sql,
  });

  await router.push(`/query/${queryTab.id}`);
}

async function removeSavedQuery(queryId: string): Promise<void> {
  if (!queryId) {
    return;
  }

  await savedQueriesStore.removeQuery(queryId);
}

async function refreshSchema(): Promise<void> {
  if (isRefreshingSchema.value) {
    return;
  }

  if (!activeConnection.value) {
    schemaLoadError.value = "";
    isConnectionOnline.value = false;
    return;
  }

  isRefreshingSchema.value = true;
  schemaLoadError.value = "";

  try {
    await workbenchStore.refreshSchema();
    isConnectionOnline.value = true;
  } catch (error) {
    isConnectionOnline.value = false;
    schemaLoadError.value =
      error instanceof Error ? error.message : "Failed to load schema.";
  } finally {
    isRefreshingSchema.value = false;
  }
}

async function openRelation(
  schemaName: string,
  relationName: string,
  objectType: "table" | "view",
): Promise<void> {
  if (!activeConnection.value) {
    return;
  }

  const tableTab = workbenchStore.openTableTab({
    connectionId: activeConnection.value.id,
    schemaName,
    tableName: relationName,
    objectType,
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
    const nextExpandedGroups: Record<
      string,
      Record<SidebarSchemaGroupKey, boolean>
    > = {};

    schemaNames.forEach((schemaName) => {
      nextExpanded[schemaName] = expandedSchemas.value[schemaName] ?? false;

      const currentGroups = expandedSchemaGroups.value[schemaName] ?? {};
      const nextGroups: Record<SidebarSchemaGroupKey, boolean> = {
        queries: currentGroups.queries ?? true,
        tables: currentGroups.tables ?? true,
        views: currentGroups.views ?? false,
        functions: currentGroups.functions ?? false,
        procedures: currentGroups.procedures ?? false,
        triggers: currentGroups.triggers ?? false,
        indexes: currentGroups.indexes ?? false,
        sequences: currentGroups.sequences ?? false,
      };

      nextExpandedGroups[schemaName] = nextGroups;
    });

    expandedSchemas.value = nextExpanded;
    expandedSchemaGroups.value = nextExpandedGroups;
  },
  { immediate: true },
);

watch(
  () => connectionsStore.activeConnectionId,
  async (connectionId, previousConnectionId) => {
    if (connectionId !== previousConnectionId) {
      expandedSchemas.value = {};
      expandedSchemaGroups.value = {};
      isConnectionOnline.value = false;
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
          class="font-display text-base font-semibold uppercase tracking-widest text-[var(--chrome-ink)]"
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

          <span
            v-if="activeConnection && isConnectionOnline"
            class="inline-flex size-6 shrink-0 items-center justify-center"
            aria-label="Connection online"
            title="Connection online"
          >
            <Check :size="14" class="text-[var(--chrome-green)]" />
          </span>

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
          class="qwerio-scroll min-h-0 flex-1 overflow-auto"
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
            {{
              hasOnlyHiddenInternalSchemas
                ? "Only internal schemas are available. Enable 'Show internal schemas' in this connection settings to display them."
                : "No schemas found for this connection."
            }}
          </p>

          <div v-else class="flex flex-col gap-1">
            <section
              v-for="schema in schemaObjects"
              :key="schema.name"
              :class="isSchemaExpanded(schema.name) ? 'bg-[#111723]' : ''"
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
                  {{ schema.totalCount }}
                </span>
              </button>

              <ul
                v-if="isSchemaExpanded(schema.name)"
                class="m-0 list-none border-b border-[var(--chrome-border)] px-1.5 py-1"
              >
                <li
                  v-for="group in schema.groups"
                  :key="`${schema.name}-${group.key}`"
                  class="mb-0.5 last:mb-0"
                >
                  <button
                    type="button"
                    class="flex w-full min-w-0 items-center gap-1 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--chrome-ink-muted)] transition hover:bg-[#131a27] hover:text-[var(--chrome-ink-dim)]"
                    @click="toggleSchemaGroup(schema.name, group.key)"
                  >
                    <ChevronRight
                      :size="12"
                      :class="
                        isSchemaGroupExpanded(schema.name, group.key)
                          ? 'shrink-0 rotate-90 text-[var(--chrome-ink-dim)]'
                          : 'shrink-0 text-[var(--chrome-ink-muted)]'
                      "
                    />
                    <span>{{ group.label }}</span>
                    <span class="ml-auto">{{ group.items.length }}</span>
                  </button>

                  <ul
                    v-if="isSchemaGroupExpanded(schema.name, group.key)"
                    class="m-0 list-none pb-1"
                  >
                    <li v-if="group.items.length === 0">
                      <div
                        class="flex items-center gap-1.5 pl-4 pr-1.5 py-1 text-[11px] text-[var(--chrome-ink-muted)]"
                      >
                        <Table2
                          :size="11"
                          class="text-[var(--chrome-yellow)]"
                        />
                        <span>No {{ group.key }}</span>
                      </div>
                    </li>

                    <li
                      v-for="(item, itemIndex) in group.items"
                      :key="`${group.key}-${item.name}-${itemIndex}`"
                      class="mb-0.5 last:mb-0"
                    >
                      <div
                        v-if="group.key === 'queries'"
                        class="flex items-center gap-1"
                      >
                        <button
                          type="button"
                          class="flex min-w-0 flex-1 items-center gap-1.5 border border-transparent pl-4 pr-1.5 py-1 text-left text-[11px] text-[var(--chrome-ink-dim)] transition hover:border-[var(--chrome-border)] hover:bg-[#151c29] hover:text-[var(--chrome-ink)]"
                          @click="openSavedQuery(item.id ?? '')"
                        >
                          <FileCode
                            :size="11"
                            class="shrink-0 text-[var(--chrome-cyan)]"
                          />
                          <span class="truncate">{{ item.name }}</span>
                        </button>

                        <button
                          type="button"
                          class="inline-flex size-5 shrink-0 items-center justify-center border border-transparent text-[var(--chrome-ink-muted)] transition hover:border-[var(--chrome-border)] hover:bg-[#151c29] hover:text-[var(--chrome-red)]"
                          aria-label="Delete saved query"
                          @click="removeSavedQuery(item.id ?? '')"
                        >
                          <Trash2 :size="11" />
                        </button>
                      </div>

                      <button
                        v-else-if="isOpenableRelationGroup(group.key)"
                        type="button"
                        class="flex w-full items-center gap-1.5 border border-transparent pl-4 pr-1.5 py-1 text-left text-[11px] text-[var(--chrome-ink-dim)] transition hover:border-[var(--chrome-border)] hover:bg-[#151c29] hover:text-[var(--chrome-ink)]"
                        @click="
                          openRelation(
                            schema.name,
                            item.name,
                            group.key === 'views' ? 'view' : 'table',
                          )
                        "
                      >
                        <Table2
                          :size="11"
                          :class="
                            group.key === 'views'
                              ? 'shrink-0 text-[var(--chrome-cyan)]'
                              : 'shrink-0 text-[var(--chrome-yellow)]'
                          "
                        />
                        <span class="truncate">{{ item.name }}</span>
                      </button>

                      <div
                        v-else
                        class="flex w-full items-center gap-1.5 border border-transparent px-1.5 py-1 text-left text-[11px] text-[var(--chrome-ink-muted)]"
                      >
                        <Table2
                          :size="11"
                          class="shrink-0 text-[var(--chrome-ink-muted)]"
                        />
                        <span class="truncate">{{ item.name }}</span>
                      </div>
                    </li>
                  </ul>
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
          <component :is="link.icon" :size="20" class="shrink-0 py-0.5" />
          <span v-if="!uiStore.sidebarCollapsed" class="truncate">
            {{ link.label }}
          </span>
          <span
            v-if="!uiStore.sidebarCollapsed && link.to === '/connections'"
            class="ml-auto inline-flex min-w-5 items-center justify-center border border-[var(--chrome-border-strong)] bg-[#141a24] px-1 py-0.5 text-[10px] font-semibold tracking-[0.05em] text-[var(--chrome-ink-dim)]"
          >
            {{ savedConnectionsCount }}
          </span>
        </button>
      </div>
    </nav>
  </aside>
</template>
