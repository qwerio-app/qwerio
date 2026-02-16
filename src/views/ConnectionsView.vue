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
  <div class="grid min-h-0 flex-1 gap-2 xl:grid-cols-[400px_minmax(0,1fr)]">
    <section class="panel-tight lumdara-scroll overflow-auto p-3">
      <h2 class="font-display text-xl font-semibold tracking-[0.05em] text-[var(--chrome-ink)]">Connection Provisioning</h2>
      <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
        Runtime mode: {{ runtimeMode }}. Desktop supports direct TCP drivers. Web mode requires provider HTTP adapters.
      </p>

      <div v-if="isWebRuntime" class="mt-3 border border-[var(--chrome-border)] bg-[#0d1118] p-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--chrome-ink-dim)]">Web Secret Vault</p>
            <p class="mt-1 text-xs">
              <span class="chrome-pill" :class="vaultStatus.unlocked ? 'chrome-pill-ok' : 'chrome-pill-bad'">
                {{ vaultStatus.unlocked ? "Unlocked" : "Locked" }}
              </span>
            </p>
          </div>

          <button v-if="vaultStatus.unlocked" type="button" class="chrome-btn inline-flex items-center gap-1" @click="lockVault">
            <Lock :size="12" />
            Lock
          </button>
        </div>

        <div class="mt-3 flex items-center gap-2" v-if="!vaultStatus.unlocked">
          <input
            v-model="vaultPassphrase"
            type="password"
            class="chrome-input"
            placeholder="Enter passphrase (min 8 chars)"
          />
          <button type="button" class="chrome-btn chrome-btn-primary inline-flex items-center gap-1" @click="unlockVault">
            <Unlock :size="12" />
            {{ vaultStatus.initialized ? "Unlock" : "Create" }}
          </button>
        </div>
      </div>

      <form class="mt-4 flex flex-col gap-3" @submit.prevent="submitConnection">
        <label class="chrome-label">
          <span>Name</span>
          <input v-model="form.name" class="chrome-input mt-1" type="text" />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="chrome-label">
            <span>Mode</span>
            <select v-model="form.kind" class="chrome-input mt-1">
              <option value="desktop-tcp" :disabled="isWebRuntime">Desktop TCP</option>
              <option value="web-provider">Web Provider</option>
            </select>
          </label>

          <label class="chrome-label">
            <span>Dialect</span>
            <select v-model="form.dialect" :disabled="form.kind === 'web-provider'" class="chrome-input mt-1">
              <option value="postgres">Postgres</option>
              <option value="mysql">MySQL</option>
            </select>
          </label>
        </div>

        <template v-if="form.kind === 'desktop-tcp'">
          <label class="chrome-label">
            <span>Host</span>
            <input v-model="form.host" class="chrome-input mt-1" type="text" />
          </label>

          <div class="grid grid-cols-2 gap-3">
            <label class="chrome-label">
              <span>Port</span>
              <input v-model.number="form.port" class="chrome-input mt-1" type="number" />
            </label>

            <label class="chrome-label">
              <span>Database</span>
              <input v-model="form.database" class="chrome-input mt-1" type="text" />
            </label>
          </div>

          <label class="chrome-label">
            <span>User</span>
            <input v-model="form.user" class="chrome-input mt-1" type="text" />
          </label>

          <label class="chrome-label">
            <span>Password (optional)</span>
            <input v-model="form.password" class="chrome-input mt-1" type="password" />
          </label>
        </template>

        <template v-else>
          <label class="chrome-label">
            <span>Provider</span>
            <select v-model="form.provider" class="chrome-input mt-1">
              <option value="postgres">Postgres (Standard)</option>
              <option value="neon">Neon (Postgres HTTP)</option>
              <option value="planetscale">PlanetScale (MySQL HTTP)</option>
            </select>
          </label>

          <template v-if="form.provider === 'planetscale'">
            <label class="chrome-label">
              <span>PlanetScale Host</span>
              <input
                v-model="form.endpoint"
                class="chrome-input mt-1"
                type="text"
                placeholder="aws.connect.psdb.cloud"
              />
            </label>

            <div class="grid grid-cols-2 gap-3">
              <label class="chrome-label">
                <span>Username</span>
                <input v-model="form.providerUsername" class="chrome-input mt-1" type="text" />
              </label>

              <label class="chrome-label">
                <span>Password</span>
                <input v-model="form.providerPassword" class="chrome-input mt-1" type="password" />
              </label>
            </div>
          </template>

          <template v-else-if="form.provider === 'postgres'">
            <label class="chrome-label">
              <span>Postgres Credential Format</span>
              <select v-model="form.postgresAuthMode" class="chrome-input mt-1">
                <option value="connection-string">Connection String</option>
                <option value="fields">Separate Fields</option>
              </select>
            </label>

            <template v-if="form.postgresAuthMode === 'connection-string'">
              <label class="chrome-label">
                <span>Postgres Connection String</span>
                <input
                  v-model="form.connectionString"
                  class="chrome-input mt-1"
                  type="password"
                  placeholder="postgresql://user:password@host/database"
                />
              </label>
            </template>

            <template v-else>
              <label class="chrome-label">
                <span>Host</span>
                <input
                  v-model="form.postgresHost"
                  class="chrome-input mt-1"
                  type="text"
                  placeholder="db.example.com"
                />
              </label>

              <div class="grid grid-cols-2 gap-3">
                <label class="chrome-label">
                  <span>Port</span>
                  <input v-model.number="form.postgresPort" class="chrome-input mt-1" type="number" />
                </label>

                <label class="chrome-label">
                  <span>Database</span>
                  <input v-model="form.postgresDatabase" class="chrome-input mt-1" type="text" />
                </label>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <label class="chrome-label">
                  <span>User</span>
                  <input v-model="form.postgresUser" class="chrome-input mt-1" type="text" />
                </label>

                <label class="chrome-label">
                  <span>Password</span>
                  <input v-model="form.postgresPassword" class="chrome-input mt-1" type="password" />
                </label>
              </div>

              <label class="chrome-label">
                <span>SSL Mode</span>
                <select v-model="form.postgresSslMode" class="chrome-input mt-1">
                  <option value="require">require</option>
                  <option value="prefer">prefer</option>
                  <option value="disable">disable</option>
                </select>
              </label>
            </template>
          </template>

          <template v-else>
            <label class="chrome-label">
              <span>Neon Connection String</span>
              <input
                v-model="form.connectionString"
                class="chrome-input mt-1"
                type="password"
                placeholder="postgresql://user:password@ep-...neon.tech/database"
              />
            </label>
          </template>
        </template>

        <button type="submit" :disabled="isSubmitting" class="chrome-btn chrome-btn-primary mt-1">
          {{ isSubmitting ? "Saving..." : "Save Connection" }}
        </button>
      </form>

      <p v-if="feedback" class="mt-3 text-xs text-[var(--chrome-yellow)]">{{ feedback }}</p>
    </section>

    <section class="panel-tight lumdara-scroll min-h-0 overflow-auto p-3">
      <h2 class="font-display text-xl font-semibold tracking-[0.05em] text-[var(--chrome-ink)]">Saved Profiles</h2>

      <div v-if="store.profiles.length === 0" class="chrome-empty mt-3 p-4 text-xs">No saved connections yet.</div>

      <ul v-else class="mt-3 m-0 list-none space-y-2 p-0">
        <li
          v-for="profile in store.profiles"
          :key="profile.id"
          class="flex items-center justify-between border border-[var(--chrome-border)] bg-[#0f141d] px-2.5 py-2"
        >
          <button type="button" class="flex min-w-0 items-center gap-2 text-left" @click="store.setActiveConnection(profile.id)">
            <component
              :is="profile.target.kind === 'desktop-tcp' ? Monitor : Globe2"
              :size="15"
              :class="profile.target.kind === 'desktop-tcp' ? 'text-[var(--chrome-red)]' : 'text-[var(--chrome-yellow)]'"
            />

            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-[var(--chrome-ink)]">{{ profile.name }}</p>
              <p class="truncate text-[11px] uppercase tracking-[0.08em] text-[var(--chrome-ink-muted)]">
                {{ profile.target.kind === "desktop-tcp" ? profile.target.host : profile.target.provider }}
              </p>
            </div>
          </button>

          <div class="flex items-center gap-2">
            <component
              :is="store.activeConnectionId === profile.id ? CheckCircle2 : Circle"
              :size="16"
              :class="store.activeConnectionId === profile.id ? 'text-[var(--chrome-green)]' : 'text-[var(--chrome-ink-muted)]'"
            />

            <button type="button" class="chrome-btn chrome-btn-danger !p-1.5" @click="removeConnection(profile.id)">
              <Trash2 :size="13" />
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
