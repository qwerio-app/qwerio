import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { createNanoId } from "../core/nano-id";
import {
  getConnectionSyncChanges,
  pushConnectionSync,
  type SyncConnectionRecord,
  type SyncPushDeletionPayload,
  type SyncPushUpsertPayload,
} from "../core/connection-sync-api";
import { getVariableValue, setVariableValue } from "../core/storage/indexed-db";
import type { ConnectionProfile } from "../core/types";
import { useAuthStore } from "./auth";
import { useConnectionsStore } from "./connections";

type PendingSyncDeletion = {
  serverConnectionId: string;
  deletedAt: string;
};

const SYNC_CURSOR_KEY = "variables.connections.sync.cursor";
const SYNC_PENDING_DELETES_KEY = "variables.connections.sync.pendingDeletes";

function hasPremiumSyncAccess(profile: ReturnType<typeof useAuthStore>["currentUser"]): boolean {
  if (!profile) {
    return false;
  }

  return profile.subscriptions.some(
    (subscription) =>
      subscription.status === "active" || subscription.status === "trialing",
  );
}

function toPendingSyncDeletions(value: unknown): PendingSyncDeletion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as {
        serverConnectionId?: unknown;
        deletedAt?: unknown;
      };

      return typeof record.serverConnectionId === "string" && typeof record.deletedAt === "string"
        ? {
            serverConnectionId: record.serverConnectionId,
            deletedAt: record.deletedAt,
          }
        : null;
    })
    .filter((entry): entry is PendingSyncDeletion => entry !== null);
}

function toSyncUpsertPayload(profile: ConnectionProfile): SyncPushUpsertPayload | null {
  if (profile.credentials.storage === "plain") {
    return null;
  }

  return {
    clientConnectionId: profile.id,
    ...(profile.sync?.serverId ? { serverConnectionId: profile.sync.serverId } : {}),
    name: profile.name,
    type: profile.type,
    target: profile.target,
    credentials: profile.credentials,
    showInternalSchemas: Boolean(profile.showInternalSchemas),
    clientUpdatedAt: profile.updatedAt,
  };
}

function shouldPushConnection(profile: ConnectionProfile): boolean {
  const sync = profile.sync;

  if (!sync?.enabled) {
    return false;
  }

  if (!sync.serverId || !sync.lastSyncedAt) {
    return true;
  }

  const updatedAt = Date.parse(profile.updatedAt);
  const lastSyncedAt = Date.parse(sync.lastSyncedAt);

  if (Number.isNaN(updatedAt) || Number.isNaN(lastSyncedAt)) {
    return true;
  }

  return updatedAt > lastSyncedAt;
}

function summarizeSyncResult(input: {
  pushed: number;
  pulled: number;
  deleted: number;
  importsPending: number;
}): string {
  return [
    `Pushed ${input.pushed}`,
    `pulled ${input.pulled}`,
    `deleted ${input.deleted}`,
    input.importsPending > 0
      ? `${input.importsPending} server connection${
          input.importsPending === 1 ? "" : "s"
        } ready to import`
      : "no pending imports",
  ].join(". ");
}

export const useConnectionSyncStore = defineStore("connection-sync", () => {
  const authStore = useAuthStore();
  const connectionsStore = useConnectionsStore();

  const isSyncing = ref(false);
  const syncError = ref("");
  const syncMessage = ref("");
  const upgradeRequiredConnectionIds = ref<string[]>([]);
  const pendingServerConnections = ref<SyncConnectionRecord[]>([]);

  const isPremiumEligible = computed(() => hasPremiumSyncAccess(authStore.currentUser));
  const isAuthenticated = computed(() => Boolean(authStore.isAuthenticated && authStore.accessToken));

  async function loadSyncCursor(): Promise<string | null> {
    return getVariableValue<string | null>(SYNC_CURSOR_KEY, null);
  }

  async function saveSyncCursor(cursor: string): Promise<void> {
    await setVariableValue(SYNC_CURSOR_KEY, cursor);
  }

  async function loadPendingDeletions(): Promise<PendingSyncDeletion[]> {
    const value = await getVariableValue<unknown>(SYNC_PENDING_DELETES_KEY, []);
    return toPendingSyncDeletions(value);
  }

  async function savePendingDeletions(deletions: PendingSyncDeletion[]): Promise<void> {
    await setVariableValue(SYNC_PENDING_DELETES_KEY, deletions);
  }

  async function enqueuePendingDeletion(serverConnectionId: string): Promise<void> {
    const deletions = await loadPendingDeletions();
    const filtered = deletions.filter(
      (entry) => entry.serverConnectionId !== serverConnectionId,
    );

    filtered.push({
      serverConnectionId,
      deletedAt: new Date().toISOString(),
    });

    await savePendingDeletions(filtered);
  }

  function clearFeedback(): void {
    syncError.value = "";
    syncMessage.value = "";
  }

  async function setConnectionSyncEnabled(
    connectionId: string,
    enabled: boolean,
  ): Promise<void> {
    const profile = connectionsStore.profiles.find((entry) => entry.id === connectionId);

    if (!profile) {
      return;
    }

    clearFeedback();

    if (enabled) {
      connectionsStore.setConnectionSyncMetadata(connectionId, {
        enabled: true,
        ...(profile.sync?.serverId ? { serverId: profile.sync.serverId } : {}),
        ...(profile.sync?.lastSyncedAt
          ? { lastSyncedAt: profile.sync.lastSyncedAt }
          : {}),
      });
      return;
    }

    if (profile.sync?.serverId) {
      await enqueuePendingDeletion(profile.sync.serverId);
    }

    connectionsStore.setConnectionSyncMetadata(connectionId, {
      enabled: false,
    });
  }

  async function queueDeletionForConnection(profile: ConnectionProfile): Promise<void> {
    if (!profile.sync?.serverId) {
      return;
    }

    await enqueuePendingDeletion(profile.sync.serverId);
  }

  function importServerConnections(serverConnectionIds?: string[]): number {
    const selectedIds = new Set(serverConnectionIds ?? pendingServerConnections.value.map((entry) => entry.id));
    const toImport = pendingServerConnections.value.filter((entry) => selectedIds.has(entry.id));

    if (toImport.length === 0) {
      return 0;
    }

    const now = new Date().toISOString();

    const existingServerIds = new Set(
      connectionsStore.profiles
        .map((profile) => profile.sync?.serverId)
        .filter((serverId): serverId is string => typeof serverId === "string"),
    );

    const importedProfiles = toImport
      .filter((entry) => !existingServerIds.has(entry.id))
      .map((entry) => ({
        id: createNanoId(),
        name: entry.name,
        type: entry.type,
        target: entry.target,
        credentials: entry.credentials,
        sync: {
          enabled: true,
          serverId: entry.id,
          lastSyncedAt: now,
        },
        showInternalSchemas: entry.showInternalSchemas,
        createdAt: entry.createdAt,
        updatedAt: entry.clientUpdatedAt,
      }));

    if (importedProfiles.length > 0) {
      connectionsStore.profiles = [...importedProfiles, ...connectionsStore.profiles];

      if (!connectionsStore.activeConnectionId) {
        connectionsStore.activeConnectionId = importedProfiles[0].id;
      }
    }

    pendingServerConnections.value = pendingServerConnections.value.filter(
      (entry) => !selectedIds.has(entry.id),
    );

    return importedProfiles.length;
  }

  async function syncNow(): Promise<boolean> {
    if (isSyncing.value) {
      return false;
    }

    clearFeedback();
    isSyncing.value = true;

    try {
      const accessToken = authStore.accessToken;

      if (!accessToken) {
        throw new Error("Sign in to sync connections.");
      }

      if (!isPremiumEligible.value) {
        throw new Error(
          "Connection sync is a premium feature. An active or trialing subscription is required.",
        );
      }

      const syncEnabledConnections = connectionsStore.profiles.filter((profile) =>
        Boolean(profile.sync?.enabled),
      );

      const plainCredentialConnections = syncEnabledConnections.filter(
        (profile) => profile.credentials.storage === "plain",
      );

      if (plainCredentialConnections.length > 0) {
        upgradeRequiredConnectionIds.value = plainCredentialConnections.map(
          (profile) => profile.id,
        );
        throw new Error(
          "Sync blocked. Upgrade plaintext passwords to encrypted credentials before syncing.",
        );
      }

      upgradeRequiredConnectionIds.value = [];

      const [cursor, pendingDeletions] = await Promise.all([
        loadSyncCursor(),
        loadPendingDeletions(),
      ]);

      const upserts = syncEnabledConnections
        .filter((profile) => shouldPushConnection(profile))
        .map((profile) => toSyncUpsertPayload(profile))
        .filter((entry): entry is SyncPushUpsertPayload => entry !== null);

      const deletions: SyncPushDeletionPayload[] = pendingDeletions.map((entry) => ({
        serverConnectionId: entry.serverConnectionId,
        deletedAt: entry.deletedAt,
      }));

      const pushResponse = await pushConnectionSync(accessToken, {
        upserts,
        deletions,
      });

      const remainingDeletions = pendingDeletions.filter(
        (entry) =>
          !pushResponse.acceptedDeletions.some(
            (accepted) => accepted.serverConnectionId === entry.serverConnectionId,
          ),
      );

      for (const acceptedUpsert of pushResponse.acceptedUpserts) {
        connectionsStore.profiles = connectionsStore.profiles.map((profile) =>
          profile.id === acceptedUpsert.clientConnectionId
            ? {
                ...profile,
                name: acceptedUpsert.connection.name,
                type: acceptedUpsert.connection.type,
                target: acceptedUpsert.connection.target,
                credentials: acceptedUpsert.connection.credentials,
                showInternalSchemas: acceptedUpsert.connection.showInternalSchemas,
                updatedAt: acceptedUpsert.connection.clientUpdatedAt,
                sync: {
                  enabled: true,
                  serverId: acceptedUpsert.connection.id,
                  lastSyncedAt: pushResponse.cursor,
                },
              }
            : profile,
        );
      }

      await savePendingDeletions(remainingDeletions);

      const changesResponse = await getConnectionSyncChanges(accessToken, cursor ?? undefined);

      const pendingImportByServerId = new Map(
        pendingServerConnections.value.map((entry) => [entry.id, entry]),
      );

      for (const deletion of changesResponse.deletions) {
        const localProfile = connectionsStore.profiles.find(
          (profile) => profile.sync?.serverId === deletion.serverConnectionId,
        );

        if (localProfile) {
          connectionsStore.removeConnection(localProfile.id);
        }

        pendingImportByServerId.delete(deletion.serverConnectionId);
      }

      for (const serverConnection of changesResponse.upserts) {
        const localProfile = connectionsStore.profiles.find(
          (profile) => profile.sync?.serverId === serverConnection.id,
        );

        if (!localProfile) {
          pendingImportByServerId.set(serverConnection.id, serverConnection);
          continue;
        }

        const localUpdatedAt = Date.parse(localProfile.updatedAt);
        const serverUpdatedAt = Date.parse(serverConnection.clientUpdatedAt);

        if (
          !Number.isNaN(localUpdatedAt) &&
          !Number.isNaN(serverUpdatedAt) &&
          localUpdatedAt > serverUpdatedAt
        ) {
          continue;
        }

        connectionsStore.profiles = connectionsStore.profiles.map((profile) =>
          profile.id === localProfile.id
            ? {
                ...profile,
                name: serverConnection.name,
                type: serverConnection.type,
                target: serverConnection.target,
                credentials: serverConnection.credentials,
                showInternalSchemas: serverConnection.showInternalSchemas,
                updatedAt: serverConnection.clientUpdatedAt,
                sync: {
                  enabled: profile.sync?.enabled ?? true,
                  serverId: serverConnection.id,
                  lastSyncedAt: changesResponse.cursor,
                },
              }
            : profile,
        );
      }

      pendingServerConnections.value = Array.from(pendingImportByServerId.values());

      await saveSyncCursor(changesResponse.cursor);

      syncMessage.value = summarizeSyncResult({
        pushed: pushResponse.acceptedUpserts.length,
        pulled: changesResponse.upserts.length,
        deleted: changesResponse.deletions.length,
        importsPending: pendingServerConnections.value.length,
      });

      if (pushResponse.rejected.length > 0) {
        syncError.value = `${pushResponse.rejected.length} sync change${
          pushResponse.rejected.length === 1 ? " was" : "s were"
        } rejected due to stale or invalid data.`;
      }

      return true;
    } catch (error) {
      syncError.value =
        error instanceof Error ? error.message : "Connection sync failed.";
      return false;
    } finally {
      isSyncing.value = false;
    }
  }

  return {
    isSyncing,
    syncError,
    syncMessage,
    isPremiumEligible,
    isAuthenticated,
    upgradeRequiredConnectionIds,
    pendingServerConnections,
    setConnectionSyncEnabled,
    queueDeletionForConnection,
    importServerConnections,
    syncNow,
  };
});
