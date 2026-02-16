<script setup lang="ts">
import { reactive, ref } from "vue";
import { CheckCircle2, Circle, Globe2, Monitor, Trash2 } from "lucide-vue-next";
import type { ConnectionTarget, DbDialect } from "../core/types";
import { useConnectionsStore } from "../stores/connections";

const store = useConnectionsStore();

const feedback = ref("");

const form = reactive({
  name: "",
  kind: "desktop-tcp" as ConnectionTarget["kind"],
  dialect: "postgres" as DbDialect,
  host: "",
  port: 5432,
  database: "",
  user: "",
  provider: "",
  endpoint: "",
  projectId: "",
});

function submitConnection(): void {
  const target: ConnectionTarget =
    form.kind === "desktop-tcp"
      ? {
          kind: "desktop-tcp",
          dialect: form.dialect,
          host: form.host,
          port: Number(form.port),
          database: form.database,
          user: form.user,
        }
      : {
          kind: "web-provider",
          dialect: form.dialect,
          provider: form.provider,
          endpoint: form.endpoint,
          projectId: form.projectId || undefined,
        };

  const result = store.addConnection({
    name: form.name,
    target,
  });

  if (!result.ok) {
    feedback.value = result.message;
    return;
  }

  feedback.value = "Connection saved.";
  form.name = "";
  form.host = "";
  form.database = "";
  form.user = "";
  form.provider = "";
  form.endpoint = "";
  form.projectId = "";
}
</script>

<template>
  <div class="grid min-h-0 flex-1 gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
    <section class="panel-tight lumdara-scroll overflow-auto p-4">
      <h2 class="font-display text-lg font-semibold tracking-tight text-slate-900">New Connection</h2>
      <p class="mt-1 text-sm text-slate-600">Desktop mode supports TCP targets. Web mode supports provider HTTP endpoints.</p>

      <form class="mt-4 flex flex-col gap-3" @submit.prevent="submitConnection">
        <label class="text-sm font-medium text-slate-700">
          Name
          <input v-model="form.name" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" type="text" />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="text-sm font-medium text-slate-700">
            Dialect
            <select v-model="form.dialect" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="postgres">Postgres</option>
              <option value="mysql">MySQL</option>
            </select>
          </label>

          <label class="text-sm font-medium text-slate-700">
            Mode
            <select v-model="form.kind" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="desktop-tcp">Desktop TCP</option>
              <option value="web-provider">Web Provider</option>
            </select>
          </label>
        </div>

        <template v-if="form.kind === 'desktop-tcp'">
          <label class="text-sm font-medium text-slate-700">
            Host
            <input v-model="form.host" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" type="text" />
          </label>

          <div class="grid grid-cols-2 gap-3">
            <label class="text-sm font-medium text-slate-700">
              Port
              <input v-model.number="form.port" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" type="number" />
            </label>

            <label class="text-sm font-medium text-slate-700">
              Database
              <input
                v-model="form.database"
                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                type="text"
              />
            </label>
          </div>

          <label class="text-sm font-medium text-slate-700">
            User
            <input v-model="form.user" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" type="text" />
          </label>
        </template>

        <template v-else>
          <label class="text-sm font-medium text-slate-700">
            Provider
            <input
              v-model="form.provider"
              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              type="text"
              placeholder="Neon / PlanetScale / ..."
            />
          </label>

          <label class="text-sm font-medium text-slate-700">
            Endpoint
            <input
              v-model="form.endpoint"
              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              type="url"
              placeholder="https://..."
            />
          </label>

          <label class="text-sm font-medium text-slate-700">
            Project ID (optional)
            <input
              v-model="form.projectId"
              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              type="text"
            />
          </label>
        </template>

        <button
          type="submit"
          class="mt-2 inline-flex items-center justify-center rounded-xl bg-teal-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-800"
        >
          Save Connection
        </button>
      </form>

      <p class="mt-3 text-sm text-slate-600" v-if="feedback">{{ feedback }}</p>
    </section>

    <section class="panel-tight lumdara-scroll min-h-0 overflow-auto p-4">
      <h2 class="font-display text-lg font-semibold tracking-tight text-slate-900">Saved Connections</h2>

      <div v-if="store.profiles.length === 0" class="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
        No saved connections yet.
      </div>

      <ul v-else class="mt-4 m-0 list-none space-y-2 p-0">
        <li
          v-for="profile in store.profiles"
          :key="profile.id"
          class="flex items-center justify-between rounded-xl border border-slate-200 bg-white/90 px-3 py-2"
        >
          <button
            type="button"
            class="flex min-w-0 items-center gap-3 text-left"
            @click="store.setActiveConnection(profile.id)"
          >
            <component
              :is="profile.target.kind === 'desktop-tcp' ? Monitor : Globe2"
              :size="15"
              :class="profile.target.kind === 'desktop-tcp' ? 'text-teal-700' : 'text-orange-700'"
            />

            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-slate-900">{{ profile.name }}</p>
              <p class="truncate text-xs text-slate-500">
                {{ profile.target.kind === "desktop-tcp" ? profile.target.host : profile.target.provider }}
              </p>
            </div>
          </button>

          <div class="flex items-center gap-2">
            <component
              :is="store.activeConnectionId === profile.id ? CheckCircle2 : Circle"
              :size="16"
              :class="store.activeConnectionId === profile.id ? 'text-emerald-600' : 'text-slate-300'"
            />

            <button
              type="button"
              class="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-700"
              @click="store.removeConnection(profile.id)"
            >
              <Trash2 :size="15" />
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
