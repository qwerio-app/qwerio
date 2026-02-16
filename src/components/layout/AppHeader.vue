<script setup lang="ts">
import { computed } from "vue";
import { useNow } from "@vueuse/core";
import { Database, MonitorCog, Play } from "lucide-vue-next";
import { getRuntimeMode } from "../../core/query-engine-service";

const runtime = getRuntimeMode();
const now = useNow({ interval: 1_000 });

const clock = computed(() =>
  now.value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  }),
);
</script>

<template>
  <header class="panel flex items-center justify-between gap-4 px-4 py-3 md:px-5">
    <div class="flex min-w-0 items-center gap-3">
      <div
        class="flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 bg-gradient-to-br from-emerald-100 to-orange-100 text-emerald-700"
      >
        <Database :size="20" />
      </div>

      <div class="min-w-0">
        <p class="truncate font-display text-xl font-semibold tracking-tight text-slate-900">Lumdara Workbench</p>
        <p class="truncate text-sm text-slate-600">
          {{ runtime === "desktop" ? "Desktop Mode" : "Web Mode" }}
          <span class="mx-1 text-slate-300">•</span>
          {{ clock }}
        </p>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400"
      >
        <MonitorCog :size="16" />
        Command Palette
      </button>

      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-800"
      >
        <Play :size="16" />
        Run Active Query
      </button>
    </div>
  </header>
</template>
