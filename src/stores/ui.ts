import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { getSettingValue, setSettingValue } from "../core/storage/indexed-db";

const SIDEBAR_COLLAPSED_KEY = "settings.ui.sidebarCollapsed";

export const useUiStore = defineStore("ui", () => {
  const sidebarCollapsed = ref(false);
  const hasHydrated = ref(false);

  void (async () => {
    sidebarCollapsed.value = await getSettingValue(SIDEBAR_COLLAPSED_KEY, false);
    hasHydrated.value = true;
  })();

  watch(sidebarCollapsed, (value) => {
    if (!hasHydrated.value) {
      return;
    }

    void setSettingValue(SIDEBAR_COLLAPSED_KEY, value);
  });

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  return {
    sidebarCollapsed,
    toggleSidebar,
  };
});
