import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { getSettingValue, setSettingValue } from "../core/storage/indexed-db";

const DEFAULT_NEW_QUERY_SQL = "select now();";
const SHOW_SYSTEM_STATUS_BUTTON_KEY = "settings.showSystemStatusButton";
const SHOW_CONNECTION_STATUS_PILL_KEY = "settings.showConnectionStatusPill";
const SHOW_ADVANCED_SCHEMA_GROUPS_KEY = "settings.showAdvancedSchemaGroups";
const NEW_QUERY_TEMPLATE_SQL_KEY = "settings.newQueryTemplateSql";

export const useAppSettingsStore = defineStore("app-settings", () => {
  const showSystemStatusButton = ref(true);
  const showConnectionStatusPill = ref(true);
  const showAdvancedSchemaGroups = ref(false);
  const newQueryTemplateSql = ref(DEFAULT_NEW_QUERY_SQL);
  const hasHydrated = ref(false);

  void (async () => {
    showSystemStatusButton.value = await getSettingValue(
      SHOW_SYSTEM_STATUS_BUTTON_KEY,
      true,
    );
    showConnectionStatusPill.value = await getSettingValue(
      SHOW_CONNECTION_STATUS_PILL_KEY,
      true,
    );
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

  watch(showSystemStatusButton, (value) => {
    if (!hasHydrated.value) {
      return;
    }

    void setSettingValue(SHOW_SYSTEM_STATUS_BUTTON_KEY, value);
  });

  watch(showConnectionStatusPill, (value) => {
    if (!hasHydrated.value) {
      return;
    }

    void setSettingValue(SHOW_CONNECTION_STATUS_PILL_KEY, value);
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

  function resetToDefaults(): void {
    showSystemStatusButton.value = true;
    showConnectionStatusPill.value = true;
    showAdvancedSchemaGroups.value = false;
    newQueryTemplateSql.value = DEFAULT_NEW_QUERY_SQL;
  }

  return {
    showSystemStatusButton,
    showConnectionStatusPill,
    showAdvancedSchemaGroups,
    newQueryTemplateSql,
    resetToDefaults,
  };
});
