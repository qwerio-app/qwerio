import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { getSettingValue, setSettingValue } from "../core/storage/indexed-db";

const DEFAULT_NEW_QUERY_SQL = "select now();";
const SHOW_ADVANCED_SCHEMA_GROUPS_KEY = "settings.showAdvancedSchemaGroups";
const NEW_QUERY_TEMPLATE_SQL_KEY = "settings.newQueryTemplateSql";

export const useAppSettingsStore = defineStore("app-settings", () => {
  const showAdvancedSchemaGroups = ref(false);
  const newQueryTemplateSql = ref(DEFAULT_NEW_QUERY_SQL);
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

  function resetToDefaults(): void {
    showAdvancedSchemaGroups.value = false;
    newQueryTemplateSql.value = DEFAULT_NEW_QUERY_SQL;
  }

  return {
    showAdvancedSchemaGroups,
    newQueryTemplateSql,
    resetToDefaults,
  };
});
