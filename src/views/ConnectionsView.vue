<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { CheckCircle2, Circle, Globe2, Lock, Monitor, Trash2, Unlock } from "lucide-vue-next";
import {
  deleteConnectionSecret,
  getWebSecretVaultStatus,
  lockWebSecretVault,
  storeConnectionSecret,
  unlockWebSecretVault,
} from "../core/secret-vault";
import { getRuntimeMode } from "../core/query-engine-service";
import type { ConnectionSecret, ConnectionTarget, DbDialect } from "../core/types";
import { useConnectionsStore } from "../stores/connections";

const store = useConnectionsStore();

const feedback = ref("");
const isSubmitting = ref(false);
const runtimeMode = getRuntimeMode();
const isWebRuntime = runtimeMode === "web";
const vaultPassphrase = ref("");
const vaultStatus = ref(getWebSecretVaultStatus());

const form = reactive({
  name: "",
  kind: (isWebRuntime ? "web-provider" : "desktop-tcp") as ConnectionTarget["kind"],
  dialect: "postgres" as DbDialect,
  host: "",
  port: 5432,
  database: "",
  user: "",
  password: "",
  provider: "postgres" as Extract<ConnectionTarget, { kind: "web-provider" }>["provider"],
  endpoint: "",
  projectId: "",
  postgresAuthMode: "connection-string" as "connection-string" | "fields",
  connectionString: "",
  postgresHost: "",
  postgresPort: 5432,
  postgresDatabase: "",
  postgresUser: "",
  postgresPassword: "",
  postgresSslMode: "require" as "require" | "prefer" | "disable",
  providerUsername: "",
  providerPassword: "",
});

function buildPostgresConnectionStringFromFields(): string | null {
  if (!form.postgresHost || !form.postgresDatabase || !form.postgresUser) {
    feedback.value = "Host, database, and user are required for Postgres field mode.";
    return null;
  }

  const encodedUser = encodeURIComponent(form.postgresUser);
  const encodedPassword = encodeURIComponent(form.postgresPassword);
  const encodedDatabase = encodeURIComponent(form.postgresDatabase);
  const auth = form.postgresPassword ? `${encodedUser}:${encodedPassword}` : encodedUser;
  const base = `postgresql://${auth}@${form.postgresHost}:${Number(form.postgresPort)}/${encodedDatabase}`;

  if (form.postgresSslMode === "prefer") {
    return base;
  }

  return `${base}?sslmode=${form.postgresSslMode}`;
}

function refreshVaultStatus(): void {
  vaultStatus.value = getWebSecretVaultStatus();
}

async function unlockVault(): Promise<void> {
  if (!isWebRuntime) {
    return;
  }

  feedback.value = "";

  try {
    await unlockWebSecretVault(vaultPassphrase.value);
    refreshVaultStatus();
    feedback.value = "Web secret vault unlocked.";
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to unlock web secret vault.";
  }
}

function lockVault(): void {
  if (!isWebRuntime) {
    return;
  }

  lockWebSecretVault();
  refreshVaultStatus();
  feedback.value = "Web secret vault locked.";
}

function toConnectionTarget(): ConnectionTarget {
  if (form.kind === "desktop-tcp") {
    return {
      kind: "desktop-tcp",
      dialect: form.dialect,
      host: form.host,
      port: Number(form.port),
      database: form.database,
      user: form.user,
    };
  }

  if (form.provider === "planetscale") {
    return {
      kind: "web-provider",
      dialect: "mysql",
      provider: "planetscale",
      endpoint: form.endpoint,
      projectId: form.projectId || undefined,
    };
  }

  return {
    kind: "web-provider",
    dialect: "postgres",
    provider: form.provider,
    endpoint:
      form.provider === "neon"
        ? form.endpoint || "neon-http"
        : form.postgresAuthMode === "fields"
          ? form.postgresHost || "postgres-http"
          : form.endpoint || "postgres-http",
    projectId: form.projectId || undefined,
  };
}

function toConnectionSecret(target: ConnectionTarget): ConnectionSecret | null {
  if (target.kind === "desktop-tcp") {
    return {
      kind: "desktop-tcp",
      password: form.password || undefined,
    };
  }

  if (target.provider === "planetscale") {
    if (!form.providerUsername || !form.providerPassword) {
      feedback.value = "PlanetScale username and password are required.";
      return null;
    }

    return {
      kind: "web-provider",
      provider: "planetscale",
      username: form.providerUsername,
      password: form.providerPassword,
    };
  }

  if (target.provider === "postgres" && form.postgresAuthMode === "fields") {
    const connectionString = buildPostgresConnectionStringFromFields();

    if (!connectionString) {
      return null;
    }

    return {
      kind: "web-provider",
      provider: "postgres",
      connectionString,
    };
  }

  if (!form.connectionString) {
    feedback.value =
      target.provider === "neon" ? "Neon connection string is required." : "Postgres connection string is required.";
    return null;
  }

  return {
    kind: "web-provider",
    provider: target.provider,
    connectionString: form.connectionString,
  };
}

function resetForm(): void {
  form.name = "";
  form.host = "";
  form.database = "";
  form.user = "";
  form.password = "";
  form.endpoint = "";
  form.projectId = "";
  form.postgresAuthMode = "connection-string";
  form.connectionString = "";
  form.postgresHost = "";
  form.postgresPort = 5432;
  form.postgresDatabase = "";
  form.postgresUser = "";
  form.postgresPassword = "";
  form.postgresSslMode = "require";
  form.providerUsername = "";
  form.providerPassword = "";
}

async function submitConnection(): Promise<void> {
  feedback.value = "";
  isSubmitting.value = true;

  try {
    const target = toConnectionTarget();
    const secret = toConnectionSecret(target);

    if (!secret) {
      return;
    }

    if (isWebRuntime && target.kind === "web-provider" && !vaultStatus.value.unlocked) {
      if (!vaultPassphrase.value) {
        feedback.value = "Unlock the web secret vault with your passphrase before saving web connections.";
        return;
      }

      await unlockWebSecretVault(vaultPassphrase.value);
      refreshVaultStatus();
    }

    const result = store.addConnection({
      name: form.name,
      target,
    });

    if (!result.ok) {
      feedback.value = result.message;
      return;
    }

    try {
      await storeConnectionSecret(result.profile.id, secret);
    } catch (error) {
      store.removeConnection(result.profile.id);
      feedback.value =
        error instanceof Error ? error.message : "Failed to store connection credentials securely.";
      return;
    }

    store.setActiveConnection(result.profile.id);
    feedback.value = "Connection saved with encrypted credentials.";
    resetForm();
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to save connection.";
  } finally {
    isSubmitting.value = false;
  }
}

async function removeConnection(id: string): Promise<void> {
  feedback.value = "";

  try {
    await deleteConnectionSecret(id);
    store.removeConnection(id);
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "Unable to remove connection.";
  }
}

onMounted(() => {
  refreshVaultStatus();
});
</script>

<template>
  <div class="grid min-h-0 flex-1 gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
    <section class="panel-tight lumdara-scroll overflow-auto p-4">
      <h2 class="font-display text-lg font-semibold tracking-tight text-slate-900">New Connection</h2>
      <p class="mt-1 text-sm text-slate-600">
        Desktop uses native drivers. Web mode uses provider HTTP adapters and cannot connect directly to localhost TCP databases.
      </p>

      <div v-if="isWebRuntime" class="mt-4 rounded-xl border border-slate-200 bg-white/80 p-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="text-sm font-semibold text-slate-900">Web Secret Vault</p>
            <p class="text-xs text-slate-600">
              Status:
              <span class="font-semibold" :class="vaultStatus.unlocked ? 'text-emerald-700' : 'text-amber-700'">
                {{ vaultStatus.unlocked ? "Unlocked" : "Locked" }}
              </span>
            </p>
          </div>

          <button
            v-if="vaultStatus.unlocked"
            type="button"
            class="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
            @click="lockVault"
          >
            <Lock :size="13" />
            Lock
          </button>
        </div>

        <div class="mt-3 flex items-center gap-2" v-if="!vaultStatus.unlocked">
          <input
            v-model="vaultPassphrase"
            type="password"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="Enter passphrase (min 8 chars)"
          />
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-2 text-xs font-semibold text-white hover:bg-slate-900"
            @click="unlockVault"
          >
            <Unlock :size="13" />
            {{ vaultStatus.initialized ? "Unlock" : "Create" }}
          </button>
        </div>
      </div>

      <form class="mt-4 flex flex-col gap-3" @submit.prevent="submitConnection">
        <label class="text-sm font-medium text-slate-700">
          Name
          <input v-model="form.name" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" type="text" />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="text-sm font-medium text-slate-700">
            Mode
            <select v-model="form.kind" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="desktop-tcp" :disabled="isWebRuntime">Desktop TCP</option>
              <option value="web-provider">Web Provider</option>
            </select>
          </label>

          <label class="text-sm font-medium text-slate-700">
            Dialect
            <select
              v-model="form.dialect"
              :disabled="form.kind === 'web-provider'"
              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100"
            >
              <option value="postgres">Postgres</option>
              <option value="mysql">MySQL</option>
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

          <label class="text-sm font-medium text-slate-700">
            Password (optional)
            <input
              v-model="form.password"
              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              type="password"
            />
          </label>
        </template>

        <template v-else>
          <label class="text-sm font-medium text-slate-700">
            Provider
            <select v-model="form.provider" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="postgres">Postgres (Standard)</option>
              <option value="neon">Neon (Postgres HTTP)</option>
              <option value="planetscale">PlanetScale (MySQL HTTP)</option>
            </select>
          </label>

          <template v-if="form.provider === 'planetscale'">
            <label class="text-sm font-medium text-slate-700">
              PlanetScale Host
              <input
                v-model="form.endpoint"
                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                type="text"
                placeholder="aws.connect.psdb.cloud"
              />
            </label>

            <div class="grid grid-cols-2 gap-3">
              <label class="text-sm font-medium text-slate-700">
                Username
                <input
                  v-model="form.providerUsername"
                  class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  type="text"
                />
              </label>

              <label class="text-sm font-medium text-slate-700">
                Password
                <input
                  v-model="form.providerPassword"
                  class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  type="password"
                />
              </label>
            </div>
          </template>

          <template v-else-if="form.provider === 'postgres'">
            <label class="text-sm font-medium text-slate-700">
              Postgres Credential Format
              <select v-model="form.postgresAuthMode" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                <option value="connection-string">Connection String</option>
                <option value="fields">Separate Fields</option>
              </select>
            </label>

            <template v-if="form.postgresAuthMode === 'connection-string'">
              <label class="text-sm font-medium text-slate-700">
                Postgres Connection String
                <input
                  v-model="form.connectionString"
                  class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  type="password"
                  placeholder="postgresql://user:password@host/database"
                />
              </label>
            </template>

            <template v-else>
              <label class="text-sm font-medium text-slate-700">
                Host
                <input
                  v-model="form.postgresHost"
                  class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  type="text"
                  placeholder="db.example.com"
                />
              </label>

              <div class="grid grid-cols-2 gap-3">
                <label class="text-sm font-medium text-slate-700">
                  Port
                  <input
                    v-model.number="form.postgresPort"
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    type="number"
                  />
                </label>

                <label class="text-sm font-medium text-slate-700">
                  Database
                  <input
                    v-model="form.postgresDatabase"
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    type="text"
                  />
                </label>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <label class="text-sm font-medium text-slate-700">
                  User
                  <input
                    v-model="form.postgresUser"
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    type="text"
                  />
                </label>

                <label class="text-sm font-medium text-slate-700">
                  Password
                  <input
                    v-model="form.postgresPassword"
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    type="password"
                  />
                </label>
              </div>

              <label class="text-sm font-medium text-slate-700">
                SSL Mode
                <select v-model="form.postgresSslMode" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                  <option value="require">require</option>
                  <option value="prefer">prefer</option>
                  <option value="disable">disable</option>
                </select>
              </label>
            </template>
          </template>

          <template v-else>
            <label class="text-sm font-medium text-slate-700">
              Neon Connection String
              <input
                v-model="form.connectionString"
                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                type="password"
                placeholder="postgresql://user:password@ep-...neon.tech/database"
              />
            </label>
          </template>
        </template>

        <button
          type="submit"
          :disabled="isSubmitting"
          class="mt-2 inline-flex items-center justify-center rounded-xl bg-teal-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ isSubmitting ? "Saving..." : "Save Connection" }}
        </button>
      </form>

      <p class="mt-3 text-sm text-slate-600" v-if="feedback">{{ feedback }}</p>
    </section>

    <section class="panel-tight lumdara-scroll min-h-0 overflow-auto p-4">
      <h2 class="font-display text-lg font-semibold tracking-tight text-slate-900">Saved Connections</h2>

      <div
        v-if="store.profiles.length === 0"
        class="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500"
      >
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
              @click="removeConnection(profile.id)"
            >
              <Trash2 :size="15" />
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
