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
  <section class="panel-tight flex h-full flex-col overflow-hidden">
    <div class="chrome-panel-header flex items-center justify-between px-2.5 py-2">
      <div>
        <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chrome-ink-muted)]">schema</p>
        <p class="truncate font-display text-base font-semibold tracking-[0.03em] text-[var(--chrome-ink)]">{{ activeConnectionName }}</p>
      </div>

      <button
        type="button"
        class="chrome-btn !p-1.5"
        aria-label="refresh schema"
        @click="workbenchStore.refreshSchema"
      >
        <RefreshCcw :size="14" />
      </button>
    </div>

    <div class="lumdara-scroll min-h-0 flex-1 overflow-auto p-2">
      <p v-if="workbenchStore.schemaNames.length === 0" class="chrome-empty p-3 text-xs">
        Add a connection to inspect schemas.
      </p>

      <div
        v-for="schema in workbenchStore.schemaNames"
        :key="schema.name"
        class="mb-2 border border-[var(--chrome-border)] bg-[#0f141c]"
      >
        <div class="flex items-center gap-2 border-b border-[var(--chrome-border)] px-2.5 py-1.5">
          <Braces :size="13" class="text-[var(--chrome-red)]" />
          <p class="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--chrome-ink-dim)]">{{ schema.name }}</p>
        </div>

        <ul class="m-0 list-none p-1.5">
          <li
            v-for="table in workbenchStore.tableMap[schema.name] ?? []"
            :key="table.name"
            class="mb-1 flex items-center gap-1.5 border border-transparent px-1.5 py-1 text-xs text-[var(--chrome-ink-dim)] hover:border-[var(--chrome-border)] hover:bg-[#141a24] hover:text-[var(--chrome-ink)]"
          >
            <Table2 :size="12" class="text-[var(--chrome-yellow)]" />
            <span class="truncate">{{ table.name }}</span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
