<script setup lang="ts">
import { computed, watch } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import { Plus, X } from "lucide-vue-next";
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
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <section class="panel-tight flex items-center justify-between px-3 py-2">
      <div class="flex min-w-0 items-center gap-1">
        <button
          v-for="tab in workbenchStore.tabs"
          :key="tab.id"
          type="button"
          :class="[
            'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition',
            tab.id === workbenchStore.activeTabId
              ? 'bg-teal-700 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-100',
          ]"
          @click="workbenchStore.setActiveTab(tab.id)"
        >
          <span class="max-w-28 truncate">{{ tab.title }}</span>
          <X :size="12" class="opacity-80" @click.stop="workbenchStore.closeTab(tab.id)" />
        </button>
      </div>

      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400"
        @click="workbenchStore.addTab"
      >
        <Plus :size="14" />
        New Query
      </button>
    </section>

    <Splitpanes class="default-theme flex min-h-0 flex-1 gap-3">
      <Pane :size="22" :min-size="16">
        <SchemaTree />
      </Pane>

      <Pane :size="78" :min-size="50">
        <Splitpanes horizontal class="default-theme flex min-h-0 flex-1 gap-3">
          <Pane :size="46" :min-size="28">
            <SqlEditorPane
              v-model="activeSql"
              :is-running="workbenchStore.isRunning"
              @format="workbenchStore.formatActiveSql"
              @run="workbenchStore.executeActiveQuery"
            />
          </Pane>

          <Pane :size="54" :min-size="30">
            <ResultsGrid :result="workbenchStore.activeResult" :error-message="workbenchStore.errorMessage" />
          </Pane>
        </Splitpanes>
      </Pane>
    </Splitpanes>
  </div>
</template>
