import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import {
  decryptConnectionPassword,
  getSecretPinStatus,
  lockSecretPin,
  unlockSecretPin,
} from "../core/secret-vault";
import type { EncryptedConnectionPassword } from "../core/types";
import { useConnectionsStore } from "./connections";

export type VaultStatus = {
  supported: boolean;
  initialized: boolean;
  unlocked: boolean;
};

export const useVaultStore = defineStore("vault", () => {
  const connectionsStore = useConnectionsStore();
  const status = ref<VaultStatus>({
    supported: false,
    initialized: false,
    unlocked: false,
  });
  const promptRequested = ref(false);
  const pendingEnvelope = ref<EncryptedConnectionPassword | null>(null);

  const hasEncryptedConnections = computed(() =>
    connectionsStore.profiles.some(
      (profile) => profile.credentials.storage === "encrypted",
    ),
  );

  const needsUnlockPrompt = computed(
    () => status.value.supported && promptRequested.value && !status.value.unlocked,
  );

  async function refreshStatus(): Promise<void> {
    const pinStatus = getSecretPinStatus();

    status.value = {
      supported: pinStatus.supported,
      initialized: hasEncryptedConnections.value,
      unlocked: pinStatus.unlocked,
    };

    if (!status.value.supported || status.value.unlocked) {
      promptRequested.value = false;
      pendingEnvelope.value = null;
    }
  }

  async function unlockWithPin(pin: string): Promise<void> {
    unlockSecretPin(pin);

    if (pendingEnvelope.value) {
      await decryptConnectionPassword(pendingEnvelope.value);
    }

    await refreshStatus();
  }

  function lock(): void {
    lockSecretPin();
    void refreshStatus();
  }

  function requestUnlockPrompt(envelope?: EncryptedConnectionPassword): void {
    if (!status.value.supported) {
      return;
    }

    pendingEnvelope.value = envelope ?? null;

    promptRequested.value = true;
  }

  watch(hasEncryptedConnections, () => {
    void refreshStatus();
  }, { immediate: true });

  return {
    status,
    needsUnlockPrompt,
    refreshStatus,
    unlockWithPin,
    lock,
    requestUnlockPrompt,
  };
});
