<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AgGridVue } from "ag-grid-vue3";
import { ChevronLeft, ChevronRight, ChevronsLeft } from "lucide-vue-next";
import type {
  CellEditingStartedEvent,
  CellEditingStoppedEvent,
  CellValueChangedEvent,
  ColDef,
  ICellRendererParams,
} from "ag-grid-community";
import type { QueryResult } from "../../core/types";

type GridPaginationState = {
  page: number;
  pageSize: number;
  canPrevious: boolean;
  canNext: boolean;
  totalRows: number | null;
  isLoading?: boolean;
};

type CellEditedPayload = {
  rowIndex: number;
  column: string;
  oldValue: unknown;
  newValue: unknown;
  rowData: Record<string, unknown>;
};

const props = defineProps<{
  result: QueryResult | null;
  message?: string;
  errorMessage: string;
  pagination?: GridPaginationState | null;
  editable?: boolean;
  nonEditableColumns?: string[];
}>();

const emit = defineEmits<{
  "change-page": [page: number];
  "cell-edited": [payload: CellEditedPayload];
}>();

const defaultColDef: ColDef = {
  sortable: false,
  filter: false,
};

const LONG_TEXT_VIEW_THRESHOLD = 120;
const VIEW_ICON_SVG = `
<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
  <circle cx="11" cy="11" r="7"></circle>
  <path d="m20 20-3.5-3.5"></path>
</svg>`;

const activeViewerColumn = ref("");
const activeViewerValue = ref<unknown>(null);
const isViewerOpen = ref(false);
const gridContainerElement = ref<HTMLElement | null>(null);
const editedCellOriginalValueByKey = ref<Record<string, unknown>>({});
const pendingRestoreScrollTop = ref<number | null>(null);
const nonEditableColumnSet = computed(
  () => new Set(props.nonEditableColumns ?? []),
);

function isComplexValue(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}

function isViewableValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return true;
  }

  if (value instanceof Date) {
    return false;
  }

  if (typeof value === "object" && value !== null) {
    return true;
  }

  return typeof value === "string" && value.length > LONG_TEXT_VIEW_THRESHOLD;
}

function toCellPreview(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toPreviewSnippet(value: unknown): string {
  const preview = toCellPreview(value);
  return preview.length > 88 ? `${preview.slice(0, 88)}...` : preview;
}

function openValueViewer(columnName: string, value: unknown): void {
  activeViewerColumn.value = columnName;
  activeViewerValue.value = value;
  isViewerOpen.value = true;
}

function closeValueViewer(): void {
  isViewerOpen.value = false;
}

function renderCell(params: ICellRendererParams): string | HTMLElement {
  const fieldName = params.colDef?.field ?? "";

  if (!isViewableValue(params.value)) {
    return toCellPreview(params.value);
  }

  const wrapper = document.createElement("div");
  wrapper.className = "flex h-full items-center gap-2 overflow-hidden";

  const snippet = document.createElement("span");
  snippet.className = "truncate text-[12px] text-[var(--chrome-ink-dim)]";
  snippet.textContent = toPreviewSnippet(params.value);

  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "inline-flex size-5 shrink-0 items-center justify-center rounded border border-[var(--chrome-border)] bg-[#161f2e] text-[var(--chrome-cyan)] transition hover:border-[var(--chrome-border-strong)]";
  button.innerHTML = VIEW_ICON_SVG;
  button.title = "View full value";
  button.setAttribute("aria-label", "View full value");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openValueViewer(fieldName, params.value);
  });

  wrapper.append(snippet, button);
  return wrapper;
}

function toEditedCellKey(rowIndex: number, column: string): string {
  return `${rowIndex}:${column}`;
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

function isEditedCell(
  rowIndex: number | null | undefined,
  column: string,
): boolean {
  if (typeof rowIndex !== "number") {
    return false;
  }

  const cellKey = toEditedCellKey(rowIndex, column);
  return cellKey in editedCellOriginalValueByKey.value;
}

function registerEditedCell(
  rowIndex: number,
  column: string,
  oldValue: unknown,
  newValue: unknown,
): void {
  const cellKey = toEditedCellKey(rowIndex, column);
  const existingOriginalValue = editedCellOriginalValueByKey.value[cellKey];
  const hasExistingOriginalValue =
    cellKey in editedCellOriginalValueByKey.value;

  if (!hasExistingOriginalValue) {
    if (areValuesEqual(oldValue, newValue)) {
      return;
    }

    editedCellOriginalValueByKey.value = {
      ...editedCellOriginalValueByKey.value,
      [cellKey]: oldValue,
    };
    return;
  }

  if (areValuesEqual(newValue, existingOriginalValue)) {
    const { [cellKey]: _, ...rest } = editedCellOriginalValueByKey.value;
    editedCellOriginalValueByKey.value = rest;
    return;
  }
}

function getGridBodyViewport(): HTMLElement | null {
  return (
    gridContainerElement.value?.querySelector<HTMLElement>(
      ".ag-body-viewport",
    ) ?? null
  );
}

function handleCellEditingStarted(_: CellEditingStartedEvent): void {
  const viewport = getGridBodyViewport();
  pendingRestoreScrollTop.value = viewport?.scrollTop ?? null;
}

function handleCellEditingStopped(_: CellEditingStoppedEvent): void {
  const restoreScrollTop = pendingRestoreScrollTop.value;
  pendingRestoreScrollTop.value = null;

  if (restoreScrollTop === null) {
    return;
  }

  window.requestAnimationFrame(() => {
    const viewport = getGridBodyViewport();

    if (viewport) {
      viewport.scrollTop = restoreScrollTop;
    }
  });
}

const columnDefs = computed<ColDef[]>(() =>
  (props.result?.columns ?? []).map((column) => ({
    field: column.name,
    headerName: column.name,
    sortable: false,
    filter: false,
    resizable: true,
    flex: 1,
    minWidth: 140,
    editable: (params) =>
      Boolean(props.editable) &&
      !nonEditableColumnSet.value.has(column.name) &&
      !isComplexValue(
        (params.data as Record<string, unknown> | undefined)?.[column.name],
      ),
    cellClass: (params) =>
      isEditedCell(params.rowIndex, column.name) ? "qwerio-cell-edited" : "",
    cellRenderer: renderCell,
  })),
);

const rowData = computed(() => props.result?.rows ?? []);
const pagination = computed(() => props.pagination ?? null);

const pageSummary = computed(() => {
  if (!pagination.value || !props.result) {
    return null;
  }

  const returnedRows = props.result.rows.length;
  const from =
    returnedRows > 0
      ? (pagination.value.page - 1) * pagination.value.pageSize + 1
      : 0;
  const to = returnedRows > 0 ? from + returnedRows - 1 : 0;

  return `${from}-${to}`;
});

const totalRows = computed(() => props.pagination?.totalRows ?? null);

const viewerContent = computed(() => {
  const value = activeViewerValue.value;

  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "null";
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
});

function handleCellValueChanged(event: CellValueChangedEvent): void {
  const column = event.colDef.field;
  const rowIndex = event.rowIndex;

  if (
    typeof column !== "string" ||
    typeof rowIndex !== "number" ||
    !event.data
  ) {
    return;
  }

  registerEditedCell(rowIndex, column, event.oldValue, event.newValue);
  event.api.refreshCells({
    rowNodes: [event.node],
    columns: [column],
    force: true,
  });

  if (Object.is(event.oldValue, event.newValue)) {
    return;
  }

  emit("cell-edited", {
    rowIndex,
    column,
    oldValue: event.oldValue,
    newValue: event.newValue,
    rowData: event.data as Record<string, unknown>,
  });
}

function goToFirstPage(): void {
  if (!pagination.value || pagination.value.page <= 1) {
    return;
  }

  emit("change-page", 1);
}

function goToPreviousPage(): void {
  if (!pagination.value || !pagination.value.canPrevious) {
    return;
  }

  emit("change-page", pagination.value.page - 1);
}

function goToNextPage(): void {
  if (!pagination.value || !pagination.value.canNext) {
    return;
  }

  emit("change-page", pagination.value.page + 1);
}

watch(
  () => props.result?.rows,
  () => {
    editedCellOriginalValueByKey.value = {};
    pendingRestoreScrollTop.value = null;
  },
  { immediate: true },
);
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
      ref="gridContainerElement"
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
        :single-click-edit="false"
        :stop-editing-when-cells-lose-focus="true"
        :suppress-scroll-on-new-data="true"
        theme="legacy"
        class="h-full w-full"
        @cell-editing-started="handleCellEditingStarted"
        @cell-editing-stopped="handleCellEditingStopped"
        @cell-value-changed="handleCellValueChanged"
      />
    </div>

    <div
      class="chrome-panel-header flex items-center gap-2 px-2 py-1"
      style="border-bottom: 0; border-top: 1px solid var(--chrome-border)"
    >
      <div class="flex min-w-0 items-center gap-2">
        <div
          v-if="pagination"
          class="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--chrome-ink-muted)]"
        >
          <button
            type="button"
            class="chrome-btn inline-flex size-5 items-center justify-center !p-0 text-[var(--chrome-ink-dim)] hover:text-[var(--chrome-ink)]"
            :disabled="pagination.isLoading || !pagination.canPrevious"
            aria-label="Go to first page"
            title="First page"
            @click="goToFirstPage"
          >
            <ChevronsLeft :size="12" />
          </button>
          <button
            type="button"
            class="chrome-btn inline-flex size-5 items-center justify-center !p-0 text-[var(--chrome-ink-dim)] hover:text-[var(--chrome-ink)]"
            :disabled="pagination.isLoading || !pagination.canPrevious"
            aria-label="Go to previous page"
            title="Previous page"
            @click="goToPreviousPage"
          >
            <ChevronLeft :size="12" />
          </button>
          <span class="mx-2.5 min-w-32 text-center"
            >Page {{ pagination.page }}
            <span
              v-if="pageSummary"
              class="text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--chrome-ink-muted)]"
            >
              ({{ pageSummary }})
            </span></span
          >
          <button
            type="button"
            class="chrome-btn inline-flex size-5 items-center justify-center !p-0 text-[var(--chrome-ink-dim)] hover:text-[var(--chrome-ink)]"
            :disabled="pagination.isLoading || !pagination.canNext"
            aria-label="Go to next page"
            title="Next page"
            @click="goToNextPage"
          >
            <ChevronRight :size="12" />
          </button>
        </div>

        <p
          class="truncate font-display text-sm font-semibold tracking-[0.04em] text-[var(--chrome-ink)]"
        >
          {{ message || "" }}
        </p>
      </div>

      <p
        v-if="result"
        class="ml-auto text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--chrome-ink-muted)]"
      >
        <span v-if="totalRows !== null">{{ `${totalRows} rows` }} / </span>
        {{ result.elapsedMs }} ms
      </p>
    </div>
  </section>

  <div
    v-if="isViewerOpen"
    class="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,10,15,0.72)] p-4"
    @click.self="closeValueViewer"
  >
    <div
      class="panel-tight flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden"
    >
      <div
        class="chrome-panel-header flex items-center justify-between px-3 py-2"
      >
        <p
          class="text-xs font-semibold uppercase tracking-[0.09em] text-[var(--chrome-ink-dim)]"
        >
          {{ activeViewerColumn || "Value" }}
        </p>
        <button
          type="button"
          class="chrome-btn px-2 py-0.5 text-[10px]"
          @click="closeValueViewer"
        >
          Close
        </button>
      </div>
      <pre
        class="qwerio-scroll m-0 overflow-auto bg-[#0d1118] p-3 text-[11px] leading-relaxed text-[var(--chrome-ink)]"
      ><code>{{ viewerContent }}</code></pre>
    </div>
  </div>
</template>

<style scoped>
:deep(.ag-cell.qwerio-cell-edited) {
  background: rgba(68, 199, 122, 0.16);
  box-shadow: inset 0 0 0 1px rgba(68, 199, 122, 0.34);
}
</style>
