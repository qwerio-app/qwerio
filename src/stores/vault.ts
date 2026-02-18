import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  getWebSecretVaultStatus,
  lockWebSecretVault,
  type WebVaultStatus,
  unlockWebSecretVault,
} from "../core/secret-vault";

export const useVaultStore = defineStore("vault", () => {
  const status = ref<WebVaultStatus>(getWebSecretVaultStatus());

  const needsUnlockPrompt = computed(
    () => status.value.supported && status.value.initialized && !status.value.unlocked,
  );

  function refreshStatus(): void {
    status.value = getWebSecretVaultStatus();
  }

  async function unlockWithPin(pin: string): Promise<void> {
    await unlockWebSecretVault(pin);
    refreshStatus();
  }

  function lock(): void {
    lockWebSecretVault();
    refreshStatus();
  }

  return {
    status,
    needsUnlockPrompt,
    refreshStatus,
    unlockWithPin,
    lock,
  };
});
