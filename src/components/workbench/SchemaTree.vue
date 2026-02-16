<script setup lang="ts">
import { computed, onMounted } from "vue";
import { Braces, RefreshCcw, Table2 } from "lucide-vue-next";
import { useConnectionsStore } from "../../stores/connections";
import { useWorkbenchStore } from "../../stores/workbench";

const connectionsStore = useConnectionsStore();
const workbenchStore = useWorkbenchStore();

const activeConnectionName = computed(() => connectionsStore.activeProfile?.name ?? "No active connection");

onMounted(async () => {
  await workbenchStore.refreshSchema();
});
</script>

<template>
  <section class="flex h-full flex-col gap-3 overflow-hidden">
    <div class="panel-tight flex items-center justify-between px-3 py-2">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Schema</p>
        <p class="truncate font-display text-sm font-semibold text-slate-900">{{ activeConnectionName }}</p>
      </div>

      <button
        type="button"
        class="rounded-lg p-2 text-slate-600 transition hover:bg-slate-900/5 hover:text-slate-900"
        @click="workbenchStore.refreshSchema"
      >
        <RefreshCcw :size="15" />
      </button>
    </div>

    <div class="lumdara-scroll panel-tight min-h-0 flex-1 overflow-auto p-2">
      <p v-if="workbenchStore.schemaNames.length === 0" class="p-3 text-sm text-slate-500">
        Add a connection to inspect schemas.
      </p>

      <div v-for="schema in workbenchStore.schemaNames" :key="schema.name" class="mb-3 rounded-xl border border-slate-200/80 bg-white/80">
        <div class="flex items-center gap-2 border-b border-slate-200/80 px-3 py-2">
          <Braces :size="14" class="text-teal-700" />
          <p class="font-medium text-slate-800">{{ schema.name }}</p>
        </div>

        <ul class="m-0 list-none p-2">
          <li
            v-for="table in workbenchStore.tableMap[schema.name] ?? []"
            :key="table.name"
            class="mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-900/5"
          >
            <Table2 :size="14" class="text-orange-600" />
            <span>{{ table.name }}</span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
