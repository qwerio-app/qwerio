<script setup lang="ts">
import { computed } from "vue";
import { AgGridVue } from "ag-grid-vue3";
import type { ColDef } from "ag-grid-community";
import type { QueryResult } from "../../core/types";

const props = defineProps<{
  result: QueryResult | null;
  errorMessage: string;
}>();

const columnDefs = computed<ColDef[]>(() =>
  (props.result?.columns ?? []).map((column) => ({
    field: column.name,
    headerName: column.name,
    sortable: true,
    filter: true,
    resizable: true,
    flex: 1,
    minWidth: 140,
  })),
);

const rowData = computed(() => props.result?.rows ?? []);
</script>

<template>
  <section class="panel-tight flex h-full min-h-0 flex-col overflow-hidden">
    <div class="chrome-panel-header flex items-center justify-between px-2.5 py-2">
      <p class="font-display text-base font-semibold tracking-[0.05em] text-[var(--chrome-ink)]">Result Set</p>
      <p class="text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--chrome-ink-muted)]" v-if="result">
        {{ result.rowCount }} rows / {{ result.elapsedMs }} ms
      </p>
    </div>

    <p
      v-if="errorMessage"
      class="m-2 border border-[rgba(255,82,82,0.48)] bg-[var(--chrome-red-soft)] px-2.5 py-2 text-xs text-[#ff9a9a]"
    >
      {{ errorMessage }}
    </p>

    <div v-if="!result" class="m-2 chrome-empty flex min-h-0 flex-1 items-center justify-center px-4 text-xs">
      Run a query to inspect result rows.
    </div>

    <div v-else class="qwerio-grid ag-theme-quartz-dark min-h-0 flex-1 overflow-hidden border-t border-[var(--chrome-border)]">
      <AgGridVue :row-data="rowData" :column-defs="columnDefs" class="h-full w-full" />
    </div>
  </section>
</template>
