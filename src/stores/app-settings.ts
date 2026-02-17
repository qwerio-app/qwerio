import { defineStore } from "pinia";
import { useStorage } from "@vueuse/core";

const DEFAULT_NEW_QUERY_SQL = "select now();";

export const useAppSettingsStore = defineStore("app-settings", () => {
  const showSystemStatusButton = useStorage<boolean>(
    "qwerio.settings.showSystemStatusButton",
    true,
  );
  const showConnectionStatusPill = useStorage<boolean>(
    "qwerio.settings.showConnectionStatusPill",
    true,
  );
  const newQueryTemplateSql = useStorage<string>(
    "qwerio.settings.newQueryTemplateSql",
    DEFAULT_NEW_QUERY_SQL,
  );

  function resetToDefaults(): void {
    showSystemStatusButton.value = true;
    showConnectionStatusPill.value = true;
    newQueryTemplateSql.value = DEFAULT_NEW_QUERY_SQL;
  }

  return {
    showSystemStatusButton,
    showConnectionStatusPill,
    newQueryTemplateSql,
    resetToDefaults,
  };
});
