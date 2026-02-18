<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Filter, RefreshCcw, RotateCcw } from "lucide-vue-next";
import { useRoute } from "vue-router";
import ResultsGrid from "../components/workbench/ResultsGrid.vue";
import { getQueryEngine } from "../core/query-engine-service";
import type { ConnectionProfile, QueryResult } from "../core/types";
import { useConnectionsStore } from "../stores/connections";
import { useWorkbenchStore } from "../stores/workbench";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

const route = useRoute();
const connectionsStore = useConnectionsStore();
const workbenchStore = useWorkbenchStore();

const isLoading = ref(false);
const errorMessage = ref("");
const result = ref<QueryResult | null>(null);

const filters = reactive({
  limit: DEFAULT_LIMIT,
  whereClause: "",
  orderBy: "",
});

const tableTabId = computed(() =>
  typeof route.params.tableTabId === "string" ? route.params.tableTabId : "",
);

const tableTab = computed(() => {
  if (!tableTabId.value) {
    return null;
  }

  return workbenchStore.getTableTab(tableTabId.value);
});

const connectionProfile = computed<ConnectionProfile | null>(() => {
  if (!tableTab.value) {
    return null;
  }

  return (
    connectionsStore.profiles.find(
      (profile) => profile.id === tableTab.value?.connectionId,
    ) ?? null
  );
});

const tableLabel = computed(() => {
  if (!tableTab.value) {
    return "Unknown table";
  }

  return `${tableTab.value.schemaName}.${tableTab.value.tableName}`;
});

const connectionLabel = computed(() => {
  if (!connectionProfile.value) {
    return "Connection unavailable";
  }

  return connectionProfile.value.name;
});

function quoteIdentifier(dialect: ConnectionProfile["target"]["dialect"], identifier: string): string {
  if (dialect === "mysql") {
    return `\`${identifier.replace(/`/g, "``")}\``;
  }

  return `"${identifier.replace(/"/g, '""')}"`;
}

function buildSql(profile: ConnectionProfile): string {
  if (!tableTab.value) {
    return "";
  }

  const schema = quoteIdentifier(profile.target.dialect, tableTab.value.schemaName);
  const table = quoteIdentifier(profile.target.dialect, tableTab.value.tableName);
  const parsedLimit = Number(filters.limit);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.floor(parsedLimit), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  let sql = `select * from ${schema}.${table}`;

  if (filters.whereClause.trim()) {
    sql += ` where ${filters.whereClause.trim()}`;
  }

  if (filters.orderBy.trim()) {
    sql += ` order by ${filters.orderBy.trim()}`;
  }

  sql += ` limit ${safeLimit}`;
  return sql;
}

async function loadTableRows(): Promise<void> {
  errorMessage.value = "";

  if (!tableTab.value) {
    result.value = null;
    errorMessage.value = "Table tab not found. Reopen the table from the schema tree.";
    return;
  }

  const profile = connectionProfile.value;

  if (!profile) {
    result.value = null;
    errorMessage.value = "Connection profile was removed. Reopen the table from an active connection.";
    return;
  }

  isLoading.value = true;

  try {
    const engine = getQueryEngine();
    await engine.connect(profile);

    result.value = await engine.execute({
      connectionId: profile.id,
      sql: buildSql(profile),
    });
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load rows for this table.";
  } finally {
    isLoading.value = false;
  }
}

function applyFilters(): void {
  void loadTableRows();
}

function resetFilters(): void {
  filters.limit = DEFAULT_LIMIT;
  filters.whereClause = "";
  filters.orderBy = "";
  void loadTableRows();
}

watch(
  () => tableTabId.value,
  () => {
    filters.limit = DEFAULT_LIMIT;
    filters.whereClause = "";
    filters.orderBy = "";
    void loadTableRows();
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex min-h-full flex-1 flex-col gap-2">
    <section class="panel-tight p-3">
      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--chrome-border)] pb-3">
        <div>
          <h2 class="font-display text-lg font-semibold tracking-[0.04em] text-[var(--chrome-ink)]">Table View</h2>
          <p class="text-xs text-[var(--chrome-ink-dim)]">{{ connectionLabel }} / {{ tableLabel }}</p>
        </div>

        <div class="inline-flex items-center gap-2">
          <span class="chrome-pill" v-if="isLoading">Loading...</span>
          <button type="button" class="chrome-btn inline-flex items-center gap-1" @click="loadTableRows">
            <RefreshCcw :size="13" />
            Refresh
          </button>
        </div>
      </div>

      <div class="mt-3 grid gap-2 md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
        <label class="chrome-label">
          <span>Limit</span>
          <input v-model.number="filters.limit" class="chrome-input mt-1" type="number" min="1" :max="MAX_LIMIT" />
        </label>

        <label class="chrome-label">
          <span>Where</span>
          <input
            v-model="filters.whereClause"
            class="chrome-input mt-1"
            type="text"
            placeholder="id > 100"
          />
        </label>

        <label class="chrome-label">
          <span>Order</span>
          <input
            v-model="filters.orderBy"
            class="chrome-input mt-1"
            type="text"
            placeholder="created_at desc"
          />
        </label>

        <button type="button" class="chrome-btn mt-auto inline-flex items-center gap-1" @click="applyFilters">
          <Filter :size="12" />
          Apply
        </button>

        <button type="button" class="chrome-btn mt-auto inline-flex items-center gap-1" @click="resetFilters">
          <RotateCcw :size="12" />
          Reset
        </button>
      </div>
    </section>

    <div class="min-h-0 flex-1 overflow-hidden">
      <ResultsGrid :result="result" :error-message="errorMessage" />
    </div>
  </div>
</template>
