import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ConnectionProfile } from "../core/types";
import { createNanoId } from "../core/nano-id";
import {
  getVariableValue,
  loadConnectionsFromStorage,
  saveConnectionsToStorage,
  setVariableValue,
} from "../core/storage/indexed-db";

const desktopTcpTargetSchema = z.object({
  kind: z.literal("desktop-tcp"),
  dialect: z.enum(["postgres", "mysql", "sqlserver"]),
  host: z.string().min(1, "Host is required"),
  port: z.number().int().positive(),
  database: z.string().min(1, "Database is required"),
  user: z.string().min(1, "User is required"),
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
    desktopTcpTargetSchema,
    desktopSqliteTargetSchema,
    neonTargetSchema,
    proxyTargetSchema,
    planetScaleTargetSchema,
  ]),
  credentials: connectionCredentialsSchema,
  showInternalSchemas: z.boolean().optional(),
});

type NewConnectionInput = z.infer<typeof newConnectionSchema>;
const ACTIVE_CONNECTION_ID_KEY = "variables.connections.activeConnectionId";

export const useConnectionsStore = defineStore("connections", () => {
  const profiles = ref<ConnectionProfile[]>([]);
  const activeConnectionId = ref<string | null>(null);
  const hasHydrated = ref(false);

  void (async () => {
    const [storedProfiles, storedActiveConnectionId] = await Promise.all([
      loadConnectionsFromStorage(),
      getVariableValue<string | null>(ACTIVE_CONNECTION_ID_KEY, null),
    ]);

    profiles.value = storedProfiles;
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
    const updatedProfile: ConnectionProfile = {
      ...existingProfile,
      name: parsed.data.name,
      type: parsed.data.type,
      target: parsed.data.target,
      credentials: parsed.data.credentials,
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

  return {
    profiles,
    hasHydrated,
    activeConnectionId,
    activeProfile,
    addConnection,
    updateConnection,
    removeConnection,
    setActiveConnection,
  };
});
