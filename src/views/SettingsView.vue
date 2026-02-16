<script setup lang="ts">
import { computed } from "vue";
import { getRuntimeMode } from "../core/query-engine-service";

const runtimeMode = getRuntimeMode();

const matrix = computed(() => [
  {
    feature: "Direct TCP to Postgres/MySQL",
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
</script>

<template>
  <div class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
    <section class="panel-tight min-h-0 overflow-hidden p-4">
      <h2 class="font-display text-lg font-semibold tracking-tight text-slate-900">Capabilities</h2>
      <p class="mt-1 text-sm text-slate-600">Runtime-aware feature matrix for Lumdara's dual-mode architecture.</p>

      <div class="mt-4 overflow-hidden rounded-xl border border-slate-200">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="bg-slate-100 text-left text-slate-700">
              <th class="px-3 py-2 font-semibold">Feature</th>
              <th class="px-3 py-2 font-semibold">Desktop</th>
              <th class="px-3 py-2 font-semibold">Web</th>
            </tr>
          </thead>

          <tbody>
            <tr v-for="item in matrix" :key="item.feature" class="border-t border-slate-200">
              <td class="px-3 py-2 text-slate-800">{{ item.feature }}</td>
              <td class="px-3 py-2 text-slate-600">{{ item.desktop }}</td>
              <td class="px-3 py-2 text-slate-600">{{ item.web }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel-tight p-4">
      <h3 class="font-display text-lg font-semibold tracking-tight text-slate-900">Runtime Status</h3>
      <div class="mt-3 rounded-xl border border-slate-200 bg-white/80 p-3 text-sm text-slate-700">
        Current runtime: <span class="font-semibold text-slate-900">{{ runtimeMode }}</span>
      </div>

      <h3 class="mt-4 font-display text-lg font-semibold tracking-tight text-slate-900">Security Notes</h3>
      <ul class="mt-2 space-y-2 pl-5 text-sm text-slate-700">
        <li>Credentials are intended to be encrypted before persistence.</li>
        <li>Web mode is limited to browser-reachable cloud SQL endpoints.</li>
        <li>Desktop mode is where full socket-level Postgres/MySQL support lands.</li>
      </ul>
    </section>
  </div>
</template>
