<script setup lang="ts">
import AppHeader from "../components/layout/AppHeader.vue";
import AppSidebar from "../components/layout/AppSidebar.vue";
import VaultUnlockOverlay from "../components/security/VaultUnlockOverlay.vue";
</script>

<template>
  <div
    class="mx-auto flex h-screen w-full flex-col gap-2 px-2 pb-2 pt-2 md:flex-row md:px-3"
  >
    <AppSidebar />

    <section class="flex min-h-0 flex-1 flex-col gap-2">
      <AppHeader />

      <main class="panel min-h-0 flex-1 overflow-hidden p-2 md:p-2.5">
        <RouterView />
      </main>
    </section>

    <VaultUnlockOverlay />
  </div>
</template>
