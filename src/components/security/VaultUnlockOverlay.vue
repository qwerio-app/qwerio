<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Lock } from "lucide-vue-next";
import VaultPinInput from "./VaultPinInput.vue";
import { useVaultStore } from "../../stores/vault";

const vaultStore = useVaultStore();
const pin = ref("");
const feedback = ref("");
const isSubmitting = ref(false);
const isPinComplete = computed(() => pin.value.length === 5);
const isInitializingVault = computed(
  () => vaultStore.needsUnlockPrompt && !vaultStore.status.initialized,
);

onMounted(() => {
  vaultStore.refreshStatus();
});

async function unlockVault(): Promise<void> {
  if (isSubmitting.value) {
    return;
  }

  feedback.value = "";

  if (!isPinComplete.value) {
    feedback.value = "Enter your full 5-digit PIN.";
    return;
  }

  isSubmitting.value = true;

  try {
    await vaultStore.unlockWithPin(pin.value);
    pin.value = "";
  } catch (error) {
    feedback.value =
      error instanceof Error
        ? error.message
        : isInitializingVault.value
          ? "Unable to initialize encrypted password PIN."
          : "Unable to unlock encrypted password PIN.";
  } finally {
    isSubmitting.value = false;
  }
}

watch(pin, (value, previousValue) => {
  if (
    value.length === 5 &&
    value !== previousValue &&
    !isSubmitting.value &&
    vaultStore.needsUnlockPrompt
  ) {
    void unlockVault();
  }
});
</script>

<template>
  <div
    v-if="vaultStore.needsUnlockPrompt"
    class="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(7,9,13,0.92)] p-4 backdrop-blur-sm"
  >
    <section class="panel w-full max-w-sm text-center p-4 md:p-5">
      <div class="flex justify-center items-center gap-2">
        <Lock :size="16" class="text-[var(--chrome-red)]" />
        <h2
          class="font-display text-xl font-semibold tracking-[0.05em] text-[var(--chrome-ink)]"
        >
          {{ isInitializingVault ? "Initialize Vault" : "Unlock Vault" }}
        </h2>
      </div>

      <p class="mt-2 text-xs text-[var(--chrome-ink-dim)]">
        {{
          isInitializingVault
            ? "Create a 5-digit PIN to initialize encrypted connection passwords."
            : "Enter your 5-digit PIN to unlock encrypted connection passwords."
        }}
      </p>

      <form
        class="mt-4 flex flex-col items-center gap-5"
        @submit.prevent="unlockVault"
      >
        <VaultPinInput
          v-model="pin"
          :label="isInitializingVault ? 'Create connection PIN' : 'Unlock connection PIN'"
          :disabled="isSubmitting"
          :autofocus="true"
        />
        <button
          type="submit"
          class="chrome-btn chrome-btn-primary whitespace-nowrap"
          :disabled="isSubmitting || !isPinComplete"
        >
          {{
            isSubmitting
              ? isInitializingVault
                ? "Initializing..."
                : "Unlocking..."
              : isInitializingVault
                ? "Initialize"
                : "Unlock"
          }}
        </button>
      </form>

      <p v-if="feedback" class="mt-3 text-xs text-[var(--chrome-yellow)]">
        {{ feedback }}
      </p>
    </section>
  </div>
</template>
