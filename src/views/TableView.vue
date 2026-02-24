<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Check, Filter, RefreshCcw, RotateCcw } from "lucide-vue-next";
import { useRoute } from "vue-router";
import ResultsGrid from "../components/workbench/ResultsGrid.vue";
import { getQueryEngine } from "../core/query-engine-service";
import { clampPageSize, buildPaginatedSql } from "../core/sql-pagination";
import { SecretPinRequiredError } from "../core/secret-vault";
import type { ConnectionProfile, QueryResult } from "../core/types";
import { useAppSettingsStore } from "../stores/app-settings";
import { useConnectionsStore } from "../stores/connections";
import { useVaultStore } from "../stores/vault";
import { useWorkbenchStore } from "../stores/workbench";

type GridCellEditedPayload = {
  rowIndex: number;
  column: string;
  oldValue: unknown;
  newValue: unknown;
  rowData: Record<string, unknown>;
};

type PendingCellEdit = {
  key: string;
  rowKey: string;
  column: string;
  oldValue: unknown;
  newValue: unknown;
  primaryKeyValues: Record<string, unknown>;
};

const DEFAULT_PAGE_SIZE = 200;

const route = useRoute();
const appSettingsStore = useAppSettingsStore();
const connectionsStore = useConnectionsStore();
const vaultStore = useVaultStore();
const workbenchStore = useWorkbenchStore();

const isLoading = ref(false);
const isSavingChanges = ref(false);
const errorMessage = ref("");
const result = ref<QueryResult | null>(null);
const paginationPage = ref(1);
const hasNextPage = ref(false);
const totalRows = ref<number | null>(null);
const primaryKeyColumns = ref<string[]>([]);
const primaryKeyLookupKey = ref("");
const pendingEditsByKey = ref<Record<string, PendingCellEdit>>({});

const filters = reactive({
  whereClause: "",
  orderBy: "",
});

const resolvedPageSize = computed(() =>
  clampPageSize(appSettingsStore.resultsPageSize, DEFAULT_PAGE_SIZE),
);

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

const tableTitle = computed(() => {
  if (!tableTab.value) {
    return "Unknown object";
  }

  return tableTab.value.tableName;
});

const tableObjectType = computed(() => tableTab.value?.objectType ?? "table");
const isReadOnlyView = computed(() => tableObjectType.value === "view");
const objectLabel = computed(() => (isReadOnlyView.value ? "view" : "table"));
const hasPrimaryKey = computed(() => primaryKeyColumns.value.length > 0);
const canInlineEdit = computed(
  () => !isReadOnlyView.value && hasPrimaryKey.value,
);
const pendingEdits = computed(() => Object.values(pendingEditsByKey.value));
const pendingEditCount = computed(() => pendingEdits.value.length);
const hasPendingChanges = computed(() => pendingEditCount.value > 0);
const pendingChangesStatusLabel = computed(() =>
  hasPendingChanges.value
    ? `${pendingEditCount.value} pending change(s)`
    : "No changes",
);
const gridPagination = computed(() =>
  result.value
    ? {
        page: paginationPage.value,
        pageSize: resolvedPageSize.value,
        canPrevious: paginationPage.value > 1,
        canNext: hasNextPage.value,
        totalRows: totalRows.value,
        isLoading: isLoading.value || isSavingChanges.value,
      }
    : null,
);

function quoteIdentifier(
  dialect: ConnectionProfile["target"]["dialect"],
  identifier: string,
): string {
  if (dialect === "mysql") {
    return `\`${identifier.replace(/`/g, "``")}\``;
  }

  if (dialect === "sqlserver") {
    return `[${identifier.replace(/]/g, "]]")}]`;
  }

  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toSqlLiteral(
  dialect: ConnectionProfile["target"]["dialect"],
  value: unknown,
): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "boolean") {
    if (dialect === "sqlserver" || dialect === "mysql") {
      return value ? "1" : "0";
    }

    return value ? "true" : "false";
  }

  if (typeof value === "object") {
    return quoteString(JSON.stringify(value));
  }

  return quoteString(String(value));
}

function buildFromClause(profile: ConnectionProfile): string {
  if (!tableTab.value) {
    return "";
  }

  const schema = quoteIdentifier(
    profile.target.dialect,
    tableTab.value.schemaName,
  );
  const table = quoteIdentifier(
    profile.target.dialect,
    tableTab.value.tableName,
  );

  return `${schema}.${table}`;
}

function buildBaseSelectSql(profile: ConnectionProfile): string {
  const fromClause = buildFromClause(profile);
  let sql = `select * from ${fromClause}`;

  if (filters.whereClause.trim()) {
    sql += ` where ${filters.whereClause.trim()}`;
  }

  if (filters.orderBy.trim()) {
    sql += ` order by ${filters.orderBy.trim()}`;
  }

  return sql;
}

function buildCountSql(profile: ConnectionProfile): string {
  const fromClause = buildFromClause(profile);
  let sql = `select count(*) as total_count from ${fromClause}`;

  if (filters.whereClause.trim()) {
    sql += ` where ${filters.whereClause.trim()}`;
  }

  return sql;
}

function getPrimaryKeyMetadataSql(profile: ConnectionProfile): string {
  if (!tableTab.value) {
    return "";
  }

  const schemaName = tableTab.value.schemaName;
  const tableName = tableTab.value.tableName;

  if (profile.target.dialect === "postgres") {
    return `select kcu.column_name as name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
 and tc.table_name = kcu.table_name
where tc.constraint_type = 'PRIMARY KEY'
  and tc.table_schema = ${quoteString(schemaName)}
  and tc.table_name = ${quoteString(tableName)}
order by kcu.ordinal_position`;
  }

  if (profile.target.dialect === "mysql") {
    return `select kcu.column_name as name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
 and tc.table_name = kcu.table_name
where tc.constraint_type = 'PRIMARY KEY'
  and tc.table_schema = ${quoteString(schemaName)}
  and tc.table_name = ${quoteString(tableName)}
order by kcu.ordinal_position`;
  }

  if (profile.target.dialect === "sqlserver") {
    return `select c.name as name
from sys.key_constraints kc
join sys.index_columns ic
  on kc.parent_object_id = ic.object_id
 and kc.unique_index_id = ic.index_id
join sys.columns c
  on c.object_id = ic.object_id
 and c.column_id = ic.column_id
join sys.tables t
  on t.object_id = kc.parent_object_id
join sys.schemas s
  on s.schema_id = t.schema_id
where kc.type = 'PK'
  and s.name = ${quoteString(schemaName)}
  and t.name = ${quoteString(tableName)}
order by ic.key_ordinal`;
  }

  return `pragma ${quoteIdentifier(profile.target.dialect, schemaName)}.table_info(${quoteIdentifier(profile.target.dialect, tableName)})`;
}

function parsePrimaryKeyColumns(
  profile: ConnectionProfile,
  pkResult: QueryResult,
): string[] {
  if (profile.target.dialect === "sqlite") {
    return pkResult.rows
      .filter((row) => Number(row.pk ?? 0) > 0)
      .sort((left, right) => Number(left.pk ?? 0) - Number(right.pk ?? 0))
      .map((row) => String(row.name ?? "").trim())
      .filter((name) => name.length > 0);
  }

  return pkResult.rows
    .map((row) => String(row.name ?? row.column_name ?? "").trim())
    .filter((name) => name.length > 0);
}

async function loadPrimaryKeyColumns(
  profile: ConnectionProfile,
): Promise<void> {
  if (!tableTab.value) {
    primaryKeyColumns.value = [];
    primaryKeyLookupKey.value = "";
    return;
  }

  const lookupKey = `${profile.id}:${tableTab.value.schemaName}:${tableTab.value.tableName}`;

  if (lookupKey === primaryKeyLookupKey.value) {
    return;
  }

  const engine = getQueryEngine();
  const pkResult = await engine.execute({
    connectionId: profile.id,
    sql: getPrimaryKeyMetadataSql(profile),
  });

  primaryKeyColumns.value = parsePrimaryKeyColumns(profile, pkResult);
  primaryKeyLookupKey.value = lookupKey;
}

function extractTotalRows(countResult: QueryResult): number | null {
  const firstRow = countResult.rows[0];

  if (!firstRow) {
    return null;
  }

  const firstValue = Object.values(firstRow)[0];
  const total = Number(firstValue);

  return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : null;
}

function resetPendingEdits(): void {
  pendingEditsByKey.value = {};
}

function resetTableRuntimeState(): void {
  paginationPage.value = 1;
  hasNextPage.value = false;
  totalRows.value = null;
  primaryKeyColumns.value = [];
  primaryKeyLookupKey.value = "";
  resetPendingEdits();
}

async function loadTableRows(page = 1): Promise<void> {
  errorMessage.value = "";

  if (!tableTab.value) {
    result.value = null;

    if (!workbenchStore.hasHydrated) {
      return;
    }

    errorMessage.value =
      "Object tab not found. Reopen it from the schema tree.";
    return;
  }

  const profile = connectionProfile.value;

  if (!profile) {
    result.value = null;

    if (!connectionsStore.hasHydrated) {
      return;
    }

    errorMessage.value =
      "Connection profile was removed. Reopen this object from an active connection.";
    return;
  }

  isLoading.value = true;

  try {
    const engine = getQueryEngine();
    await engine.connect(profile);
    try {
      await loadPrimaryKeyColumns(profile);
    } catch {
      primaryKeyColumns.value = [];
      primaryKeyLookupKey.value = "";
    }

    const pageSize = resolvedPageSize.value;
    const paginatedSql = buildPaginatedSql({
      dialect: profile.target.dialect,
      sql: buildBaseSelectSql(profile),
      page,
      pageSize,
      fetchExtraRow: true,
    });
    const nextResult = await engine.execute({
      connectionId: profile.id,
      sql: paginatedSql,
    });
    const pageHasNext = nextResult.rows.length > pageSize;
    const rows = pageHasNext
      ? nextResult.rows.slice(0, pageSize)
      : nextResult.rows;

    result.value = {
      ...nextResult,
      rows,
      rowCount: rows.length,
    };
    paginationPage.value = page;
    hasNextPage.value = pageHasNext;

    try {
      const countResult = await engine.execute({
        connectionId: profile.id,
        sql: buildCountSql(profile),
      });
      totalRows.value = extractTotalRows(countResult);
    } catch {
      totalRows.value = null;
    }
  } catch (error) {
    if (error instanceof SecretPinRequiredError) {
      vaultStore.requestUnlockPrompt(error.envelope);
    }

    errorMessage.value =
      error instanceof Error
        ? error.message
        : "Unable to load rows for this object.";
  } finally {
    isLoading.value = false;
  }
}

function applyFilters(): void {
  if (isReadOnlyView.value) {
    return;
  }

  void loadTableRows(1);
}

function resetFilters(): void {
  if (isReadOnlyView.value) {
    return;
  }

  filters.whereClause = "";
  filters.orderBy = "";
  void loadTableRows(1);
}

function areValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (
    typeof left === "object" &&
    left !== null &&
    typeof right === "object" &&
    right !== null
  ) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  return false;
}

function toRowKey(primaryKeyValues: Record<string, unknown>): string {
  return primaryKeyColumns.value
    .map((column) => `${column}:${JSON.stringify(primaryKeyValues[column])}`)
    .join("|");
}

function getPrimaryKeySnapshot(rowData: Record<string, unknown>): {
  rowKey: string;
  primaryKeyValues: Record<string, unknown>;
} | null {
  if (!hasPrimaryKey.value) {
    return null;
  }

  const primaryKeyValues: Record<string, unknown> = {};

  for (const primaryKeyColumn of primaryKeyColumns.value) {
    if (!(primaryKeyColumn in rowData)) {
      return null;
    }

    primaryKeyValues[primaryKeyColumn] = rowData[primaryKeyColumn];
  }

  return {
    rowKey: toRowKey(primaryKeyValues),
    primaryKeyValues,
  };
}

function handleGridCellEdited(payload: GridCellEditedPayload): void {
  if (
    !canInlineEdit.value ||
    primaryKeyColumns.value.includes(payload.column)
  ) {
    return;
  }

  const rowSnapshot = getPrimaryKeySnapshot(payload.rowData);

  if (!rowSnapshot) {
    return;
  }

  const editKey = `${rowSnapshot.rowKey}:${payload.column}`;
  const existingEdit = pendingEditsByKey.value[editKey];

  if (existingEdit) {
    if (areValuesEqual(payload.newValue, existingEdit.oldValue)) {
      const { [editKey]: _, ...rest } = pendingEditsByKey.value;
      pendingEditsByKey.value = rest;
      return;
    }

    pendingEditsByKey.value = {
      ...pendingEditsByKey.value,
      [editKey]: {
        ...existingEdit,
        newValue: payload.newValue,
      },
    };
    return;
  }

  if (areValuesEqual(payload.oldValue, payload.newValue)) {
    return;
  }

  pendingEditsByKey.value = {
    ...pendingEditsByKey.value,
    [editKey]: {
      key: editKey,
      rowKey: rowSnapshot.rowKey,
      column: payload.column,
      oldValue: payload.oldValue,
      newValue: payload.newValue,
      primaryKeyValues: rowSnapshot.primaryKeyValues,
    },
  };
}

async function confirmPendingChanges(): Promise<void> {
  if (pendingEditCount.value === 0) {
    return;
  }

  const profile = connectionProfile.value;

  if (!profile || !tableTab.value || !canInlineEdit.value) {
    return;
  }

  isSavingChanges.value = true;
  errorMessage.value = "";

  try {
    const groupedByRow = new Map<
      string,
      {
        primaryKeyValues: Record<string, unknown>;
        updates: PendingCellEdit[];
      }
    >();

    pendingEdits.value.forEach((edit) => {
      const existing = groupedByRow.get(edit.rowKey);

      if (existing) {
        existing.updates = existing.updates
          .filter((item) => item.column !== edit.column)
          .concat(edit);
        return;
      }

      groupedByRow.set(edit.rowKey, {
        primaryKeyValues: edit.primaryKeyValues,
        updates: [edit],
      });
    });

    const engine = getQueryEngine();
    await engine.connect(profile);
    const fromClause = buildFromClause(profile);

    for (const rowUpdate of groupedByRow.values()) {
      const setSql = rowUpdate.updates
        .map(
          (update) =>
            `${quoteIdentifier(profile.target.dialect, update.column)} = ${toSqlLiteral(profile.target.dialect, update.newValue)}`,
        )
        .join(", ");
      const whereSql = primaryKeyColumns.value
        .map(
          (primaryKeyColumn) =>
            `${quoteIdentifier(profile.target.dialect, primaryKeyColumn)} = ${toSqlLiteral(profile.target.dialect, rowUpdate.primaryKeyValues[primaryKeyColumn])}`,
        )
        .join(" and ");

      await engine.execute({
        connectionId: profile.id,
        sql: `update ${fromClause} set ${setSql} where ${whereSql}`,
      });
    }

    resetPendingEdits();
    await loadTableRows(paginationPage.value);
  } catch (error) {
    if (error instanceof SecretPinRequiredError) {
      vaultStore.requestUnlockPrompt(error.envelope);
    }

    errorMessage.value =
      error instanceof Error
        ? error.message
        : "Unable to apply inline updates.";
  } finally {
    isSavingChanges.value = false;
  }
}

function rollbackPendingChanges(): void {
  resetPendingEdits();
  void loadTableRows(paginationPage.value);
}

function handlePaginationChange(page: number): void {
  void loadTableRows(page);
}

watch(
  () => tableTabId.value,
  () => {
    filters.whereClause = "";
    filters.orderBy = "";
    resetTableRuntimeState();
    void loadTableRows(1);
  },
  { immediate: true },
);

watch(
  () => appSettingsStore.resultsPageSize,
  () => {
    void loadTableRows(1);
  },
);

watch(
  () => workbenchStore.hasHydrated,
  (hydrated) => {
    if (hydrated && tableTabId.value) {
      void loadTableRows(1);
    }
  },
);

watch(
  () => connectionsStore.hasHydrated,
  (hydrated) => {
    if (hydrated && tableTabId.value) {
      void loadTableRows(1);
    }
  },
);

watch(
  () => vaultStore.needsUnlockPrompt,
  (needsUnlockPrompt, previousNeedsUnlockPrompt) => {
    if (previousNeedsUnlockPrompt && !needsUnlockPrompt) {
      void loadTableRows(paginationPage.value);
    }
  },
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col gap-2">
    <section class="panel-tight p-3">
      <div
        class="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--chrome-border)] pb-3"
      >
        <div>
          <h2
            class="font-display text-lg font-semibold tracking-[0.04em] text-[var(--chrome-ink)]"
          >
            {{ tableTitle }}
          </h2>
          <p
            class="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--chrome-ink-muted)]"
          >
            {{ objectLabel }}
            <span v-if="isReadOnlyView"> · read-only</span>
            <span> · {{ resolvedPageSize }} rows/page</span>
          </p>
        </div>

        <div class="inline-flex items-center gap-2">
          <span class="chrome-pill" v-if="isLoading || isSavingChanges">
            {{ isSavingChanges ? "Saving..." : "Loading..." }}
          </span>
          <button
            type="button"
            class="chrome-btn inline-flex items-center gap-1"
            @click="loadTableRows(paginationPage)"
          >
            <RefreshCcw :size="13" />
            Refresh
          </button>
        </div>
      </div>

      <div
        v-if="!isReadOnlyView"
        class="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
      >
        <label class="chrome-label">
          <span>Where</span>
          <input
            v-model="filters.whereClause"
            class="chrome-input chrome-input-sm mt-1"
            type="text"
            placeholder="id > 100"
          />
        </label>

        <label class="chrome-label">
          <span>Order</span>
          <input
            v-model="filters.orderBy"
            class="chrome-input chrome-input-sm mt-1"
            type="text"
            placeholder="created_at desc"
          />
        </label>

        <div class="flex items-center gap-2 md:pt-5">
          <button
            type="button"
            class="chrome-btn inline-flex items-center gap-1"
            @click="applyFilters"
          >
            <Filter :size="12" />
            Apply
          </button>

          <button
            type="button"
            class="chrome-btn inline-flex items-center gap-1"
            @click="resetFilters"
          >
            <RotateCcw :size="12" />
            Reset
          </button>
        </div>
      </div>

      <div
        v-if="!isReadOnlyView && !hasPrimaryKey"
        class="mt-3 border border-[var(--chrome-border)] bg-[#0d1118] px-2.5 py-2 text-xs text-[var(--chrome-ink-dim)]"
      >
        Inline editing is disabled. This table needs a primary key for atomic
        updates.
      </div>
    </section>

    <div class="min-h-0 flex-1 overflow-hidden">
      <ResultsGrid
        :result="result"
        :error-message="errorMessage"
        :pagination="gridPagination"
        :editable="canInlineEdit"
        :non-editable-columns="primaryKeyColumns"
        @change-page="handlePaginationChange"
        @cell-edited="handleGridCellEdited"
      >
        <template #footer-center>
          <div
            v-if="canInlineEdit"
            class="inline-flex items-center gap-2 px-2 py-1"
          >
            <p class="text-xs text-[var(--chrome-ink-dim)]">
              {{ pendingChangesStatusLabel }}
            </p>
            <div class="inline-flex items-center gap-2">
              <button
                type="button"
                class="chrome-btn inline-flex items-center gap-1 !py-0.5"
                :disabled="isSavingChanges || !hasPendingChanges"
                @click="rollbackPendingChanges"
              >
                <RotateCcw :size="12" />
                Rollback
              </button>
              <button
                type="button"
                class="chrome-btn chrome-btn-primary inline-flex items-center gap-1 !py-0.5"
                :disabled="isSavingChanges || !hasPendingChanges"
                @click="confirmPendingChanges"
              >
                <Check :size="12" />
                Confirm
              </button>
            </div>
          </div>
        </template>
      </ResultsGrid>
    </div>
  </div>
</template>
