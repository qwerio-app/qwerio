<script setup lang="ts">
import { useAppSettingsStore } from "../stores/app-settings";
import SettingsView from "./SettingsView.vue";

const appSettingsStore = useAppSettingsStore();

function applyTemplatePreset(preset: "now" | "users" | "empty"): void {
  if (preset === "now") {
    appSettingsStore.newQueryTemplateSql = "select now();";
    return;
  }

  if (preset === "users") {
    appSettingsStore.newQueryTemplateSql = "select id, name from users limit 100;";
    return;
  }

  appSettingsStore.newQueryTemplateSql = "";
}
</script>

<template>
  <div class="lumdara-scroll flex h-full flex-col gap-2 overflow-auto">
    <section class="panel-tight p-3">
      <h2 class="font-display text-lg font-semibold tracking-[0.05em] text-[var(--chrome-ink)]">
        App Settings
      </h2>
      <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
        Configure Lumdara behavior and defaults.
      </p>

      <div class="mt-3 grid gap-2 md:grid-cols-2">
        <label class="flex items-center justify-between gap-3 border border-[var(--chrome-border)] bg-[#0d1118] p-2.5">
          <span class="text-xs text-[var(--chrome-ink-dim)]">Show system status button in header</span>
          <input
            v-model="appSettingsStore.showSystemStatusButton"
            type="checkbox"
            class="size-4 accent-[var(--chrome-red)]"
          />
        </label>

        <label class="flex items-center justify-between gap-3 border border-[var(--chrome-border)] bg-[#0d1118] p-2.5">
          <span class="text-xs text-[var(--chrome-ink-dim)]">Show connection status pill in header</span>
          <input
            v-model="appSettingsStore.showConnectionStatusPill"
            type="checkbox"
            class="size-4 accent-[var(--chrome-red)]"
          />
        </label>
      </div>
    </section>

    <section class="panel-tight p-3">
      <h3 class="font-display text-base font-semibold tracking-[0.05em] text-[var(--chrome-ink)]">
        New Query Template
      </h3>
      <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
        SQL inserted when a new query tab is created.
      </p>

      <textarea
        v-model="appSettingsStore.newQueryTemplateSql"
        class="chrome-input mt-3 min-h-24 resize-y"
        spellcheck="false"
      />

      <div class="mt-2 flex flex-wrap gap-2">
        <button type="button" class="chrome-btn" @click="applyTemplatePreset('now')">
          Preset: Now()
        </button>
        <button type="button" class="chrome-btn" @click="applyTemplatePreset('users')">
          Preset: Users
        </button>
        <button type="button" class="chrome-btn" @click="applyTemplatePreset('empty')">
          Preset: Empty
        </button>
      </div>

      <div class="mt-3 border-t border-[var(--chrome-border)] pt-3">
        <button type="button" class="chrome-btn" @click="appSettingsStore.resetToDefaults">
          Reset Settings
        </button>
      </div>
    </section>

    <section class="panel-tight p-3">
      <h3 class="font-display text-base font-semibold tracking-[0.05em] text-[var(--chrome-ink)]">
        Runtime Details
      </h3>
      <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
        Environment status and compatibility overview.
      </p>
      <div class="mt-3">
        <SettingsView />
      </div>
    </section>
  </div>
</template>
