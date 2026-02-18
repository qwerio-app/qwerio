import { computed } from "vue";
import { defineStore } from "pinia";
import { useStorage } from "@vueuse/core";
import { z } from "zod";
import type { ConnectionProfile } from "../core/types";
import { createNanoId } from "../core/nano-id";

const desktopTargetSchema = z.object({
  kind: z.literal("desktop-tcp"),
  dialect: z.enum(["postgres", "mysql"]),
  host: z.string().min(1, "Host is required"),
  port: z.number().int().positive(),
  database: z.string().min(1, "Database is required"),
  user: z.string().min(1, "User is required"),
});

const neonTargetSchema = z.object({
  kind: z.literal("web-provider"),
  dialect: z.literal("postgres"),
  provider: z.literal("neon"),
  endpoint: z.string().min(1, "Endpoint is required"),
  projectId: z.string().optional(),
});

const planetScaleTargetSchema = z.object({
  kind: z.literal("web-provider"),
  dialect: z.literal("mysql"),
  provider: z.literal("planetscale"),
  endpoint: z.string().min(1, "Endpoint is required"),
  projectId: z.string().optional(),
});

const newConnectionSchema = z.object({
  name: z.string().min(2, "Connection name is too short"),
  target: z.union([desktopTargetSchema, neonTargetSchema, planetScaleTargetSchema]),
});

type NewConnectionInput = z.infer<typeof newConnectionSchema>;

export const useConnectionsStore = defineStore("connections", () => {
  const profiles = useStorage<ConnectionProfile[]>("qwerio.connections", []);
  const activeConnectionId = useStorage<string | null>("qwerio.connections.active", null);

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
      target: parsed.data.target,
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
      target: parsed.data.target,
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
    activeConnectionId,
    activeProfile,
    addConnection,
    updateConnection,
    removeConnection,
    setActiveConnection,
  };
});
