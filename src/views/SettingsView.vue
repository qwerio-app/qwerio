<script setup lang="ts">
import { Lock } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { getRuntimeMode } from "../core/query-engine-service";
import { useAppSettingsStore } from "../stores/app-settings";
import { useVaultStore } from "../stores/vault";

const appSettingsStore = useAppSettingsStore();
const runtimeMode = getRuntimeMode();
const vaultStore = useVaultStore();
const vaultFeedback = ref("");

function lockVault(): void {
  vaultStore.lock();
  vaultFeedback.value = "Encrypted password PIN locked.";
}

onMounted(() => {
  vaultStore.refreshStatus();
});

function applyTemplatePreset(preset: "now" | "users" | "empty"): void {
  if (preset === "now") {
    appSettingsStore.newQueryTemplateSql = "select now();";
    return;
  }

  if (preset === "users") {
    appSettingsStore.newQueryTemplateSql =
      "select id, name from users limit 100;";
    return;
  }

  appSettingsStore.newQueryTemplateSql = "";
}
</script>

<template>
  <div class="qwerio-scroll flex h-full flex-col gap-2 overflow-auto">
    <section class="panel-tight p-3">
      <h2
        class="font-display text-lg font-semibold tracking-[0.05em] text-[var(--chrome-ink)]"
      >
        System Status
      </h2>
      <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
        Current runtime context for Qwerio.
      </p>
      <div class="mt-3 border border-[var(--chrome-border)] bg-[#0d1118] p-3">
        <p
          class="text-[0.66rem] font-semibold uppercase tracking-[0.1em] text-[var(--chrome-ink-dim)]"
        >
          Runtime Status
        </p>
        <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
          Current runtime:
          <span
            class="ml-1 font-semibold uppercase tracking-[0.1em] text-[var(--chrome-green)]"
          >
            {{ runtimeMode }}
          </span>
        </p>
      </div>
    </section>

    <section v-if="vaultStore.status.supported" class="panel-tight p-3">
      <h2
        class="font-display text-lg font-semibold tracking-[0.05em] text-[var(--chrome-ink)]"
      >
        Connection PIN
      </h2>
      <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
        Lock encrypted connection passwords. Unlock is handled on demand when
        needed.
      </p>

      <div class="mt-3 border border-[var(--chrome-border)] bg-[#0d1118] p-3">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs">
            <span
              class="chrome-pill"
              :class="
                vaultStore.status.unlocked ? 'chrome-pill-ok' : 'chrome-pill-bad'
              "
            >
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
            Lock PIN
          </button>
        </div>
      </div>

      <p v-if="vaultFeedback" class="mt-3 text-xs text-[var(--chrome-yellow)]">
        {{ vaultFeedback }}
      </p>
    </section>

    <section class="panel-tight p-3">
      <h2
        class="font-display text-lg font-semibold tracking-[0.05em] text-[var(--chrome-ink)]"
      >
        App Settings
      </h2>
      <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
        Configure Qwerio behavior and defaults.
      </p>

      <div class="mt-3 grid gap-2">
        <label
          class="flex items-center justify-between gap-3 border border-[var(--chrome-border)] bg-[#0d1118] p-2.5"
        >
          <span class="text-xs text-[var(--chrome-ink-dim)]"
            >Show advanced schema groups (functions, triggers, indexes...)</span
          >
          <input
            v-model="appSettingsStore.showAdvancedSchemaGroups"
            type="checkbox"
            class="size-4 accent-[var(--chrome-red)]"
          />
        </label>

        <label
          class="flex items-center justify-between gap-3 border border-[var(--chrome-border)] bg-[#0d1118] p-2.5"
        >
          <span class="text-xs text-[var(--chrome-ink-dim)]"
            >Default records per results page</span
          >
          <input
            v-model.number="appSettingsStore.resultsPageSize"
            type="number"
            min="1"
            max="5000"
            class="chrome-input chrome-input-sm w-24 text-right"
          />
        </label>
      </div>
    </section>

    <section class="panel-tight p-3">
      <h2
        class="font-display text-lg font-semibold tracking-[0.05em] text-[var(--chrome-ink)]"
      >
        New Query Template
      </h2>
      <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
        SQL inserted when a new query tab is created.
      </p>

      <textarea
        v-model="appSettingsStore.newQueryTemplateSql"
        class="chrome-input mt-3 min-h-24 resize-y"
        spellcheck="false"
      />

      <div class="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          class="chrome-btn"
          @click="applyTemplatePreset('now')"
        >
          Preset: Now()
        </button>
        <button
          type="button"
          class="chrome-btn"
          @click="applyTemplatePreset('users')"
        >
          Preset: Users
        </button>
        <button
          type="button"
          class="chrome-btn"
          @click="applyTemplatePreset('empty')"
        >
          Preset: Empty
        </button>
      </div>
    </section>

    <section class="panel-tight p-3">
      <h2
        class="font-display text-lg font-semibold tracking-[0.05em] text-[var(--chrome-ink)]"
      >
        Danger Zone
      </h2>
      <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
        Reset all settings to their default values. This action cannot be
        undone.
      </p>
      <div class="mt-3 border-t border-[var(--chrome-border)] pt-3">
        <button
          type="button"
          class="chrome-btn"
          @click="appSettingsStore.resetToDefaults"
        >
          Reset Settings
        </button>
      </div>
    </section>
  </div>
</template>
