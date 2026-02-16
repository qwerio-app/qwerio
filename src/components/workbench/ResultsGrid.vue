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
  <section class="flex h-full min-h-0 flex-col gap-3">
    <div class="panel-tight flex items-center justify-between px-3 py-2">
      <p class="font-display text-sm font-semibold tracking-tight text-slate-900">Results</p>
      <p class="text-xs text-slate-500" v-if="result">{{ result.rowCount }} rows in {{ result.elapsedMs }} ms</p>
    </div>

    <p v-if="errorMessage" class="panel-tight rounded-xl border border-red-300/80 bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ errorMessage }}
    </p>

    <div v-if="!result" class="panel-tight flex min-h-0 flex-1 items-center justify-center px-4 text-sm text-slate-500">
      Run a query to inspect result rows.
    </div>

    <div v-else class="panel-tight lumdara-grid ag-theme-quartz min-h-0 flex-1 overflow-hidden">
      <AgGridVue :row-data="rowData" :column-defs="columnDefs" class="h-full w-full" />
    </div>
  </section>
</template>
