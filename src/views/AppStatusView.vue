<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Lock } from "lucide-vue-next";
import { getRuntimeMode } from "../core/query-engine-service";
import { useVaultStore } from "../stores/vault";

const runtimeMode = getRuntimeMode();
const isWebRuntime = runtimeMode === "web";
const vaultStore = useVaultStore();
const vaultFeedback = ref("");

const matrix = computed(() => [
  {
    feature: "Native desktop DB access (Postgres/MySQL/SQL Server/SQLite)",
    desktop: "Supported",
    web: "Not available",
  },
  {
    feature: "HTTP provider adapters",
    desktop: "Optional",
    web: "Required",
  },
  {
    feature: "Query cancel",
    desktop: "Planned",
    web: "Provider-dependent",
  },
]);

function lockVault(): void {
  vaultStore.lock();
  vaultFeedback.value = "Web secret vault locked.";
}

onMounted(() => {
  vaultStore.refreshStatus();
});
</script>

<template>
  <div class="qwerio-scroll flex max-h-[70vh] flex-col gap-2 overflow-auto">
    <section class="panel-tight p-3">
      <h2 class="font-display text-lg font-semibold tracking-[0.05em] text-[var(--chrome-ink)]">
        System Status
      </h2>
      <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
        Current runtime context for Qwerio.
      </p>
      <div class="mt-3 border border-[var(--chrome-border)] bg-[#0d1118] p-3">
        <p class="text-[0.66rem] font-semibold uppercase tracking-[0.1em] text-[var(--chrome-ink-dim)]">
          Runtime Status
        </p>
        <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
          Current runtime:
          <span class="ml-1 font-semibold uppercase tracking-[0.1em] text-[var(--chrome-green)]">
            {{ runtimeMode }}
          </span>
        </p>
      </div>
    </section>

    <section v-if="isWebRuntime" class="panel-tight p-3">
      <h2 class="font-display text-lg font-semibold tracking-[0.05em] text-[var(--chrome-ink)]">
        Web Secret Vault
      </h2>
      <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
        Lock encrypted credentials. Unlock is handled by the vault overlay when needed.
      </p>

      <div class="mt-3 border border-[var(--chrome-border)] bg-[#0d1118] p-3">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs">
            <span class="chrome-pill" :class="vaultStore.status.unlocked ? 'chrome-pill-ok' : 'chrome-pill-bad'">
              {{ vaultStore.status.unlocked ? "Unlocked" : "Locked" }}
            </span>
          </p>

          <button
            v-if="vaultStore.status.unlocked"
            type="button"
            class="chrome-btn inline-flex items-center gap-1"
            @click="lockVault"
          >
            <Lock :size="12" />
            Lock Vault
          </button>
        </div>
      </div>

      <p v-if="vaultFeedback" class="mt-3 text-xs text-[var(--chrome-yellow)]">{{ vaultFeedback }}</p>
    </section>

    <section class="panel-tight min-h-0 overflow-hidden p-3">
      <h3 class="font-display text-base font-semibold tracking-[0.05em] text-[var(--chrome-ink)]">
        Compatibility Matrix
      </h3>
      <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
        Runtime-aware features for Qwerio's dual-mode architecture.
      </p>
      <div class="mt-3 overflow-hidden border border-[var(--chrome-border)]">
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr class="border-b border-[var(--chrome-border)] bg-[#161c27] text-left text-[var(--chrome-ink-dim)]">
              <th class="px-2.5 py-2 font-semibold uppercase tracking-[0.1em]">Feature</th>
              <th class="px-2.5 py-2 font-semibold uppercase tracking-[0.1em]">Desktop</th>
              <th class="px-2.5 py-2 font-semibold uppercase tracking-[0.1em]">Web</th>
            </tr>
          </thead>

          <tbody>
            <tr v-for="item in matrix" :key="item.feature" class="border-t border-[var(--chrome-border)]">
              <td class="px-2.5 py-2 text-[var(--chrome-ink)]">{{ item.feature }}</td>
              <td class="px-2.5 py-2 text-[var(--chrome-ink-dim)]">{{ item.desktop }}</td>
              <td class="px-2.5 py-2 text-[var(--chrome-ink-dim)]">{{ item.web }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
