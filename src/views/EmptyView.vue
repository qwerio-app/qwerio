<script setup lang="ts">
import { Braces, Cable } from "lucide-vue-next";
import { useRouter } from "vue-router";
import { useWorkbenchStore } from "../stores/workbench";

const router = useRouter();
const workbenchStore = useWorkbenchStore();

async function openNewQueryTab(): Promise<void> {
  const queryTab = workbenchStore.addTab();
  await router.push(`/query/${queryTab.id}`);
}

async function openConnections(): Promise<void> {
  await router.push("/connections");
}
</script>

<template>
  <section class="flex h-full min-h-0 items-center justify-center">
    <div
      class="panel-tight w-full max-w-2xl border border-[var(--chrome-border)] bg-[#0d1118] p-6 md:p-8"
    >
      <p
        class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--chrome-ink-muted)]"
      >
        Workspace
      </p>
      <h1
        class="mt-2 font-display text-2xl font-semibold tracking-[0.04em] text-[var(--chrome-ink)]"
      >
        No tabs open
      </h1>
      <p class="mt-2 max-w-xl text-sm leading-relaxed text-[var(--chrome-ink-dim)]">
        Open a query tab to start writing SQL, or pick a connection to browse
        schemas and tables.
      </p>

      <div class="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="chrome-btn chrome-btn-primary inline-flex items-center gap-1.5"
          @click="openNewQueryTab"
        >
          <Braces :size="13" />
          New Query Tab
        </button>

        <button
          type="button"
          class="chrome-btn inline-flex items-center gap-1.5"
          @click="openConnections"
        >
          <Cable :size="13" />
          Connections
        </button>
      </div>
    </div>
  </section>
</template>
