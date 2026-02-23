import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { getSettingValue, setSettingValue } from "../core/storage/indexed-db";
import { clampPageSize } from "../core/sql-pagination";

const DEFAULT_NEW_QUERY_SQL = "select now();";
const DEFAULT_RESULTS_PAGE_SIZE = 200;
const SHOW_ADVANCED_SCHEMA_GROUPS_KEY = "settings.showAdvancedSchemaGroups";
const NEW_QUERY_TEMPLATE_SQL_KEY = "settings.newQueryTemplateSql";
const RESULTS_PAGE_SIZE_KEY = "settings.resultsPageSize";

export const useAppSettingsStore = defineStore("app-settings", () => {
  const showAdvancedSchemaGroups = ref(false);
  const newQueryTemplateSql = ref(DEFAULT_NEW_QUERY_SQL);
  const resultsPageSize = ref(DEFAULT_RESULTS_PAGE_SIZE);
  const hasHydrated = ref(false);

  void (async () => {
    showAdvancedSchemaGroups.value = await getSettingValue(
      SHOW_ADVANCED_SCHEMA_GROUPS_KEY,
      false,
    );
    newQueryTemplateSql.value = await getSettingValue(
      NEW_QUERY_TEMPLATE_SQL_KEY,
      DEFAULT_NEW_QUERY_SQL,
    );
    resultsPageSize.value = clampPageSize(
      await getSettingValue(RESULTS_PAGE_SIZE_KEY, DEFAULT_RESULTS_PAGE_SIZE),
      DEFAULT_RESULTS_PAGE_SIZE,
    );

    hasHydrated.value = true;
  })();

  watch(showAdvancedSchemaGroups, (value) => {
    if (!hasHydrated.value) {
      return;
    }

    void setSettingValue(SHOW_ADVANCED_SCHEMA_GROUPS_KEY, value);
  });

  watch(newQueryTemplateSql, (value) => {
    if (!hasHydrated.value) {
      return;
    }

    void setSettingValue(NEW_QUERY_TEMPLATE_SQL_KEY, value);
  });

  watch(resultsPageSize, (value) => {
    const normalized = clampPageSize(value, DEFAULT_RESULTS_PAGE_SIZE);

    if (resultsPageSize.value !== normalized) {
      resultsPageSize.value = normalized;
      return;
    }

    if (!hasHydrated.value) {
      return;
    }

    void setSettingValue(RESULTS_PAGE_SIZE_KEY, normalized);
  });

  function resetToDefaults(): void {
    showAdvancedSchemaGroups.value = false;
    newQueryTemplateSql.value = DEFAULT_NEW_QUERY_SQL;
    resultsPageSize.value = DEFAULT_RESULTS_PAGE_SIZE;
  }

  return {
    showAdvancedSchemaGroups,
    newQueryTemplateSql,
    resultsPageSize,
    resetToDefaults,
  };
});
