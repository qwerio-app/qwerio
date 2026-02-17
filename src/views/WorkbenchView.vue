<script setup lang="ts">
import { computed, watch } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import ResultsGrid from "../components/workbench/ResultsGrid.vue";
import SchemaTree from "../components/workbench/SchemaTree.vue";
import SqlEditorPane from "../components/workbench/SqlEditorPane.vue";
import { useWorkbenchStore } from "../stores/workbench";

const workbenchStore = useWorkbenchStore();

const activeSql = computed({
  get: () => workbenchStore.activeTab?.sql ?? "",
  set: (value: string) => workbenchStore.updateActiveSql(value),
});

watch(
  () => workbenchStore.activeTabId,
  () => {
    void workbenchStore.refreshSchema();
  },
);
</script>

<template>
  <div class="flex min-h-full flex-1 flex-col">
    <Splitpanes class="default-theme flex min-h-0 flex-1 gap-2">
      <Pane :size="23" :min-size="15">
        <SchemaTree />
      </Pane>

      <Pane :size="77" :min-size="45">
        <Splitpanes horizontal class="default-theme flex min-h-0 flex-1 gap-2">
          <Pane :size="46" :min-size="28">
            <SqlEditorPane
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
      </Pane>
    </Splitpanes>
  </div>
</template>
