<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { X } from "lucide-vue-next";
import { Pane, Splitpanes } from "splitpanes";
import { useRoute, useRouter } from "vue-router";
import ResultsGrid from "../components/workbench/ResultsGrid.vue";
import QueryEditor from "../components/workbench/QueryEditor.vue";
import { useConnectionsStore } from "../stores/connections";
import { useSavedQueriesStore } from "../stores/saved-queries";
import { useWorkbenchStore } from "../stores/workbench";

const route = useRoute();
const router = useRouter();
const connectionsStore = useConnectionsStore();
const savedQueriesStore = useSavedQueriesStore();
const workbenchStore = useWorkbenchStore();
const isSavingQuery = ref(false);
const isSaveModalOpen = ref(false);
const saveModalError = ref("");
const saveForm = reactive({
  name: "",
  schemaName: "",
});

const activeSql = computed({
  get: () => workbenchStore.activeTab?.sql ?? "",
  set: (value: string) => workbenchStore.updateActiveSql(value),
});
const queryPagination = computed(() =>
  workbenchStore.activeResult
    ? {
        page: workbenchStore.activePagination.page,
        pageSize: workbenchStore.activePagination.pageSize,
        canPrevious: workbenchStore.activePagination.page > 1,
        canNext: workbenchStore.activePagination.hasNextPage,
        totalRows: workbenchStore.activePagination.totalRows,
        isLoading: workbenchStore.isRunning,
      }
    : null,
);
const canSaveActiveQuery = computed(
  () =>
    Boolean(connectionsStore.activeProfile) &&
    activeSql.value.trim().length > 0 &&
    !isSavingQuery.value,
);
const activeSavedQuery = computed(() => {
  const savedQueryId = workbenchStore.activeTab?.savedQueryId;

  if (!savedQueryId) {
    return null;
  }

  return (
    savedQueriesStore.queries.find((query) => query.id === savedQueryId) ?? null
  );
});
const schemaOptions = computed(() => {
  const options = new Set<string>();
  const savedSchemaName = activeSavedQuery.value?.schemaName.trim();

  if (savedSchemaName) {
    options.add(savedSchemaName);
  }

  workbenchStore.schemaNames.forEach((schema) => {
    const schemaName = schema.name.trim();

    if (schemaName.length > 0) {
      options.add(schemaName);
    }
  });

  if (options.size === 0) {
    options.add("public");
  }

  return Array.from(options);
});

function resolveSuggestedSchemaName(): string {
  if (activeSavedQuery.value?.schemaName) {
    return activeSavedQuery.value.schemaName;
  }

  const schemaNames = schemaOptions.value;

  if (schemaNames.includes("public")) {
    return "public";
  }

  return schemaNames[0] ?? "public";
}

function openSaveQueryModal(): void {
  const activeConnection = connectionsStore.activeProfile;
  const queryTab = workbenchStore.activeTab;
  const sql = activeSql.value.trim();

  if (!activeConnection) {
    saveModalError.value = "Select an active connection before saving a query.";
    return;
  }

  if (!queryTab || sql.length === 0) {
    saveModalError.value = "There is no SQL to save.";
    return;
  }

  saveForm.name =
    activeSavedQuery.value?.name || queryTab.title || "Saved query";
  saveForm.schemaName = resolveSuggestedSchemaName();
  saveModalError.value = "";
  isSaveModalOpen.value = true;
}

function closeSaveQueryModal(): void {
  if (isSavingQuery.value) {
    return;
  }

  isSaveModalOpen.value = false;
  saveModalError.value = "";
}

async function submitSaveQuery(): Promise<void> {
  const activeConnection = connectionsStore.activeProfile;
  const queryTab = workbenchStore.activeTab;
  const sql = activeSql.value.trim();
  const schemaName = saveForm.schemaName.trim();
  const queryName = saveForm.name.trim();

  if (!activeConnection) {
    saveModalError.value = "Select an active connection before saving a query.";
    return;
  }

  if (!queryTab || sql.length === 0) {
    saveModalError.value = "There is no SQL to save.";
    return;
  }

  if (!schemaName) {
    saveModalError.value = "Schema is required.";
    return;
  }

  if (!queryName) {
    saveModalError.value = "Query name is required.";
    return;
  }

  isSavingQuery.value = true;
  saveModalError.value = "";
  let hasSaved = false;

  try {
    const savedQuery = await savedQueriesStore.saveQuery({
      id: activeSavedQuery.value?.id ?? queryTab.savedQueryId,
      connectionId: activeConnection.id,
      schemaName,
      name: queryName,
      sql,
    });
    workbenchStore.bindActiveTabToSavedQuery({
      savedQueryId: savedQuery.id,
      title: savedQuery.name,
    });
    hasSaved = true;
  } catch (error) {
    saveModalError.value =
      error instanceof Error ? error.message : "Unable to save query.";
  } finally {
    isSavingQuery.value = false;
  }

  if (hasSaved) {
    closeSaveQueryModal();
  }
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey)) {
    return;
  }

  if (event.key.toLowerCase() !== "s") {
    return;
  }

  event.preventDefault();

  if (isSaveModalOpen.value) {
    void submitSaveQuery();
    return;
  }

  openSaveQueryModal();
}

function getRouteQueryTabId(): string {
  return typeof route.params.queryTabId === "string" ? route.params.queryTabId : "";
}

function createRouteQueryTabId(): string {
  return workbenchStore.activeTab?.id ?? workbenchStore.addTab().id;
}

watch(
  () => route.params.queryTabId,
  () => {
    if (route.name !== "query") {
      return;
    }

    const queryTabId = getRouteQueryTabId();

    if (!queryTabId) {
      void router.replace({
        name: "query",
        params: { queryTabId: createRouteQueryTabId() },
      });
      return;
    }

    if (!workbenchStore.setActiveTab(queryTabId)) {
      void router.replace({
        name: "query",
        params: { queryTabId: createRouteQueryTabId() },
      });
    }
  },
  { immediate: true },
);

watch(
  () => workbenchStore.activeTabId,
  (tabId) => {
    if (route.name !== "query") {
      return;
    }

    if (tabId !== getRouteQueryTabId()) {
      void router.replace({ name: "query", params: { queryTabId: tabId } });
    }
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener("keydown", handleWindowKeydown, { capture: true });
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWindowKeydown, {
    capture: true,
  });
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col">
    <Splitpanes horizontal class="default-theme flex min-h-0 flex-1 gap-2">
      <Pane :size="46" :min-size="28">
        <QueryEditor
          v-model="activeSql"
          :is-running="workbenchStore.isRunning"
          :can-save="canSaveActiveQuery"
          :is-saving="isSavingQuery"
          @format="workbenchStore.formatActiveSql"
          @run="workbenchStore.executeActiveQuery"
          @save="openSaveQueryModal"
        />
      </Pane>

      <Pane :size="54" :min-size="28">
        <ResultsGrid
          :result="workbenchStore.activeResult"
          :error-message="workbenchStore.errorMessage"
          :pagination="queryPagination"
          @change-page="workbenchStore.loadActiveQueryPage"
        />
      </Pane>
    </Splitpanes>
  </div>

  <div
    v-if="isSaveModalOpen"
    class="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(7,9,13,0.84)] p-4 backdrop-blur-sm"
    @click="closeSaveQueryModal"
  >
    <section
      class="panel relative z-[1] w-full max-w-lg overflow-hidden"
      @click.stop
    >
      <div
        class="chrome-panel-header flex items-start justify-between gap-3 px-4 py-3"
      >
        <div>
          <h3
            class="font-display text-xl font-semibold tracking-[0.05em] text-[var(--chrome-ink)]"
          >
            Save Query
          </h3>
          <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
            Choose a name and schema for this query.
          </p>
        </div>

        <button
          type="button"
          class="chrome-btn !p-1.5"
          :disabled="isSavingQuery"
          @click="closeSaveQueryModal"
        >
          <X :size="14" />
        </button>
      </div>

      <form class="flex flex-col gap-3 p-4" @submit.prevent="submitSaveQuery">
        <label class="chrome-label">
          <span>Query Name</span>
          <input
            v-model="saveForm.name"
            class="chrome-input mt-1"
            type="text"
            maxlength="120"
            required
            autocomplete="off"
          />
        </label>

        <label class="chrome-label">
          <span>Schema</span>
          <select v-model="saveForm.schemaName" class="chrome-input mt-1">
            <option
              v-for="schemaName in schemaOptions"
              :key="schemaName"
              :value="schemaName"
            >
              {{ schemaName }}
            </option>
          </select>
        </label>

        <p
          v-if="saveModalError"
          class="border border-[rgba(255,82,82,0.48)] bg-[var(--chrome-red-soft)] px-2.5 py-2 text-xs text-[#ff9a9a]"
        >
          {{ saveModalError }}
        </p>

        <div class="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            class="chrome-btn"
            :disabled="isSavingQuery"
            @click="closeSaveQueryModal"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="chrome-btn chrome-btn-primary"
            :disabled="isSavingQuery"
          >
            {{ isSavingQuery ? "Saving..." : "Save Query" }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
