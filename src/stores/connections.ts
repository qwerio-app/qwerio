import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { z } from "zod";
import type {
  ConnectionProfile,
  DesktopPostgresTlsMode,
} from "../core/types";
import { createNanoId } from "../core/nano-id";
import {
  getVariableValue,
  loadConnectionsFromStorage,
  saveConnectionsToStorage,
  setVariableValue,
} from "../core/storage/indexed-db";

const desktopPostgresTargetSchema = z.object({
  kind: z.literal("desktop-tcp"),
  dialect: z.literal("postgres"),
  host: z.string().min(1, "Host is required"),
  port: z.number().int().positive(),
  database: z.string().min(1, "Database is required"),
  user: z.string().min(1, "User is required"),
  tlsMode: z
    .enum(["tls-verified-cert", "tls-allow-invalid-cert", "non-tls"])
    .optional(),
});

const desktopTcpTargetSchema = z.object({
  kind: z.literal("desktop-tcp"),
  dialect: z.enum(["mysql", "sqlserver"]),
  host: z.string().min(1, "Host is required"),
  port: z.number().int().positive(),
  database: z.string().min(1, "Database is required"),
  user: z.string().min(1, "User is required"),
});

const desktopRedisTargetSchema = z.object({
  kind: z.literal("desktop-tcp"),
  dialect: z.literal("redis"),
  host: z.string().min(1, "Host is required"),
  port: z.number().int().positive(),
  database: z.string().min(1, "Database is required"),
  user: z.string().optional(),
});

const desktopMongoTargetSchema = z.object({
  kind: z.literal("desktop-tcp"),
  dialect: z.literal("mongodb"),
  host: z.string().min(1, "Host is required"),
  port: z.number().int().positive(),
  database: z.string().min(1, "Database is required"),
  user: z.string().optional(),
});

const desktopSqliteTargetSchema = z.object({
  kind: z.literal("desktop-tcp"),
  dialect: z.literal("sqlite"),
  database: z.string().min(1, "SQLite database path is required"),
});

const neonTargetSchema = z.object({
  kind: z.literal("web-provider"),
  dialect: z.literal("postgres"),
  provider: z.literal("neon"),
  endpoint: z.string().min(1, "Endpoint is required"),
  connectionStringTemplate: z.string().min(1, "Connection string is required"),
  projectId: z.string().optional(),
});

const proxyTargetSchema = z.object({
  kind: z.literal("web-provider"),
  dialect: z.literal("postgres"),
  provider: z.literal("proxy"),
  endpoint: z.string().min(1, "Endpoint is required"),
  connectionStringTemplate: z.string().min(1, "Connection string is required"),
  projectId: z.string().optional(),
});

const planetScaleTargetSchema = z.object({
  kind: z.literal("web-provider"),
  dialect: z.literal("mysql"),
  provider: z.literal("planetscale"),
  endpoint: z.string().min(1, "Endpoint is required"),
  username: z.string().min(1, "Username is required"),
  projectId: z.string().optional(),
});

const redisProxyTargetSchema = z.object({
  kind: z.literal("web-provider"),
  dialect: z.literal("redis"),
  provider: z.literal("redis-proxy"),
  endpoint: z.string().min(1, "Endpoint is required"),
  host: z.string().min(1, "Host is required"),
  port: z.number().int().positive(),
  database: z.string().min(1, "Database is required"),
  user: z.string().optional(),
  projectId: z.string().optional(),
});

const mongoProxyTargetSchema = z.object({
  kind: z.literal("web-provider"),
  dialect: z.literal("mongodb"),
  provider: z.literal("mongo-proxy"),
  endpoint: z.string().min(1, "Endpoint is required"),
  host: z.string().min(1, "Host is required"),
  port: z.number().int().positive(),
  database: z.string().min(1, "Database is required"),
  user: z.string().optional(),
  projectId: z.string().optional(),
});

const connectionCredentialsSchema = z.union([
  z.object({
    storage: z.literal("none"),
  }),
  z.object({
    storage: z.literal("plain"),
    password: z.string(),
  }),
  z.object({
    storage: z.literal("encrypted"),
    envelope: z.object({
      version: z.literal(1),
      algorithm: z.literal("aes-gcm"),
      kdf: z.literal("pbkdf2-sha256"),
      iterations: z.number().int().positive(),
      salt: z.string().min(1),
      iv: z.string().min(1),
      ciphertext: z.string().min(1),
    }),
  }),
]);

const newConnectionSchema = z.object({
  name: z.string().min(2, "Connection name is too short"),
  type: z.enum(["personal", "team"]),
  target: z.union([
    desktopPostgresTargetSchema,
    desktopTcpTargetSchema,
    desktopRedisTargetSchema,
    desktopMongoTargetSchema,
    desktopSqliteTargetSchema,
    neonTargetSchema,
    proxyTargetSchema,
    planetScaleTargetSchema,
    redisProxyTargetSchema,
    mongoProxyTargetSchema,
  ]),
  credentials: connectionCredentialsSchema,
  showInternalSchemas: z.boolean().optional(),
});

type NewConnectionInput = z.infer<typeof newConnectionSchema>;
const ACTIVE_CONNECTION_ID_KEY = "variables.connections.activeConnectionId";

function normalizeConnectionSync(
  profile: ConnectionProfile,
): ConnectionProfile["sync"] {
  if (!profile.sync) {
    return {
      enabled: false,
    };
  }

  return {
    enabled: Boolean(profile.sync.enabled),
    ...(profile.sync.serverId ? { serverId: profile.sync.serverId } : {}),
    ...(profile.sync.lastSyncedAt
      ? { lastSyncedAt: profile.sync.lastSyncedAt }
      : {}),
  };
}

function normalizeStoredProfile(profile: ConnectionProfile): ConnectionProfile {
  return {
    ...profile,
    sync: normalizeConnectionSync(profile),
  };
}

export const useConnectionsStore = defineStore("connections", () => {
  const profiles = ref<ConnectionProfile[]>([]);
  const activeConnectionId = ref<string | null>(null);
  const hasHydrated = ref(false);

  void (async () => {
    const [storedProfiles, storedActiveConnectionId] = await Promise.all([
      loadConnectionsFromStorage(),
      getVariableValue<string | null>(ACTIVE_CONNECTION_ID_KEY, null),
    ]);

    profiles.value = storedProfiles.map((profile) => normalizeStoredProfile(profile));
    activeConnectionId.value = storedActiveConnectionId;
    hasHydrated.value = true;

    if (
      profiles.value.length > 0 &&
      (!activeConnectionId.value ||
        !profiles.value.some((profile) => profile.id === activeConnectionId.value))
    ) {
      activeConnectionId.value = profiles.value[0].id;
    }
  })();

  watch(
    () => profiles.value.map((profile) => profile.id),
    (profileIds) => {
      if (!hasHydrated.value) {
        return;
      }

      if (profileIds.length === 0) {
        activeConnectionId.value = null;
        return;
      }

      if (
        activeConnectionId.value &&
        profileIds.includes(activeConnectionId.value)
      ) {
        return;
      }

      activeConnectionId.value = profileIds[0];
    },
    { immediate: true },
  );

  watch(
    profiles,
    (nextProfiles) => {
      if (!hasHydrated.value) {
        return;
      }

      void saveConnectionsToStorage(nextProfiles);
    },
    { deep: true },
  );

  watch(activeConnectionId, (value) => {
    if (!hasHydrated.value) {
      return;
    }

    void setVariableValue(ACTIVE_CONNECTION_ID_KEY, value);
  });

  const activeProfile = computed(() =>
    profiles.value.find((profile) => profile.id === activeConnectionId.value) ?? null,
  );

  function addConnection(
    input: NewConnectionInput,
  ): { ok: true; profile: ConnectionProfile } | { ok: false; message: string } {
    const parsed = newConnectionSchema.safeParse(input);

    if (!parsed.success) {
      return {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Invalid connection profile",
      };
    }

    const now = new Date().toISOString();
    const profile: ConnectionProfile = {
      id: createNanoId(),
      name: parsed.data.name,
      type: parsed.data.type,
      target: parsed.data.target,
      credentials: parsed.data.credentials,
      sync: {
        enabled: false,
      },
      showInternalSchemas: Boolean(parsed.data.showInternalSchemas),
      createdAt: now,
      updatedAt: now,
    };

    profiles.value = [profile, ...profiles.value];

    if (!activeConnectionId.value) {
      activeConnectionId.value = profile.id;
    }

    return { ok: true, profile };
  }

  function updateConnection(
    id: string,
    input: NewConnectionInput,
  ): { ok: true; profile: ConnectionProfile } | { ok: false; message: string } {
    const parsed = newConnectionSchema.safeParse(input);

    if (!parsed.success) {
      return {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Invalid connection profile",
      };
    }

    const index = profiles.value.findIndex((profile) => profile.id === id);

    if (index === -1) {
      return {
        ok: false,
        message: "Connection profile not found.",
      };
    }

    const existingProfile = profiles.value[index];
    const nextTarget =
      parsed.data.target.kind === "desktop-tcp" &&
      parsed.data.target.dialect === "postgres" &&
      existingProfile.target.kind === "desktop-tcp" &&
      existingProfile.target.dialect === "postgres" &&
      !parsed.data.target.tlsMode &&
      parsed.data.target.host === existingProfile.target.host &&
      parsed.data.target.port === existingProfile.target.port &&
      parsed.data.target.database === existingProfile.target.database &&
      parsed.data.target.user === existingProfile.target.user &&
      existingProfile.target.tlsMode
        ? {
            ...parsed.data.target,
            tlsMode: existingProfile.target.tlsMode,
          }
        : parsed.data.target;

    const updatedProfile: ConnectionProfile = {
      ...existingProfile,
      name: parsed.data.name,
      type: parsed.data.type,
      target: nextTarget,
      credentials: parsed.data.credentials,
      sync: normalizeConnectionSync(existingProfile),
      showInternalSchemas: Boolean(parsed.data.showInternalSchemas),
      updatedAt: new Date().toISOString(),
    };

    profiles.value = profiles.value.map((profile) =>
      profile.id === id ? updatedProfile : profile,
    );

    return {
      ok: true,
      profile: updatedProfile,
    };
  }

  function removeConnection(id: string): void {
    profiles.value = profiles.value.filter((profile) => profile.id !== id);

    if (activeConnectionId.value === id) {
      activeConnectionId.value = profiles.value[0]?.id ?? null;
    }
  }

  function setActiveConnection(id: string): void {
    activeConnectionId.value = id;
  }

  function setConnectionSyncMetadata(
    id: string,
    sync: ConnectionProfile["sync"],
  ): ConnectionProfile | null {
    const index = profiles.value.findIndex((profile) => profile.id === id);

    if (index === -1) {
      return null;
    }

    const current = profiles.value[index];
    const nextProfile: ConnectionProfile = {
      ...current,
      sync: sync
        ? {
            enabled: Boolean(sync.enabled),
            ...(sync.serverId ? { serverId: sync.serverId } : {}),
            ...(sync.lastSyncedAt ? { lastSyncedAt: sync.lastSyncedAt } : {}),
          }
        : {
            enabled: false,
          },
    };

    profiles.value = profiles.value.map((profile) =>
      profile.id === id ? nextProfile : profile,
    );

    return nextProfile;
  }

  function setDesktopPostgresTlsMode(
    id: string,
    tlsMode: DesktopPostgresTlsMode,
  ): ConnectionProfile | null {
    const index = profiles.value.findIndex((profile) => profile.id === id);

    if (index === -1) {
      return null;
    }

    const current = profiles.value[index];

    if (
      current.target.kind !== "desktop-tcp" ||
      current.target.dialect !== "postgres"
    ) {
      return null;
    }

    if (current.target.tlsMode === tlsMode) {
      return current;
    }

    const nextProfile: ConnectionProfile = {
      ...current,
      target: {
        ...current.target,
        tlsMode,
      },
    };

    profiles.value = profiles.value.map((profile) =>
      profile.id === id ? nextProfile : profile,
    );

    return nextProfile;
  }

  return {
    profiles,
    hasHydrated,
    activeConnectionId,
    activeProfile,
    addConnection,
    updateConnection,
    removeConnection,
    setActiveConnection,
    setConnectionSyncMetadata,
    setDesktopPostgresTlsMode,
  };
});
