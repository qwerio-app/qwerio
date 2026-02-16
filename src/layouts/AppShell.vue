<script setup lang="ts">
import AppSidebar from "../components/layout/AppSidebar.vue";
</script>

<template>
  <div
    class="mx-auto flex min-h-screen max-w-[1700px] gap-4 px-3 pb-4 pt-3 md:gap-5 md:px-5 md:pb-5 md:pt-5"
  >
    <AppSidebar />

    <div class="flex min-w-0 flex-1 flex-col gap-4 md:gap-5">
      <main
        class="panel flex min-h-[calc(100vh-140px)] flex-1 overflow-hidden p-3 md:p-4"
      >
        <RouterView />
      </main>
    </div>
  </div>
</template>
