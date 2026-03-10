import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { getSettingValue, setSettingValue } from "../core/storage/indexed-db";
import { clampPageSize } from "../core/sql-pagination";
import {
  DEFAULT_THEME_ID,
  normalizeThemeId,
  type ThemeId,
} from "../core/theme-registry";

const DEFAULT_NEW_QUERY_SQL = "select now();";
const DEFAULT_RESULTS_PAGE_SIZE = 200;
const SHOW_ADVANCED_SCHEMA_GROUPS_KEY = "settings.showAdvancedSchemaGroups";
const NEW_QUERY_TEMPLATE_SQL_KEY = "settings.newQueryTemplateSql";
const RESULTS_PAGE_SIZE_KEY = "settings.resultsPageSize";
const THEME_ID_KEY = "settings.themeId";

export const useAppSettingsStore = defineStore("app-settings", () => {
  const themeId = ref<ThemeId>(DEFAULT_THEME_ID);
  const showAdvancedSchemaGroups = ref(false);
  const newQueryTemplateSql = ref(DEFAULT_NEW_QUERY_SQL);
  const resultsPageSize = ref(DEFAULT_RESULTS_PAGE_SIZE);
  const hasHydrated = ref(false);

  void (async () => {
    themeId.value = normalizeThemeId(
      await getSettingValue(THEME_ID_KEY, DEFAULT_THEME_ID),
    );
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

  watch(themeId, (value) => {
    const normalized = normalizeThemeId(value);

    if (themeId.value !== normalized) {
      themeId.value = normalized;
      return;
    }

    if (!hasHydrated.value) {
      return;
    }

    void setSettingValue(THEME_ID_KEY, normalized);
  });

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
    themeId.value = DEFAULT_THEME_ID;
    showAdvancedSchemaGroups.value = false;
    newQueryTemplateSql.value = DEFAULT_NEW_QUERY_SQL;
    resultsPageSize.value = DEFAULT_RESULTS_PAGE_SIZE;
  }

  return {
    themeId,
    showAdvancedSchemaGroups,
    newQueryTemplateSql,
    resultsPageSize,
    resetToDefaults,
  };
});
