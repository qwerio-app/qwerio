<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
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
import { useRoute, useRouter } from "vue-router";
import { clearSessionConnectionPassword } from "../core/connection-secrets";
import { toErrorMessage } from "../core/error-message";
import { getQueryEngine, getRuntimeMode } from "../core/query-engine-service";
import {
  encryptConnectionPassword,
  SecretPinRequiredError,
} from "../core/secret-vault";
import type {
  ConnectionCredentials,
  ConnectionProfile,
  ConnectionProfileType,
  ConnectionTarget,
  DbDialect,
} from "../core/types";
import { useConnectionSyncStore } from "../stores/connection-sync";
import { useConnectionsStore } from "../stores/connections";
import { useVaultStore } from "../stores/vault";

const TEST_CONNECTION_ID = "qwerio-connection-test";

type PasswordStorageMode = "none" | "plain" | "encrypted";

type TargetWithPassword = {
  target: ConnectionTarget;
  password?: string;
};

const store = useConnectionsStore();
const connectionSyncStore = useConnectionSyncStore();
const vaultStore = useVaultStore();
const route = useRoute();
const router = useRouter();

const feedback = ref("");
const isSubmitting = ref(false);
const isTesting = ref(false);
const runtimeMode = getRuntimeMode();
const isWebRuntime = runtimeMode === "web";
const isModalOpen = ref(false);
const editingConnectionId = ref<string | null>(null);

const isEditing = computed(() => Boolean(editingConnectionId.value));
const editingProfile = computed<ConnectionProfile | null>(() => {
  if (!editingConnectionId.value) {
    return null;
  }

  return (
    store.profiles.find(
      (profile) => profile.id === editingConnectionId.value,
    ) ?? null
  );
});
const modalTitle = computed(() =>
  isEditing.value ? "Edit Connection" : "New Connection",
);
const DESKTOP_DEFAULT_PORTS: Record<DbDialect, number> = {
  postgres: 5432,
  mysql: 3306,
  sqlserver: 1433,
  sqlite: 0,
  redis: 6379,
  mongodb: 27017,
};
const DIALECT_LABELS: Record<DbDialect, string> = {
  postgres: "Postgres",
  mysql: "MySQL",
  sqlserver: "SQL Server",
  sqlite: "SQLite",
  redis: "Redis",
  mongodb: "MongoDB",
};

const form = reactive({
  name: "",
  connectionType: "personal" as ConnectionProfileType,
  showInternalSchemas: false,
  passwordStorage: "encrypted" as PasswordStorageMode,
  dialect: "postgres" as DbDialect,
  host: "",
  port: DESKTOP_DEFAULT_PORTS.postgres,
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
});

const sections = computed(() => {
  const personalProfiles = store.profiles.filter(
    (profile) => profile.type === "personal",
  );
  const teamProfiles = store.profiles.filter(
    (profile) => profile.type === "team",
  );

  return [
    {
      id: "personal",
      label: "Personal",
      profiles: personalProfiles,
    },
    {
      id: "team",
      label: "Team",
      profiles: teamProfiles,
    },
  ].filter((section) => section.profiles.length > 0);
});

const isDesktopSqlite = computed(
  () => !isWebRuntime && form.dialect === "sqlite",
);

const webDialectLabel = computed(() => {
  if (form.provider === "planetscale") {
    return "mysql";
  }

  if (form.provider === "redis-proxy") {
    return "redis";
  }

  if (form.provider === "mongo-proxy") {
    return "mongodb";
  }

  return "postgres";
});

const shouldShowPasswordStorage = computed(() => {
  if (isDesktopSqlite.value) {
    return false;
  }

  return true;
});

const needsCredentialUpgrade = computed(
  () => connectionSyncStore.upgradeRequiredConnectionIds.length > 0,
);

const pendingServerImportCount = computed(
  () => connectionSyncStore.pendingServerConnections.length,
);

const upgradeConnectionNames = computed(() =>
  connectionSyncStore.upgradeRequiredConnectionIds
    .map(
      (connectionId) =>
        store.profiles.find((profile) => profile.id === connectionId)?.name ??
        connectionId,
    )
    .join(", "),
);

watch(
  () => form.dialect,
  (nextDialect, previousDialect) => {
    if (isWebRuntime) {
      return;
    }

    if (nextDialect === "sqlite") {
      form.port = 0;
      return;
    }

    const previousDefault =
      previousDialect && previousDialect in DESKTOP_DEFAULT_PORTS
        ? DESKTOP_DEFAULT_PORTS[previousDialect]
        : null;

    if (
      form.port <= 0 ||
      !Number.isFinite(form.port) ||
      (previousDefault !== null && form.port === previousDefault)
    ) {
      form.port = DESKTOP_DEFAULT_PORTS[nextDialect];
    }
  },
);

function connectionTargetLabel(profile: ConnectionProfile): string {
  if (profile.target.kind === "desktop-tcp") {
    if (profile.target.dialect === "sqlite") {
      return profile.target.database;
    }

    return `${profile.target.host}:${profile.target.port}/${profile.target.database}`;
  }

  if (profile.target.provider === "planetscale") {
    return `${profile.target.provider} · ${profile.target.endpoint} · ${profile.target.username}`;
  }

  if (
    profile.target.provider === "redis-proxy" ||
    profile.target.provider === "mongo-proxy"
  ) {
    return `${profile.target.provider} · ${profile.target.endpoint} · ${profile.target.host}:${profile.target.port}/${profile.target.database}`;
  }

  return `${profile.target.provider} · ${profile.target.endpoint}`;
}

function formatDialectLabel(dialect: DbDialect): string {
  const label = DIALECT_LABELS[dialect];

  if (dialect === "redis" || dialect === "mongodb") {
    return `${label} (BETA)`;
  }

  return label;
}

function connectionCredentialLabel(profile: ConnectionProfile): string {
  switch (profile.credentials.storage) {
    case "encrypted":
      return "Encrypted password";
    case "plain":
      return "Plain-text password";
    case "none":
      return "No saved password";
    default: {
      const exhaustiveCheck: never = profile.credentials;
      return JSON.stringify(exhaustiveCheck);
    }
  }
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

function parsePostgresConnectionStringTemplate(
  rawConnectionString: string,
): { template: string; password?: string } | null {
  let url: URL;

  try {
    url = new URL(rawConnectionString.trim());
  } catch {
    feedback.value = "Postgres connection string is invalid.";
    return null;
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    feedback.value =
      "Postgres connection string must start with postgres:// or postgresql://.";
    return null;
  }

  if (!url.hostname || !url.username || !url.pathname.replace(/^\/+/, "")) {
    feedback.value =
      "Postgres connection string must include host, username, and database.";
    return null;
  }

  const extractedPassword = decodeURIComponent(url.password || "");
  url.password = "";

  return {
    template: url.toString(),
    password: extractedPassword || undefined,
  };
}

function buildPostgresConnectionTemplateFromFields(): {
  template: string;
  password?: string;
} | null {
  const host = form.host.trim();
  const database = form.database.trim();
  const user = form.user.trim();
  const port = Number(form.port);

  if (!host || !database || !user) {
    feedback.value =
      "Host, database, and user are required for Postgres details mode.";
    return null;
  }

  if (!Number.isFinite(port) || port <= 0) {
    feedback.value = "Port must be a positive number.";
    return null;
  }

  const url = new URL("postgresql://localhost");
  url.username = user;
  url.password = "";
  url.host = toUrlHost(host, port);
  url.pathname = `/${database}`;

  return {
    template: url.toString(),
    password: form.password || undefined,
  };
}

function resolvePostgresTemplateAndPassword(): {
  template: string;
  password?: string;
} | null {
  if (form.neonInputMode === "connection-string") {
    if (!form.connectionString.trim()) {
      feedback.value = "Postgres connection string is required.";
      return null;
    }

    const parsed = parsePostgresConnectionStringTemplate(form.connectionString);

    if (!parsed) {
      return null;
    }

    return {
      template: parsed.template,
      password: form.password || parsed.password,
    };
  }

  return buildPostgresConnectionTemplateFromFields();
}

function toConnectionTargetAndPassword(): TargetWithPassword | null {
  if (!isWebRuntime) {
    if (form.dialect === "sqlite") {
      return {
        target: {
          kind: "desktop-tcp",
          dialect: "sqlite",
          database: form.database.trim(),
        },
      };
    }

    if (form.dialect === "redis" || form.dialect === "mongodb") {
      return {
        target: {
          kind: "desktop-tcp",
          dialect: form.dialect,
          host: form.host.trim(),
          port: Number(form.port),
          database: form.database.trim(),
          ...(form.user.trim().length > 0
            ? { user: form.user.trim() }
            : {}),
        },
        password: form.password || undefined,
      };
    }

    return {
      target: {
        kind: "desktop-tcp",
        dialect: form.dialect,
        host: form.host.trim(),
        port: Number(form.port),
        database: form.database.trim(),
        user: form.user.trim(),
      },
      password: form.password || undefined,
    };
  }

  if (form.provider === "planetscale") {
    if (!form.providerUsername.trim()) {
      feedback.value = "PlanetScale username is required.";
      return null;
    }

    return {
      target: {
        kind: "web-provider",
        dialect: "mysql",
        provider: "planetscale",
        endpoint: form.endpoint.trim(),
        username: form.providerUsername.trim(),
        projectId: form.projectId || undefined,
      },
      password: form.password || undefined,
    };
  }

  if (form.provider === "redis-proxy" || form.provider === "mongo-proxy") {
    const host = form.host.trim();
    const port = Number(form.port);
    const database = form.database.trim();

    if (!host || !database) {
      feedback.value = "Host and database are required for this provider.";
      return null;
    }

    if (!Number.isFinite(port) || port <= 0) {
      feedback.value = "Port must be a positive number.";
      return null;
    }

    return {
      target:
        form.provider === "redis-proxy"
          ? {
              kind: "web-provider",
              dialect: "redis",
              provider: "redis-proxy",
              endpoint: form.endpoint.trim() || "default",
              host,
              port,
              database,
              ...(form.user.trim().length > 0
                ? { user: form.user.trim() }
                : {}),
              projectId: form.projectId || undefined,
            }
          : {
              kind: "web-provider",
              dialect: "mongodb",
              provider: "mongo-proxy",
              endpoint: form.endpoint.trim() || "default",
              host,
              port,
              database,
              ...(form.user.trim().length > 0
                ? { user: form.user.trim() }
                : {}),
              projectId: form.projectId || undefined,
            },
      password: form.password || undefined,
    };
  }

  const postgres = resolvePostgresTemplateAndPassword();

  if (!postgres) {
    return null;
  }

  return {
    target: {
      kind: "web-provider",
      dialect: "postgres",
      provider: form.provider,
      endpoint:
        form.provider === "proxy"
          ? form.endpoint.trim() || "default"
          : "default",
      connectionStringTemplate: postgres.template,
      projectId: form.projectId || undefined,
    },
    password: postgres.password,
  };
}

async function ensurePinUnlockedFor(action: "save" | "test"): Promise<boolean> {
  await vaultStore.refreshStatus();

  if (vaultStore.status.unlocked) {
    return true;
  }

  vaultStore.requestUnlockPrompt();
  feedback.value = vaultStore.status.initialized
    ? action === "save"
      ? "Unlock your 5-digit PIN before saving an encrypted password."
      : "Unlock your 5-digit PIN before testing with an encrypted password."
    : action === "save"
      ? "Create a 5-digit PIN before saving an encrypted password."
      : "Create a 5-digit PIN before testing with an encrypted password.";

  return false;
}

async function resolveCredentials(
  passwordInput: string | undefined,
  supportsPassword: boolean,
  action: "save" | "test",
): Promise<ConnectionCredentials | null> {
  if (!supportsPassword) {
    return {
      storage: "none",
    };
  }

  const existingCredentials = editingProfile.value?.credentials ?? null;
  const hasPasswordInput =
    typeof passwordInput === "string" && passwordInput.length > 0;

  if (!hasPasswordInput) {
    if (
      existingCredentials &&
      existingCredentials.storage === form.passwordStorage &&
      form.passwordStorage !== "none"
    ) {
      return existingCredentials;
    }

    return {
      storage: "none",
    };
  }

  if (form.passwordStorage === "none") {
    return {
      storage: "none",
    };
  }

  if (form.passwordStorage === "plain") {
    return {
      storage: "plain",
      password: passwordInput,
    };
  }

  if (!(await ensurePinUnlockedFor(action))) {
    return null;
  }

  return {
    storage: "encrypted",
    envelope: await encryptConnectionPassword(passwordInput),
  };
}

function resetForm(): void {
  editingConnectionId.value = null;
  form.name = "";
  form.connectionType = "personal";
  form.showInternalSchemas = false;
  form.passwordStorage = "encrypted";
  form.dialect = "postgres";
  form.host = "";
  form.port = DESKTOP_DEFAULT_PORTS.postgres;
  form.database = "";
  form.user = "";
  form.password = "";
  form.provider = "neon";
  form.neonInputMode = "connection-details";
  form.endpoint = "";
  form.projectId = "";
  form.connectionString = "";
  form.providerUsername = "";
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

function hydrateNeonFieldsFromConnectionStringTemplate(
  connectionStringTemplate: string,
): void {
  try {
    const url = new URL(connectionStringTemplate);
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
    form.connectionString = "";
    return;
  } catch {
    form.neonInputMode = "connection-string";
    form.connectionString = connectionStringTemplate;
    form.host = "";
    form.port = DESKTOP_DEFAULT_PORTS.postgres;
    form.database = "";
    form.user = "";
  }
}

function hydrateFormFromProfile(profile: ConnectionProfile): void {
  form.name = profile.name;
  form.connectionType = profile.type;
  form.showInternalSchemas = Boolean(profile.showInternalSchemas);
  form.passwordStorage = profile.credentials.storage;
  form.host = "";
  form.port = DESKTOP_DEFAULT_PORTS.postgres;
  form.database = "";
  form.user = "";
  form.password =
    profile.credentials.storage === "plain" ? profile.credentials.password : "";
  form.provider = "neon";
  form.neonInputMode = "connection-details";
  form.endpoint = "";
  form.projectId = "";
  form.connectionString = "";
  form.providerUsername = "";

  if (profile.target.kind === "desktop-tcp") {
    form.dialect = profile.target.dialect;
    form.database = profile.target.database;

    if (profile.target.dialect === "sqlite") {
      form.host = "";
      form.port = DESKTOP_DEFAULT_PORTS.sqlite;
      form.user = "";
    } else {
      form.host = profile.target.host;
      form.port = profile.target.port;
      form.user = profile.target.user ?? "";
    }

    return;
  }

  form.dialect = profile.target.dialect;
  form.provider = profile.target.provider;
  form.endpoint = profile.target.endpoint;
  form.projectId = profile.target.projectId ?? "";

  if (profile.target.provider === "planetscale") {
    form.providerUsername = profile.target.username;
    return;
  }

  if (
    profile.target.provider === "redis-proxy" ||
    profile.target.provider === "mongo-proxy"
  ) {
    form.host = profile.target.host;
    form.port = profile.target.port;
    form.database = profile.target.database;
    form.user = profile.target.user ?? "";
    form.neonInputMode = "connection-details";
    return;
  }

  hydrateNeonFieldsFromConnectionStringTemplate(
    profile.target.connectionStringTemplate,
  );
}

function openEditConnectionModal(connectionId: string): void {
  feedback.value = "";
  const profile = store.profiles.find((item) => item.id === connectionId);

  if (!profile) {
    feedback.value = "Connection profile not found.";
    return;
  }

  editingConnectionId.value = profile.id;
  hydrateFormFromProfile(profile);
  isModalOpen.value = true;
}

async function testConnection(): Promise<void> {
  feedback.value = "";
  isTesting.value = true;

  try {
    const targetWithPassword = toConnectionTargetAndPassword();

    if (!targetWithPassword) {
      return;
    }

    const credentials = await resolveCredentials(
      targetWithPassword.password,
      !(
        targetWithPassword.target.kind === "desktop-tcp" &&
        targetWithPassword.target.dialect === "sqlite"
      ),
      "test",
    );

    if (!credentials) {
      return;
    }

    const now = new Date().toISOString();
    const testProfile: ConnectionProfile = {
      id: TEST_CONNECTION_ID,
      name: form.name.trim() || "Connection Test",
      type: form.connectionType,
      target: targetWithPassword.target,
      credentials,
      showInternalSchemas: Boolean(form.showInternalSchemas),
      createdAt: now,
      updatedAt: now,
    };

    const engine = getQueryEngine();
    await engine.connect(testProfile);
    const testCommand =
      testProfile.target.dialect === "redis"
        ? "PING"
        : testProfile.target.dialect === "mongodb"
          ? JSON.stringify({
              op: "command",
              database: testProfile.target.database,
              command: { ping: 1 },
            })
          : "SELECT 1 AS connection_test";
    await engine.execute({
      connectionId: TEST_CONNECTION_ID,
      sql: testCommand,
    });

    feedback.value = "Connection test succeeded.";
  } catch (error) {
    if (error instanceof SecretPinRequiredError) {
      vaultStore.requestUnlockPrompt(error.envelope);
    }

    feedback.value = toErrorMessage(error, "Connection test failed.");
  } finally {
    isTesting.value = false;
  }
}

async function submitConnection(): Promise<void> {
  feedback.value = "";
  isSubmitting.value = true;

  try {
    const targetWithPassword = toConnectionTargetAndPassword();

    if (!targetWithPassword) {
      return;
    }

    const credentials = await resolveCredentials(
      targetWithPassword.password,
      !(
        targetWithPassword.target.kind === "desktop-tcp" &&
        targetWithPassword.target.dialect === "sqlite"
      ),
      "save",
    );

    if (!credentials) {
      return;
    }

    const editingId = editingConnectionId.value;

    if (editingId) {
      const updateResult = store.updateConnection(editingId, {
        name: form.name,
        type: form.connectionType,
        target: targetWithPassword.target,
        credentials,
        showInternalSchemas: form.showInternalSchemas,
      });

      if (!updateResult.ok) {
        feedback.value = updateResult.message;
        return;
      }

      clearSessionConnectionPassword(editingId);
      store.setActiveConnection(editingId);
      feedback.value = "Connection updated.";
      isModalOpen.value = false;
      resetForm();
      return;
    }

    const result = store.addConnection({
      name: form.name,
      type: form.connectionType,
      target: targetWithPassword.target,
      credentials,
      showInternalSchemas: form.showInternalSchemas,
    });

    if (!result.ok) {
      feedback.value = result.message;
      return;
    }

    clearSessionConnectionPassword(result.profile.id);
    store.setActiveConnection(result.profile.id);
    feedback.value = "Connection saved.";
    isModalOpen.value = false;
    resetForm();
  } catch (error) {
    if (error instanceof SecretPinRequiredError) {
      vaultStore.requestUnlockPrompt(error.envelope);
    }

    feedback.value = toErrorMessage(error, "Unable to save connection.");
  } finally {
    isSubmitting.value = false;
  }
}

async function removeConnection(id: string): Promise<void> {
  feedback.value = "";
  const profile = store.profiles.find((entry) => entry.id === id);

  if (profile) {
    await connectionSyncStore.queueDeletionForConnection(profile);
  }

  store.removeConnection(id);
  clearSessionConnectionPassword(id);

  if (editingConnectionId.value === id) {
    isModalOpen.value = false;
    resetForm();
  }
}

async function syncConnectionsNow(): Promise<void> {
  feedback.value = "";
  await connectionSyncStore.syncNow();
}

async function handleConnectionSyncToggle(
  profile: ConnectionProfile,
  event: Event,
): Promise<void> {
  const target = event.target as HTMLInputElement | null;
  const enabled = Boolean(target?.checked);
  await connectionSyncStore.setConnectionSyncEnabled(profile.id, enabled);
}

function openFirstUpgradeConnection(): void {
  const firstConnectionId = connectionSyncStore.upgradeRequiredConnectionIds[0];

  if (!firstConnectionId) {
    return;
  }

  openEditConnectionModal(firstConnectionId);
}

function importAllServerConnections(): void {
  const imported = connectionSyncStore.importServerConnections();

  if (imported > 0) {
    feedback.value = `${imported} server connection${imported === 1 ? "" : "s"} imported locally.`;
  }
}

function consumeTeamCreatedMessage(): void {
  if (route.query.teamCreated !== "1") {
    return;
  }

  const teamName =
    typeof route.query.teamName === "string" &&
    route.query.teamName.trim().length > 0
      ? route.query.teamName.trim()
      : "Team";

  feedback.value = `${teamName} created successfully.`;

  const nextQuery = {
    ...route.query,
  };

  delete nextQuery.teamCreated;
  delete nextQuery.teamName;

  void router.replace({
    path: route.path,
    query: nextQuery,
  });
}

onMounted(() => {
  consumeTeamCreatedMessage();
});
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
            Runtime mode: {{ runtimeMode }}. Desktop supports direct TCP drivers
            for Postgres, MySQL, and SQL Server plus local SQLite files. Web
            mode uses provider adapters (Neon Serverless, WebSocket Proxy for
            Postgres, PlanetScale HTTP for MySQL). Redis and MongoDB support is
            currently BETA.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 border border-[var(--chrome-border)] bg-[#0f141d] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--chrome-ink)] transition-colors duration-200 hover:border-[var(--chrome-yellow)]"
            :disabled="isSubmitting || isTesting || connectionSyncStore.isSyncing"
            @click="syncConnectionsNow"
          >
            <FlaskConical :size="13" class="text-[var(--chrome-yellow)]" />
            {{ connectionSyncStore.isSyncing ? "Syncing..." : "Sync now" }}
          </button>

          <button
            type="button"
            class="inline-flex items-center gap-1.5 border border-[var(--chrome-border)] bg-[#0f141d] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--chrome-ink)] transition-colors duration-200 hover:border-[var(--chrome-red)]"
            :disabled="isSubmitting || isTesting"
            @click="openNewConnectionModal"
          >
            <Plus :size="13" class="text-[var(--chrome-red)]" />
            New connection
          </button>
        </div>
      </div>

      <p
        v-if="feedback && !isModalOpen"
        class="mt-3 text-xs text-[var(--chrome-yellow)]"
      >
        {{ feedback }}
      </p>
      <p
        v-if="connectionSyncStore.syncError"
        class="mt-2 text-xs text-[var(--chrome-red)]"
      >
        {{ connectionSyncStore.syncError }}
      </p>
      <p
        v-if="connectionSyncStore.syncMessage"
        class="mt-2 text-xs text-[var(--chrome-ink-dim)]"
      >
        {{ connectionSyncStore.syncMessage }}
      </p>
      <p
        v-if="!connectionSyncStore.isAuthenticated"
        class="mt-2 text-xs text-[var(--chrome-ink-dim)]"
      >
        Sign in and keep a premium subscription active to sync connections.
      </p>
      <p
        v-else-if="!connectionSyncStore.isPremiumEligible"
        class="mt-2 text-xs text-[var(--chrome-ink-dim)]"
      >
        Connection sync requires an active or trialing premium subscription.
      </p>

      <div
        v-if="needsCredentialUpgrade"
        class="mt-3 flex flex-wrap items-center gap-2 border border-[var(--chrome-border)] bg-[#0f141d] px-3 py-2"
      >
        <p class="text-xs text-[var(--chrome-yellow)]">
          Upgrade plaintext password connections before sync: {{ upgradeConnectionNames }}
        </p>
        <button
          type="button"
          class="chrome-btn"
          :disabled="isSubmitting || isTesting"
          @click="openFirstUpgradeConnection"
        >
          Upgrade now
        </button>
      </div>

      <div
        v-if="pendingServerImportCount > 0"
        class="mt-3 flex flex-wrap items-center gap-2 border border-[var(--chrome-border)] bg-[#0f141d] px-3 py-2"
      >
        <p class="text-xs text-[var(--chrome-ink)]">
          {{ pendingServerImportCount }} synced server connection{{
            pendingServerImportCount === 1 ? "" : "s"
          }} can be imported on this device.
        </p>
        <button
          type="button"
          class="chrome-btn"
          :disabled="isSubmitting || isTesting"
          @click="importAllServerConnections"
        >
          Import all
        </button>
      </div>

      <section
        v-for="(section, sectionIndex) in sections"
        :key="section.id"
        class="mt-4"
      >
        <h3
          class="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--chrome-ink-dim)]"
        >
          {{ section.label }}
        </h3>

        <div
          class="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          <article
            v-for="profile in section.profiles"
            :key="profile.id"
            class="flex min-h-[176px] flex-col border border-[var(--chrome-border)] bg-[#0f141d] p-4"
          >
            <div class="flex items-start justify-between gap-2">
              <button
                type="button"
                class="flex min-w-0 items-center gap-2 text-left"
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
              {{ formatDialectLabel(profile.target.dialect) }}
            </p>
            <p class="mt-1 text-[11px] text-[var(--chrome-ink-muted)]">
              {{ connectionCredentialLabel(profile) }}
            </p>
            <label class="mt-2 inline-flex items-center gap-1.5 text-[11px] text-[var(--chrome-ink-dim)]">
              <input
                type="checkbox"
                class="size-3.5 accent-[var(--chrome-yellow)]"
                :checked="Boolean(profile.sync?.enabled)"
                :disabled="isSubmitting || isTesting || connectionSyncStore.isSyncing"
                @change="handleConnectionSyncToggle(profile, $event)"
              />
              Sync this connection
            </label>
            <p class="mt-1 text-[11px] text-[var(--chrome-ink-muted)]">
              {{
                profile.sync?.enabled
                  ? profile.sync?.serverId
                    ? "Synced with cloud"
                    : "Sync enabled (pending first upload)"
                  : "Local only"
              }}
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

          <button
            v-if="sectionIndex === sections.length - 1"
            type="button"
            class="group relative flex min-h-[176px] flex-col justify-start border border-[var(--chrome-border)] bg-[#0f141d] p-4 text-left transition-colors duration-200 hover:border-[var(--chrome-red)]"
            :disabled="isSubmitting || isTesting"
            @click="openNewConnectionModal"
          >
            <span
              class="inline-flex size-10 items-center justify-center border border-[var(--chrome-border)] bg-[rgba(255,255,255,0.03)] text-[var(--chrome-red)] transition-colors duration-200 group-hover:border-[var(--chrome-red)]"
            >
              <Plus :size="16" />
            </span>

            <div class="mt-4">
              <p class="text-sm font-semibold text-[var(--chrome-ink)]">
                New connection
              </p>
              <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
                Configure a new connection.
              </p>
            </div>
          </button>
        </div>
      </section>

      <div
        v-if="store.profiles.length === 0"
        class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        <button
          type="button"
          class="group relative flex min-h-[176px] flex-col justify-between border border-[var(--chrome-border)] bg-[#0f141d] p-4 text-left transition-colors duration-200 hover:border-[var(--chrome-red)]"
          :disabled="isSubmitting || isTesting"
          @click="openNewConnectionModal"
        >
          <span
            class="inline-flex size-10 items-center justify-center border border-[var(--chrome-border)] bg-[rgba(255,255,255,0.03)] text-[var(--chrome-red)] transition-colors duration-200 group-hover:border-[var(--chrome-red)]"
          >
            <Plus :size="16" />
          </span>

          <div class="mt-4">
            <p class="text-sm font-semibold text-[var(--chrome-ink)]">
              New connection
            </p>
            <p class="mt-1 text-xs text-[var(--chrome-ink-dim)]">
              No saved connections yet. Create your first profile.
            </p>
          </div>

          <span
            class="mt-4 inline-flex w-fit items-center border border-[var(--chrome-border)] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--chrome-ink-dim)] transition-colors duration-200 group-hover:border-[var(--chrome-red)] group-hover:text-[var(--chrome-ink)]"
          >
            Create
          </span>
        </button>
      </div>
    </section>

    <div
      v-if="isModalOpen"
      class="fixed inset-0 z-[110] flex items-center justify-center bg-[rgba(7,9,13,0.84)] p-4 backdrop-blur-sm"
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
              Configure profile type, connection settings, and password storage.
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
            <div class="grid grid-cols-2 gap-3">
              <label class="chrome-label">
                <span>Connection Name</span>
                <input
                  v-model="form.name"
                  class="chrome-input mt-1"
                  type="text"
                />
              </label>

              <label class="chrome-label">
                <span>Connection Type</span>
                <select v-model="form.connectionType" class="chrome-input mt-1">
                  <option value="personal">Personal</option>
                  <option value="team">Team</option>
                </select>
              </label>
            </div>

            <div v-if="isWebRuntime" class="grid grid-cols-2 gap-3">
              <label class="chrome-label">
                <span>Dialect</span>
                <select
                  :value="webDialectLabel"
                  disabled
                  class="chrome-input mt-1"
                >
                  <option value="postgres">Postgres</option>
                  <option value="mysql">MySQL</option>
                  <option value="redis">Redis (BETA)</option>
                  <option value="mongodb">MongoDB (BETA)</option>
                </select>
              </label>

              <label class="chrome-label">
                <span>Provider</span>
                <select v-model="form.provider" class="chrome-input mt-1">
                  <option value="neon">Neon Serverless (Postgres)</option>
                  <option value="proxy">Postgres (via WS proxy)</option>
                  <option value="planetscale">PlanetScale (MySQL HTTP)</option>
                  <option value="redis-proxy">Redis (via proxy, BETA)</option>
                  <option value="mongo-proxy">MongoDB (via proxy, BETA)</option>
                </select>
              </label>
            </div>

            <label v-else class="chrome-label">
              <span>Dialect</span>
              <select v-model="form.dialect" class="chrome-input mt-1">
                <option value="postgres">Postgres</option>
                <option value="mysql">MySQL</option>
                <option value="sqlserver">SQL Server</option>
                <option value="sqlite">SQLite</option>
                <option value="redis">Redis (BETA)</option>
                <option value="mongodb">MongoDB (BETA)</option>
              </select>
            </label>

            <template v-if="!isWebRuntime">
              <template v-if="isDesktopSqlite">
                <label class="chrome-label">
                  <span>SQLite Database Path</span>
                  <input
                    v-model="form.database"
                    class="chrome-input mt-1"
                    type="text"
                    placeholder="/absolute/path/to/app.db or :memory:"
                  />
                </label>

                <p class="mt-1 text-[11px] text-[var(--chrome-ink-dim)]">
                  SQLite uses a local file path in desktop mode.
                </p>
              </template>

              <template v-else>
                <div class="grid grid-cols-2 gap-3">
                  <label class="chrome-label">
                    <span>Hostname</span>
                    <input
                      v-model="form.host"
                      class="chrome-input mt-1"
                      type="text"
                    />
                  </label>

                  <label class="chrome-label">
                    <span>Port</span>
                    <input
                      v-model.number="form.port"
                      class="chrome-input mt-1"
                      type="number"
                    />
                  </label>
                </div>

                <label class="chrome-label">
                  <span>Database</span>
                  <input
                    v-model="form.database"
                    class="chrome-input mt-1"
                    type="text"
                  />
                </label>

                <div class="grid grid-cols-2 gap-3">
                  <label class="chrome-label">
                    <span>Username</span>
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
                </div>
              </template>

              <label class="flex items-center justify-end gap-1.5">
                <span class="text-[11px] text-[var(--chrome-ink-dim)]">
                  Show internal and system schemas
                </span>
                <input
                  v-model="form.showInternalSchemas"
                  type="checkbox"
                  class="size-4 accent-[var(--chrome-red)]"
                />
              </label>
            </template>

            <template v-else>
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
                    <span>Password (optional)</span>
                    <input
                      v-model="form.password"
                      class="chrome-input mt-1"
                      type="password"
                    />
                  </label>
                </div>

                <label class="flex items-center justify-end gap-1.5">
                  <span class="text-[11px] text-[var(--chrome-ink-dim)]">
                    Show internal and system schemas
                  </span>
                  <input
                    v-model="form.showInternalSchemas"
                    type="checkbox"
                    class="size-4 accent-[var(--chrome-red)]"
                  />
                </label>
              </template>

              <template
                v-else-if="
                  form.provider === 'redis-proxy' ||
                  form.provider === 'mongo-proxy'
                "
              >
                <label class="chrome-label">
                  <span>Proxy Endpoint (optional)</span>
                  <input
                    v-model="form.endpoint"
                    class="chrome-input mt-1"
                    type="text"
                    :placeholder="
                      form.provider === 'redis-proxy'
                        ? '/api/providers/redis'
                        : '/api/providers/mongodb'
                    "
                  />
                </label>

                <div class="grid grid-cols-2 gap-3">
                  <label class="chrome-label">
                    <span>Hostname</span>
                    <input
                      v-model="form.host"
                      class="chrome-input mt-1"
                      type="text"
                    />
                  </label>

                  <label class="chrome-label">
                    <span>Port</span>
                    <input
                      v-model.number="form.port"
                      class="chrome-input mt-1"
                      type="number"
                    />
                  </label>
                </div>

                <label class="chrome-label">
                  <span>{{
                    form.provider === "redis-proxy"
                      ? "Database index"
                      : "Database"
                  }}</span>
                  <input
                    v-model="form.database"
                    class="chrome-input mt-1"
                    type="text"
                    :placeholder="
                      form.provider === 'redis-proxy' ? '0' : 'app'
                    "
                  />
                </label>

                <div class="grid grid-cols-2 gap-3">
                  <label class="chrome-label">
                    <span>Username (optional)</span>
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
                </div>

                <label class="flex items-center justify-end gap-1.5">
                  <span class="text-[11px] text-[var(--chrome-ink-dim)]">
                    Show internal and system schemas
                  </span>
                  <input
                    v-model="form.showInternalSchemas"
                    type="checkbox"
                    class="size-4 accent-[var(--chrome-red)]"
                  />
                </label>
              </template>

              <template v-else>
                <label v-if="form.provider === 'proxy'" class="chrome-label">
                  <span>WebSocket Proxy Endpoint (optional)</span>
                  <input
                    v-model="form.endpoint"
                    class="chrome-input mt-1"
                    type="text"
                    placeholder="localhost:6543"
                  />
                </label>

                <p
                  v-if="form.provider === 'proxy'"
                  class="mt-1 text-[11px] text-[var(--chrome-ink-dim)]"
                >
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
                  <div class="grid grid-cols-2 gap-3">
                    <label class="chrome-label">
                      <span>Hostname</span>
                      <input
                        v-model="form.host"
                        class="chrome-input mt-1"
                        type="text"
                        placeholder="localhost"
                      />
                    </label>

                    <label class="chrome-label">
                      <span>Port</span>
                      <input
                        v-model.number="form.port"
                        class="chrome-input mt-1"
                        type="number"
                      />
                    </label>
                  </div>

                  <label class="chrome-label">
                    <span>Database</span>
                    <input
                      v-model="form.database"
                      class="chrome-input mt-1"
                      type="text"
                    />
                  </label>

                  <div class="grid grid-cols-2 gap-3">
                    <label class="chrome-label">
                      <span>Username</span>
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
                  </div>
                </template>

                <template v-else>
                  <label class="chrome-label">
                    <span>Postgres Connection String</span>
                    <input
                      v-model="form.connectionString"
                      class="chrome-input mt-1"
                      type="password"
                      placeholder="postgresql://user:password@host:5432/database"
                    />
                  </label>

                  <label class="chrome-label">
                    <span>Password Override (optional)</span>
                    <input
                      v-model="form.password"
                      class="chrome-input mt-1"
                      type="password"
                      placeholder="Use this instead of connection-string password"
                    />
                  </label>
                </template>

                <label class="flex items-center justify-end gap-1.5">
                  <span class="text-[11px] text-[var(--chrome-ink-dim)]">
                    Show internal and system schemas
                  </span>
                  <input
                    v-model="form.showInternalSchemas"
                    type="checkbox"
                    class="size-4 accent-[var(--chrome-red)]"
                  />
                </label>
              </template>
            </template>

            <label v-if="shouldShowPasswordStorage" class="chrome-label">
              <span>Password Storage</span>
              <select v-model="form.passwordStorage" class="chrome-input mt-1">
                <option value="encrypted">Encrypted (PIN protected)</option>
                <option value="plain">Plain text</option>
                <option value="none">Do not save password</option>
              </select>
            </label>

            <div class="mt-1 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                class="chrome-btn inline-flex items-center gap-1"
                :disabled="isSubmitting || isTesting"
                @click="testConnection"
              >
                <FlaskConical :size="12" />
                {{ isTesting ? "Testing..." : "Test Connection" }}
              </button>

              <div class="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="chrome-btn"
                  :disabled="isSubmitting || isTesting"
                  @click="closeConnectionModal"
                >
                  Cancel
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
              </div>
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
