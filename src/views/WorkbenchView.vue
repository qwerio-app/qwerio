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
  <div class="flex min-h-full flex-1 flex-col gap-2">
    <section class="panel-tight flex items-center justify-between px-2 py-1.5">
      <div class="flex min-w-0 items-center gap-1 overflow-auto">
        <button
          v-for="tab in workbenchStore.tabs"
          :key="tab.id"
          type="button"
          :class="[
            'inline-flex items-center gap-2 border px-2.5 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] transition',
            tab.id === workbenchStore.activeTabId
              ? 'border-[var(--chrome-red)] bg-[var(--chrome-red-soft)] text-[var(--chrome-ink)]'
              : 'border-[var(--chrome-border)] bg-[#11161f] text-[var(--chrome-ink-dim)] hover:border-[var(--chrome-border-strong)] hover:text-[var(--chrome-ink)]',
          ]"
          @click="workbenchStore.setActiveTab(tab.id)"
        >
          <span class="max-w-28 truncate">{{ tab.title }}</span>
          <X
            :size="12"
            class="opacity-80"
            @click.stop="workbenchStore.closeTab(tab.id)"
          />
        </button>
      </div>

      <button
        type="button"
        class="chrome-btn inline-flex items-center gap-1.5"
        @click="workbenchStore.addTab"
      >
        <Plus :size="13" />
        New Query
      </button>
    </section>

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
