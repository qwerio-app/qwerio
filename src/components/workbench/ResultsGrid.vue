<script setup lang="ts">
import { computed } from "vue";
import { AgGridVue } from "ag-grid-vue3";
import type { ColDef } from "ag-grid-community";
import type { QueryResult } from "../../core/types";

const props = defineProps<{
  result: QueryResult | null;
  message?: string;
  errorMessage: string;
}>();

const defaultColDef: ColDef = {
  sortable: false,
  filter: false,
};

const columnDefs = computed<ColDef[]>(() =>
  (props.result?.columns ?? []).map((column) => ({
    field: column.name,
    headerName: column.name,
    sortable: false,
    filter: false,
    resizable: true,
    flex: 1,
    minWidth: 140,
  })),
);

const rowData = computed(() => props.result?.rows ?? []);
</script>

<template>
  <section class="panel-tight flex h-full min-h-0 flex-col overflow-hidden">
    <p
      v-if="errorMessage"
      class="m-2 border border-[rgba(255,82,82,0.48)] bg-[var(--chrome-red-soft)] px-2.5 py-2 text-xs text-[#ff9a9a]"
    >
      {{ errorMessage }}
    </p>

    <div
      v-if="!result"
      class="m-2 chrome-empty flex min-h-0 flex-1 items-center justify-center px-4 text-xs"
    >
      Run a query to inspect result rows.
    </div>

    <div
      v-else
      class="qwerio-grid ag-theme-quartz-dark min-h-0 flex-1 overflow-hidden"
      style="
        --ag-font-size: 13px;
        --ag-header-font-size: 13px;
        --ag-header-height: 32px;
        --ag-row-height: 28px;
      "
    >
      <AgGridVue
        :row-data="rowData"
        :default-col-def="defaultColDef"
        :column-defs="columnDefs"
        theme="legacy"
        class="h-full w-full"
      />
    </div>

    <div
      class="chrome-panel-header flex items-center justify-between px-2 py-1"
      style="border-bottom: 0; border-top: 1px solid var(--chrome-border)"
    >
      <p
        class="font-display text-sm font-semibold tracking-[0.04em] text-[var(--chrome-ink)]"
      >
        {{ message || "" }}
      </p>
      <p
        class="text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--chrome-ink-muted)]"
        v-if="result"
      >
        {{ result.rowCount }} rows / {{ result.elapsedMs }} ms
      </p>
    </div>
  </section>
</template>
