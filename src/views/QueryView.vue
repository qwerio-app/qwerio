<script setup lang="ts">
import { computed, watch } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import { useRoute, useRouter } from "vue-router";
import ResultsGrid from "../components/workbench/ResultsGrid.vue";
import QueryEditor from "../components/workbench/QueryEditor.vue";
import { useWorkbenchStore } from "../stores/workbench";

const route = useRoute();
const router = useRouter();
const workbenchStore = useWorkbenchStore();

const activeSql = computed({
  get: () => workbenchStore.activeTab?.sql ?? "",
  set: (value: string) => workbenchStore.updateActiveSql(value),
});

function getRouteQueryTabId(): string {
  return typeof route.params.queryTabId === "string" ? route.params.queryTabId : "";
}

function getFallbackQueryTabId(): string {
  return workbenchStore.activeTab?.id ?? workbenchStore.tabs[0]?.id ?? workbenchStore.addTab().id;
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
        params: { queryTabId: getFallbackQueryTabId() },
      });
      return;
    }

    if (!workbenchStore.setActiveTab(queryTabId)) {
      void router.replace({
        name: "query",
        params: { queryTabId: getFallbackQueryTabId() },
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
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col">
    <Splitpanes horizontal class="default-theme flex min-h-0 flex-1 gap-2">
      <Pane :size="46" :min-size="28">
        <QueryEditor
          v-model="activeSql"
          :is-running="workbenchStore.isRunning"
          @format="workbenchStore.formatActiveSql"
          @run="workbenchStore.executeActiveQuery"
        />
      </Pane>

      <Pane :size="54" :min-size="28">
        <ResultsGrid
          :result="workbenchStore.activeResult"
          :error-message="workbenchStore.errorMessage"
        />
      </Pane>
    </Splitpanes>
  </div>
</template>
