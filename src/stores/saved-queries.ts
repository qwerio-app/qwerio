import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { createNanoId } from "../core/nano-id";
import {
  loadSavedQueriesFromStorage,
  removeSavedQueryFromStorage,
  saveSavedQueryToStorage,
} from "../core/storage/indexed-db";

export type SavedQuery = {
  id: string;
  connectionId: string;
  schemaName: string;
  name: string;
  sql: string;
  createdAt: string;
  updatedAt: string;
};

type SaveSavedQueryInput = {
  id?: string;
  connectionId: string;
  schemaName: string;
  name?: string;
  sql: string;
};

function normalizeSavedQueryName(name?: string): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Saved query";
}

export const useSavedQueriesStore = defineStore("saved-queries", () => {
  const queries = ref<SavedQuery[]>([]);
  const hasHydrated = ref(false);

  void (async () => {
    queries.value = await loadSavedQueriesFromStorage();
    hasHydrated.value = true;
  })();

  const queryCount = computed(() => queries.value.length);

  function getQueriesForConnectionSchema(
    connectionId: string,
    schemaName: string,
  ): SavedQuery[] {
    return queries.value.filter(
      (query) =>
        query.connectionId === connectionId && query.schemaName === schemaName,
    );
  }

  async function saveQuery(input: SaveSavedQueryInput): Promise<SavedQuery> {
    const existing = input.id
      ? queries.value.find((query) => query.id === input.id) ?? null
      : null;
    const timestamp = new Date().toISOString();
    const query: SavedQuery = {
      id: existing?.id ?? createNanoId(),
      connectionId: input.connectionId,
      schemaName: input.schemaName,
      name: normalizeSavedQueryName(input.name),
      sql: input.sql,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    if (existing) {
      queries.value = queries.value.map((item) =>
        item.id === query.id ? query : item,
      );
    } else {
      queries.value = [query, ...queries.value];
    }

    await saveSavedQueryToStorage(query);
    return query;
  }

  async function removeQuery(id: string): Promise<void> {
    queries.value = queries.value.filter((query) => query.id !== id);
    await removeSavedQueryFromStorage(id);
  }

  return {
    queries,
    hasHydrated,
    queryCount,
    getQueriesForConnectionSchema,
    saveQuery,
    removeQuery,
  };
});
