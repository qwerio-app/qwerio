import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  getWebSecretVaultStatus,
  lockWebSecretVault,
  type WebVaultStatus,
  unlockWebSecretVault,
} from "../core/secret-vault";

export const useVaultStore = defineStore("vault", () => {
  const status = ref<WebVaultStatus>({
    supported: false,
    initialized: false,
    unlocked: false,
  });
  const promptRequested = ref(false);

  const needsUnlockPrompt = computed(
    () =>
      status.value.supported &&
      ((status.value.initialized && !status.value.unlocked) ||
        (!status.value.initialized && promptRequested.value)),
  );

  async function refreshStatus(): Promise<void> {
    status.value = await getWebSecretVaultStatus();

    if (status.value.unlocked) {
      promptRequested.value = false;
    }
  }

  async function unlockWithPin(pin: string): Promise<void> {
    await unlockWebSecretVault(pin);
    await refreshStatus();
  }

  function lock(): void {
    lockWebSecretVault();
    void refreshStatus();
  }

  function requestUnlockPrompt(): void {
    if (!status.value.supported || status.value.unlocked) {
      return;
    }

    promptRequested.value = true;
  }

  void refreshStatus();

  return {
    status,
    needsUnlockPrompt,
    refreshStatus,
    unlockWithPin,
    lock,
    requestUnlockPrompt,
  };
});
