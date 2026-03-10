<script setup lang="ts">
import { watch } from "vue";
import { applyThemeToDocument } from "./core/theme-registry";
import { useAppSettingsStore } from "./stores/app-settings";

const appSettingsStore = useAppSettingsStore();

watch(
  () => appSettingsStore.themeId,
  (themeId) => {
    applyThemeToDocument(themeId);
  },
  { immediate: true },
);
</script>

<template>
  <RouterView />
</template>
