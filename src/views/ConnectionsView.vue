<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  CheckCircle2,
  FlaskConical,
  Globe2,
  Monitor,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-vue-next";
import {
  deleteConnectionSecret,
  loadConnectionSecret,
  storeConnectionSecret,
} from "../core/secret-vault";
import { getQueryEngine, getRuntimeMode } from "../core/query-engine-service";
import type {
  ConnectionProfile,
  ConnectionSecret,
  ConnectionTarget,
  DbDialect,
} from "../core/types";
import { useConnectionsStore } from "../stores/connections";
import { useVaultStore } from "../stores/vault";

const TEST_CONNECTION_ID = "qwerio-connection-test";

const store = useConnectionsStore();

const feedback = ref("");
const isSubmitting = ref(false);
const isTesting = ref(false);
const runtimeMode = getRuntimeMode();
const isWebRuntime = runtimeMode === "web";
const vaultStore = useVaultStore();
const isModalOpen = ref(false);
const editingConnectionId = ref<string | null>(null);
const editingSecret = ref<ConnectionSecret | null>(null);

const isEditing = computed(() => Boolean(editingConnectionId.value));
const modalTitle = computed(() =>
  isEditing.value ? "Edit Connection" : "New Connection",
);

const form = reactive({
  name: "",
  kind: (isWebRuntime
    ? "web-provider"
    : "desktop-tcp") as ConnectionTarget["kind"],
  dialect: "postgres" as DbDialect,
  host: "",
  port: 5432,
  database: "",
  user: "",
  password: "",
  provider: "neon" as Extract<
    ConnectionTarget,
    { kind: "web-provider" }
  >["provider"],
  neonInputMode: "connection-details" as
    | "connection-details"
    | "connection-string",
  endpoint: "",
  projectId: "",
  connectionString: "",
  providerUsername: "",
  providerPassword: "",
});

function refreshVaultStatus(): void {
  vaultStore.refreshStatus();
}

async function ensureWebVaultUnlockedFor(
  action: "save" | "test",
): Promise<boolean> {
  if (!isWebRuntime) {
    return true;
  }

  refreshVaultStatus();

  if (vaultStore.status.unlocked) {
    return true;
  }

  feedback.value =
    action === "save"
      ? "Unlock the web secret vault before saving web connections."
      : "Unlock the web secret vault before testing web connections.";
  return false;
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
      endpoint: form.endpoint.trim(),
      projectId: form.projectId || undefined,
    };
  }

  return {
    kind: "web-provider",
    dialect: "postgres",
    provider: form.provider,
    endpoint: form.endpoint.trim() || "default",
    projectId: form.projectId || undefined,
  };
}

function toUrlHost(rawHost: string, port: number): string {
  const unwrappedHost = rawHost.trim().replace(/^\[/, "").replace(/\]$/, "");
  const hostSegments = unwrappedHost.split(":");
  const hostWithoutPort =
    hostSegments.length === 2 && /^\d+$/.test(hostSegments[1])
      ? hostSegments[0]
      : unwrappedHost;

  if (hostWithoutPort.includes(":")) {
    return `[${hostWithoutPort}]:${port}`;
  }

  return `${hostWithoutPort}:${port}`;
}

function buildPostgresConnectionStringFromFields(): string | null {
  const host = form.host.trim();
  const database = form.database.trim();
  const user = form.user.trim();
  const port = Number(form.port);

  if (!host || !database || !user) {
    feedback.value =
      "Host, database, and user are required for Neon Postgres details mode.";
    return null;
  }

  if (!Number.isFinite(port) || port <= 0) {
    feedback.value = "Port must be a positive number.";
    return null;
  }

  const url = new URL("postgresql://localhost");
  url.username = user;
  url.password = form.password;
  url.host = toUrlHost(host, port);
  url.pathname = `/${database}`;

  return url.toString();
}

function resolveNeonConnectionString(
  allowExistingSecret = false,
): string | null {
  if (form.neonInputMode === "connection-string") {
    if (form.connectionString.trim()) {
      return form.connectionString.trim();
    }

    if (
      allowExistingSecret &&
      editingSecret.value?.kind === "web-provider" &&
      editingSecret.value.provider === "neon"
    ) {
      return editingSecret.value.connectionString;
    }

    feedback.value = "Neon connection string is required.";
    return null;
  }

  const connectionString = buildPostgresConnectionStringFromFields();

  if (connectionString) {
    return connectionString;
  }

  if (
    allowExistingSecret &&
    editingSecret.value?.kind === "web-provider" &&
    editingSecret.value.provider === "neon"
  ) {
    feedback.value = "";
    return editingSecret.value.connectionString;
  }

  return null;
}

function toConnectionSecret(
  target: ConnectionTarget,
  allowExistingSecret = false,
): ConnectionSecret | null {
  if (target.kind === "desktop-tcp") {
    return {
      kind: "desktop-tcp",
      password: form.password || undefined,
    };
  }

  if (target.provider === "planetscale") {
    if (form.providerUsername && form.providerPassword) {
      return {
        kind: "web-provider",
        provider: "planetscale",
        username: form.providerUsername,
        password: form.providerPassword,
      };
    }

    if (
      allowExistingSecret &&
      editingSecret.value?.kind === "web-provider" &&
      editingSecret.value.provider === "planetscale"
    ) {
      return editingSecret.value;
    }

    feedback.value = "PlanetScale username and password are required.";
    return null;
  }

  const connectionString = resolveNeonConnectionString(allowExistingSecret);

  if (!connectionString) {
    return null;
  }

  return {
    kind: "web-provider",
    provider: target.provider,
    connectionString,
  };
}

function resetForm(): void {
  editingConnectionId.value = null;
  editingSecret.value = null;
  form.name = "";
  form.kind = isWebRuntime ? "web-provider" : "desktop-tcp";
  form.dialect = "postgres";
  form.host = "";
  form.port = 5432;
  form.database = "";
  form.user = "";
  form.password = "";
  form.provider = "neon";
  form.neonInputMode = "connection-details";
  form.endpoint = "";
  form.projectId = "";
  form.connectionString = "";
  form.providerUsername = "";
  form.providerPassword = "";
}

function connectionKindLabel(profile: ConnectionProfile): string {
  return profile.target.kind === "desktop-tcp" ? "Desktop TCP" : "Web Provider";
}

function connectionTargetLabel(profile: ConnectionProfile): string {
  if (profile.target.kind === "desktop-tcp") {
    return `${profile.target.host}:${profile.target.port}/${profile.target.database}`;
  }

  const endpoint = profile.target.endpoint.trim();
  return endpoint
    ? `${profile.target.provider} · ${endpoint}`
    : profile.target.provider;
}

function openNewConnectionModal(): void {
  feedback.value = "";
  resetForm();
  isModalOpen.value = true;
}

function closeConnectionModal(): void {
  if (isSubmitting.value || isTesting.value) {
    return;
  }

  isModalOpen.value = false;
  feedback.value = "";
  resetForm();
}

function hydrateNeonFieldsFromConnectionString(connectionString: string): void {
  try {
    const url = new URL(connectionString);
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

    if (
      !url.hostname ||
      !database ||
      !url.username ||
      !["postgres:", "postgresql:"].includes(url.protocol)
    ) {
      throw new Error("invalid");
    }

    form.neonInputMode = "connection-details";
    form.host = url.hostname;
    form.port = url.port ? Number(url.port) : 5432;
    form.database = database;
    form.user = decodeURIComponent(url.username);
    form.password = decodeURIComponent(url.password);
    form.connectionString = "";
    return;
  } catch {
    form.neonInputMode = "connection-string";
    form.connectionString = connectionString;
    form.host = "";
    form.port = 5432;
    form.database = "";
    form.user = "";
    form.password = "";
  }
}

function hydrateFormFromProfile(
  profile: ConnectionProfile,
  secret: ConnectionSecret | null,
): void {
  form.name = profile.name;
  form.host = "";
  form.port = 5432;
  form.database = "";
  form.user = "";
  form.password = "";
  form.provider = "neon";
  form.neonInputMode = "connection-details";
  form.endpoint = "";
  form.projectId = "";
  form.connectionString = "";
  form.providerUsername = "";
  form.providerPassword = "";

  if (profile.target.kind === "desktop-tcp") {
    form.kind = "desktop-tcp";
    form.dialect = profile.target.dialect;
    form.host = profile.target.host;
    form.port = profile.target.port;
    form.database = profile.target.database;
    form.user = profile.target.user;

    if (secret?.kind === "desktop-tcp") {
      form.password = secret.password ?? "";
    }

    return;
  }

  form.kind = "web-provider";
  form.dialect = profile.target.dialect;
  form.provider = profile.target.provider;
  form.endpoint = profile.target.endpoint;
  form.projectId = profile.target.projectId ?? "";

  if (profile.target.provider === "planetscale") {
    if (secret?.kind === "web-provider" && secret.provider === "planetscale") {
      form.providerUsername = secret.username;
      form.providerPassword = secret.password;
    }

    return;
  }

  if (secret?.kind === "web-provider" && secret.provider === "neon") {
    hydrateNeonFieldsFromConnectionString(secret.connectionString);
  }
}

async function startEditConnection(connectionId: string): Promise<boolean> {
  feedback.value = "";
  const profile = store.profiles.find((item) => item.id === connectionId);

  if (!profile) {
    feedback.value = "Connection profile not found.";
    return false;
  }

  editingConnectionId.value = profile.id;
  editingSecret.value = null;
  hydrateFormFromProfile(profile, null);

  try {
    const secret = await loadConnectionSecret(profile.id);
    editingSecret.value = secret;
    hydrateFormFromProfile(profile, secret);

    if (!secret) {
      feedback.value =
        "No credentials found. Enter credentials and save to restore this profile.";
    }
  } catch (error) {
    feedback.value =
      error instanceof Error
        ? `${error.message} Enter credentials and save to update this profile.`
        : "Unable to load stored credentials. Enter credentials and save to update this profile.";
  }

  return true;
}

async function openEditConnectionModal(connectionId: string): Promise<void> {
  if (!(await startEditConnection(connectionId))) {
    return;
  }

  isModalOpen.value = true;
}

async function testConnection(): Promise<void> {
  feedback.value = "";
  isTesting.value = true;
  let shouldDeleteTestSecret = false;

  try {
    const target = toConnectionTarget();
    const secret = toConnectionSecret(target, isEditing.value);

    if (!secret) {
      return;
    }

    if (
      target.kind === "web-provider" &&
      !(await ensureWebVaultUnlockedFor("test"))
    ) {
      return;
    }

    const now = new Date().toISOString();
    const testProfile: ConnectionProfile = {
      id: TEST_CONNECTION_ID,
      name: form.name.trim() || "Connection Test",
      target,
      createdAt: now,
      updatedAt: now,
    };

    await storeConnectionSecret(TEST_CONNECTION_ID, secret);
    shouldDeleteTestSecret = true;

    const engine = getQueryEngine();
    await engine.connect(testProfile);
    await engine.execute({
      connectionId: TEST_CONNECTION_ID,
      sql: "SELECT 1 AS connection_test",
    });

    feedback.value = "Connection test succeeded.";
  } catch (error) {
    feedback.value =
      error instanceof Error ? error.message : "Connection test failed.";
  } finally {
    if (shouldDeleteTestSecret) {
      try {
        await deleteConnectionSecret(TEST_CONNECTION_ID);
      } catch {
        // Best effort cleanup for temporary test credentials.
      }
    }

    isTesting.value = false;
  }
}

async function submitConnection(): Promise<void> {
  feedback.value = "";
  isSubmitting.value = true;

  try {
    const target = toConnectionTarget();
    const secret = toConnectionSecret(target, isEditing.value);

    if (!secret) {
      return;
    }

    if (
      target.kind === "web-provider" &&
      !(await ensureWebVaultUnlockedFor("save"))
    ) {
      return;
    }

    const editingId = editingConnectionId.value;

    if (editingId) {
      const previousProfile = store.profiles.find(
        (profile) => profile.id === editingId,
      );

      if (!previousProfile) {
        feedback.value = "Connection profile not found.";
        return;
      }

      const rollbackInput = {
        name: previousProfile.name,
        target: previousProfile.target,
      };

      const updateResult = store.updateConnection(editingId, {
        name: form.name,
        target,
      });

      if (!updateResult.ok) {
        feedback.value = updateResult.message;
        return;
      }

      try {
        await storeConnectionSecret(editingId, secret);
      } catch (error) {
        store.updateConnection(editingId, rollbackInput);
        feedback.value =
          error instanceof Error
            ? error.message
            : "Failed to store connection credentials securely.";
        return;
      }

      store.setActiveConnection(editingId);
      feedback.value = "Connection updated with encrypted credentials.";
      isModalOpen.value = false;
      resetForm();
      return;
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
        error instanceof Error
          ? error.message
          : "Failed to store connection credentials securely.";
      return;
    }

    store.setActiveConnection(result.profile.id);
    feedback.value = "Connection saved with encrypted credentials.";
    isModalOpen.value = false;
    resetForm();
  } catch (error) {
    feedback.value =
      error instanceof Error ? error.message : "Unable to save connection.";
  } finally {
    isSubmitting.value = false;
  }
}

async function removeConnection(id: string): Promise<void> {
  feedback.value = "";

  try {
    await deleteConnectionSecret(id);
    store.removeConnection(id);

    if (editingConnectionId.value === id) {
      isModalOpen.value = false;
      resetForm();
    }
  } catch (error) {
    feedback.value =
      error instanceof Error ? error.message : "Unable to remove connection.";
  }
}
</script>

<template>
  <div class="qwerio-scroll min-h-0 flex-1 overflow-auto">
    <section class="panel-tight p-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            class="font-display text-xl font-semibold tracking-[0.05em] text-[var(--chrome-ink)]"
          >
            Connections
          </h2>
          <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
            Runtime mode: {{ runtimeMode }}. Desktop supports direct TCP
            drivers. Web mode uses provider adapters (Neon/wsproxy for Postgres,
            PlanetScale HTTP for MySQL).
          </p>
        </div>

        <span class="chrome-pill">{{ store.profiles.length }} Saved</span>
      </div>

      <p
        v-if="feedback && !isModalOpen"
        class="mt-3 text-xs text-[var(--chrome-yellow)]"
      >
        {{ feedback }}
      </p>

      <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          class="group flex min-h-[168px] flex-col justify-center gap-2 border border-dashed border-[var(--chrome-border-strong)] bg-[rgba(14,18,25,0.7)] px-4 py-5 text-left transition hover:border-[var(--chrome-red)] hover:bg-[rgba(255,82,82,0.08)]"
          :disabled="isSubmitting || isTesting"
          @click="openNewConnectionModal"
        >
          <div
            class="inline-flex h-8 w-8 items-center justify-center border border-[var(--chrome-border-strong)] bg-[#121824] text-[var(--chrome-red)] transition group-hover:border-[var(--chrome-red)]"
          >
            <Plus :size="16" />
          </div>
          <p
            class="font-display text-lg font-semibold tracking-[0.04em] text-[var(--chrome-ink)]"
          >
            Add Connection
          </p>
          <p class="text-xs text-[var(--chrome-ink-dim)]">
            Create a new encrypted connection profile.
          </p>
        </button>

        <article
          v-for="profile in store.profiles"
          :key="profile.id"
          class="flex min-h-[168px] flex-col border border-[var(--chrome-border)] bg-[#0f141d] p-4"
        >
          <div class="flex items-start justify-between gap-2">
            <button
              type="button"
              class="flex min-w-0 items-start gap-2 text-left"
              :disabled="isSubmitting || isTesting"
              @click="store.setActiveConnection(profile.id)"
            >
              <component
                :is="profile.target.kind === 'desktop-tcp' ? Monitor : Globe2"
                :size="15"
                :class="
                  profile.target.kind === 'desktop-tcp'
                    ? 'text-[var(--chrome-red)]'
                    : 'text-[var(--chrome-yellow)]'
                "
              />

              <div class="min-w-0">
                <p
                  class="truncate text-sm font-semibold text-[var(--chrome-ink)]"
                >
                  {{ profile.name }}
                </p>
                <p
                  class="mt-1 truncate text-[11px] uppercase tracking-[0.08em] text-[var(--chrome-ink-muted)]"
                >
                  {{ connectionKindLabel(profile) }}
                </p>
              </div>
            </button>

            <span
              v-if="store.activeConnectionId === profile.id"
              class="chrome-pill chrome-pill-ok"
            >
              <CheckCircle2 :size="12" />
              Active
            </span>
            <span v-else class="chrome-pill">Saved</span>
          </div>

          <p class="mt-3 truncate text-xs text-[var(--chrome-ink-dim)]">
            {{ connectionTargetLabel(profile) }}
          </p>
          <p
            class="mt-1 text-[11px] uppercase tracking-[0.08em] text-[var(--chrome-ink-muted)]"
          >
            {{ profile.target.dialect }}
          </p>

          <div
            class="mt-4 flex flex-wrap gap-2 border-t border-[var(--chrome-border)] pt-3"
          >
            <button
              type="button"
              class="chrome-btn"
              :disabled="
                isSubmitting ||
                isTesting ||
                store.activeConnectionId === profile.id
              "
              @click="store.setActiveConnection(profile.id)"
            >
              {{ store.activeConnectionId === profile.id ? "Active" : "Use" }}
            </button>

            <button
              type="button"
              class="chrome-btn inline-flex items-center gap-1"
              :disabled="isSubmitting || isTesting"
              @click="openEditConnectionModal(profile.id)"
            >
              <Pencil :size="13" />
              Edit
            </button>

            <button
              type="button"
              class="chrome-btn chrome-btn-danger inline-flex items-center gap-1"
              :disabled="isSubmitting || isTesting"
              @click="removeConnection(profile.id)"
            >
              <Trash2 :size="13" />
              Delete
            </button>
          </div>
        </article>
      </div>

      <div
        v-if="store.profiles.length === 0"
        class="chrome-empty mt-3 p-4 text-xs"
      >
        No saved connections yet.
      </div>
    </section>

    <div
      v-if="isModalOpen"
      class="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(7,9,13,0.84)] p-4 backdrop-blur-sm"
      @click="closeConnectionModal"
    >
      <section
        class="panel relative z-[1] w-full max-w-3xl overflow-hidden"
        @click.stop
      >
        <div
          class="chrome-panel-header flex items-start justify-between gap-3 px-4 py-3"
        >
          <div>
            <h3
              class="font-display text-xl font-semibold tracking-[0.05em] text-[var(--chrome-ink)]"
            >
              {{ modalTitle }}
            </h3>
            <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
              Configure credentials and test before saving.
            </p>
          </div>

          <button
            type="button"
            class="chrome-btn !p-1.5"
            :disabled="isSubmitting || isTesting"
            @click="closeConnectionModal"
          >
            <X :size="14" />
          </button>
        </div>

        <div class="qwerio-scroll max-h-[80vh] overflow-auto">
          <form
            class="flex flex-col gap-3 p-4"
            @submit.prevent="submitConnection"
          >
            <p v-if="isEditing" class="text-xs text-[var(--chrome-yellow)]">
              Editing profile. Test and save to apply updates.
            </p>

            <label class="chrome-label">
              <span>Name</span>
              <input
                v-model="form.name"
                class="chrome-input mt-1"
                type="text"
              />
            </label>

            <div class="grid grid-cols-2 gap-3">
              <label class="chrome-label">
                <span>Mode</span>
                <select v-model="form.kind" class="chrome-input mt-1">
                  <option value="desktop-tcp" :disabled="isWebRuntime">
                    Desktop TCP
                  </option>
                  <option value="web-provider">Web Provider</option>
                </select>
              </label>

              <label class="chrome-label">
                <span>Dialect</span>
                <select
                  v-model="form.dialect"
                  :disabled="form.kind === 'web-provider'"
                  class="chrome-input mt-1"
                >
                  <option value="postgres">Postgres</option>
                  <option value="mysql">MySQL</option>
                </select>
              </label>
            </div>

            <template v-if="form.kind === 'desktop-tcp'">
              <label class="chrome-label">
                <span>Host</span>
                <input
                  v-model="form.host"
                  class="chrome-input mt-1"
                  type="text"
                />
              </label>

              <div class="grid grid-cols-2 gap-3">
                <label class="chrome-label">
                  <span>Port</span>
                  <input
                    v-model.number="form.port"
                    class="chrome-input mt-1"
                    type="number"
                  />
                </label>

                <label class="chrome-label">
                  <span>Database</span>
                  <input
                    v-model="form.database"
                    class="chrome-input mt-1"
                    type="text"
                  />
                </label>
              </div>

              <label class="chrome-label">
                <span>User</span>
                <input
                  v-model="form.user"
                  class="chrome-input mt-1"
                  type="text"
                />
              </label>

              <label class="chrome-label">
                <span>Password (optional)</span>
                <input
                  v-model="form.password"
                  class="chrome-input mt-1"
                  type="password"
                />
              </label>
            </template>

            <template v-else>
              <label class="chrome-label">
                <span>Provider</span>
                <select v-model="form.provider" class="chrome-input mt-1">
                  <option value="neon">
                    Neon Serverless (Postgres via wsproxy)
                  </option>
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
                    <input
                      v-model="form.providerUsername"
                      class="chrome-input mt-1"
                      type="text"
                    />
                  </label>

                  <label class="chrome-label">
                    <span>Password</span>
                    <input
                      v-model="form.providerPassword"
                      class="chrome-input mt-1"
                      type="password"
                    />
                  </label>
                </div>
              </template>

              <template v-else>
                <label class="chrome-label">
                  <span>WebSocket Proxy Endpoint (optional)</span>
                  <input
                    v-model="form.endpoint"
                    class="chrome-input mt-1"
                    type="text"
                    placeholder="localhost:6543/v1"
                  />
                </label>

                <p class="mt-1 text-[11px] text-[var(--chrome-ink-dim)]">
                  For local Postgres in browser mode, run wsproxy and set it
                  here (for example `localhost:6543/v1`).
                </p>

                <label class="chrome-label">
                  <span>Postgres Input Mode</span>
                  <select
                    v-model="form.neonInputMode"
                    class="chrome-input mt-1"
                  >
                    <option value="connection-details">Separate Fields</option>
                    <option value="connection-string">Connection String</option>
                  </select>
                </label>

                <template v-if="form.neonInputMode === 'connection-details'">
                  <label class="chrome-label">
                    <span>Host</span>
                    <input
                      v-model="form.host"
                      class="chrome-input mt-1"
                      type="text"
                      placeholder="localhost"
                    />
                  </label>

                  <div class="grid grid-cols-2 gap-3">
                    <label class="chrome-label">
                      <span>Port</span>
                      <input
                        v-model.number="form.port"
                        class="chrome-input mt-1"
                        type="number"
                      />
                    </label>

                    <label class="chrome-label">
                      <span>Database</span>
                      <input
                        v-model="form.database"
                        class="chrome-input mt-1"
                        type="text"
                      />
                    </label>
                  </div>

                  <label class="chrome-label">
                    <span>User</span>
                    <input
                      v-model="form.user"
                      class="chrome-input mt-1"
                      type="text"
                    />
                  </label>

                  <label class="chrome-label">
                    <span>Password (optional)</span>
                    <input
                      v-model="form.password"
                      class="chrome-input mt-1"
                      type="password"
                    />
                  </label>
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
            </template>

            <div class="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                class="chrome-btn inline-flex items-center gap-1"
                :disabled="isSubmitting || isTesting"
                @click="testConnection"
              >
                <FlaskConical :size="12" />
                {{ isTesting ? "Testing..." : "Test Connection" }}
              </button>

              <button
                type="submit"
                :disabled="isSubmitting || isTesting"
                class="chrome-btn chrome-btn-primary"
              >
                {{
                  isSubmitting
                    ? isEditing
                      ? "Updating..."
                      : "Saving..."
                    : isEditing
                      ? "Update Connection"
                      : "Save Connection"
                }}
              </button>

              <button
                type="button"
                class="chrome-btn"
                :disabled="isSubmitting || isTesting"
                @click="closeConnectionModal"
              >
                Cancel
              </button>
            </div>

            <p v-if="feedback" class="mt-1 text-xs text-[var(--chrome-yellow)]">
              {{ feedback }}
            </p>
          </form>
        </div>
      </section>
    </div>
  </div>
</template>
