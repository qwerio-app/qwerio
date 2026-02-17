import { defineStore } from "pinia";
import { useStorage } from "@vueuse/core";

export const useUiStore = defineStore("ui", () => {
  const sidebarCollapsed = useStorage<boolean>("qwerio.ui.sidebarCollapsed", false);

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  return {
    sidebarCollapsed,
    toggleSidebar,
  };
});
