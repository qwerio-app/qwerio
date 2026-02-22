<script setup lang="ts">
import { Lock } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { getRuntimeMode } from "../../core/query-engine-service";
import { useVaultStore } from "../../stores/vault";

const runtimeMode = getRuntimeMode();
const isWebRuntime = runtimeMode === "web";
const vaultStore = useVaultStore();
const vaultFeedback = ref("");

function lockVault(): void {
  vaultStore.lock();
  vaultFeedback.value = "Web secret vault locked.";
}

onMounted(() => {
  vaultStore.refreshStatus();
});
</script>

<template>
  <div class="flex flex-col gap-2">
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
  </div>
</template>
