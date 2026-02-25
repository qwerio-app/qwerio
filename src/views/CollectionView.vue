<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RefreshCcw } from "lucide-vue-next";
import { useRoute } from "vue-router";
import ResultsGrid from "../components/workbench/ResultsGrid.vue";
import { getQueryEngine } from "../core/query-engine-service";
import { SecretPinRequiredError } from "../core/secret-vault";
import type {
  ConnectionProfile,
  DataObjectType,
  DesktopPostgresTlsMode,
  QueryResult,
} from "../core/types";
import { useConnectionsStore } from "../stores/connections";
import { useVaultStore } from "../stores/vault";
import { useWorkbenchStore } from "../stores/workbench";

const DEFAULT_LIMIT = 200;

const route = useRoute();
const connectionsStore = useConnectionsStore();
const vaultStore = useVaultStore();
const workbenchStore = useWorkbenchStore();

const isLoading = ref(false);
const errorMessage = ref("");
const result = ref<QueryResult | null>(null);

const collectionTabId = computed(() =>
  typeof route.params.collectionTabId === "string"
    ? route.params.collectionTabId
    : "",
);

const collectionTab = computed(() => {
  if (!collectionTabId.value) {
    return null;
  }

  return workbenchStore.getTableTab(collectionTabId.value);
});

const connectionProfile = computed(() => {
  if (!collectionTab.value) {
    return null;
  }

  return (
    connectionsStore.profiles.find(
      (profile) => profile.id === collectionTab.value?.connectionId,
    ) ?? null
  );
});

function applyResolvedDesktopTlsMode(
  connection: ConnectionProfile,
  connectResult: { resolvedDesktopTlsMode?: DesktopPostgresTlsMode },
): void {
  if (
    connection.target.kind !== "desktop-tcp" ||
    connection.target.dialect !== "postgres" ||
    !connectResult.resolvedDesktopTlsMode
  ) {
    return;
  }

  connectionsStore.setDesktopPostgresTlsMode(
    connection.id,
    connectResult.resolvedDesktopTlsMode,
  );
}

const objectType = computed<DataObjectType>(
  () => collectionTab.value?.objectType ?? "collection",
);

const title = computed(() => collectionTab.value?.tableName ?? "Collection");
const namespaceLabel = computed(() => collectionTab.value?.schemaName ?? "");
const objectTypeLabel = computed(() => {
  if (objectType.value === "collection") {
    return "MongoDB collection";
  }

  if (objectType.value === "redis-string") {
    return "Redis string key";
  }

  if (objectType.value === "redis-hash") {
    return "Redis hash key";
  }

  if (objectType.value === "redis-list") {
    return "Redis list key";
  }

  if (objectType.value === "redis-set") {
    return "Redis set key";
  }

  if (objectType.value === "redis-zset") {
    return "Redis sorted set key";
  }

  if (objectType.value === "redis-stream") {
    return "Redis stream key";
  }

  if (objectType.value === "redis-key") {
    return "Redis key";
  }

  return objectType.value;
});

function buildPreviewCommand(): string | null {
  if (!collectionTab.value || !connectionProfile.value) {
    return null;
  }

  if (connectionProfile.value.target.dialect === "mongodb") {
    return JSON.stringify({
      op: "find",
      database: collectionTab.value.schemaName,
      collection: collectionTab.value.tableName,
      filter: {},
      limit: DEFAULT_LIMIT,
    });
  }

  if (connectionProfile.value.target.dialect === "redis") {
    return JSON.stringify({
      op: "preview-key",
      database: collectionTab.value.schemaName,
      key: collectionTab.value.tableName,
      keyType: objectType.value,
      limit: DEFAULT_LIMIT,
    });
  }

  return null;
}

async function loadPreview(): Promise<void> {
  const collection = collectionTab.value;
  const connection = connectionProfile.value;
  const previewCommand = buildPreviewCommand();

  if (!collection || !connection || !previewCommand) {
    result.value = null;
    errorMessage.value = "";
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    const engine = getQueryEngine();
    const connectResult = await engine.connect(connection);
    applyResolvedDesktopTlsMode(connection, connectResult);
    result.value = await engine.execute({
      connectionId: connection.id,
      sql: previewCommand,
    });
  } catch (error) {
    if (error instanceof SecretPinRequiredError) {
      vaultStore.requestUnlockPrompt(error.envelope);
    }

    result.value = null;
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "Failed to load object preview.";
  } finally {
    isLoading.value = false;
  }
}

watch(
  () => [
    collectionTab.value?.id,
    collectionTab.value?.schemaName,
    collectionTab.value?.tableName,
    collectionTab.value?.objectType,
    connectionProfile.value?.id,
  ],
  async () => {
    await loadPreview();
  },
  { immediate: true },
);
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-2">
    <header
      class="chrome-panel-header flex items-center justify-between gap-2 px-2.5 py-2"
    >
      <div class="min-w-0">
        <p
          class="truncate font-display text-base font-semibold tracking-[0.05em] text-[var(--chrome-ink)]"
        >
          {{ title }}
        </p>
        <p class="truncate text-[11px] text-[var(--chrome-ink-dim)]">
          {{ objectTypeLabel }}
          <span v-if="namespaceLabel"> · {{ namespaceLabel }}</span>
        </p>
      </div>

      <button
        type="button"
        class="chrome-btn inline-flex h-7 items-center gap-1"
        :disabled="isLoading"
        @click="loadPreview"
      >
        <RefreshCcw :size="12" :class="isLoading ? 'animate-spin' : ''" />
        Refresh
      </button>
    </header>

    <div class="min-h-0 flex-1">
      <ResultsGrid :result="result" :error-message="errorMessage" :pagination="null" />
    </div>
  </section>
</template>
