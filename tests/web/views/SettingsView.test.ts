import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, onMounted } from "vue";
import type { ThemeId } from "../../../src/core/theme-registry";
import { themeOptions } from "../../../src/core/theme-registry";
import { useAppSettingsStore } from "../../../src/stores/app-settings";
import { useVaultStore } from "../../../src/stores/vault";

const {
  getSettingValueMock,
  setSettingValueMock,
  lockMock,
  refreshStatusMock,
} = vi.hoisted(() => ({
  getSettingValueMock: vi.fn(),
  setSettingValueMock: vi.fn(),
  lockMock: vi.fn(),
  refreshStatusMock: vi.fn(),
}));

vi.mock("../../../src/core/storage/indexed-db", () => ({
  getSettingValue: getSettingValueMock,
  setSettingValue: setSettingValueMock,
}));

vi.mock("../../../src/stores/vault", () => ({
  useVaultStore: () => ({
    status: {
      supported: false,
      initialized: false,
      unlocked: false,
    },
    refreshStatus: refreshStatusMock,
    lock: lockMock,
  }),
}));

const SettingsThemeHarness = defineComponent({
  name: "SettingsThemeHarness",
  setup() {
    const appSettingsStore = useAppSettingsStore();
    const vaultStore = useVaultStore();

    onMounted(() => {
      vaultStore.refreshStatus();
    });

    return () =>
      h("label", { class: "theme-control" }, [
        h("span", "Theme"),
        h(
          "select",
          {
            "aria-label": "Theme",
            value: appSettingsStore.themeId,
            onChange: (event: Event) => {
              const target = event.target;

              if (target instanceof HTMLSelectElement) {
                appSettingsStore.themeId = target.value as ThemeId;
              }
            },
          },
          themeOptions.map((themeOption) =>
            h("option", { value: themeOption.value }, themeOption.label),
          ),
        ),
      ]);
  },
});

describe("SettingsView theme selection", () => {
  async function flushAsyncWork(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    getSettingValueMock.mockReset();
    setSettingValueMock.mockReset();
    refreshStatusMock.mockReset();
    lockMock.mockReset();
    getSettingValueMock.mockImplementation(async (_key: string, fallback: unknown) => fallback);
    setSettingValueMock.mockResolvedValue(undefined);
  });

  it("updates the persisted theme selection", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    render(SettingsThemeHarness, {
      global: {
        plugins: [pinia],
      },
    });

    const store = useAppSettingsStore();

    await waitFor(() => {
      expect(store.themeId).toBe("graphite");
    });
    await flushAsyncWork();

    const select = screen.getByLabelText("Theme");
    await fireEvent.update(select, "paper");

    await waitFor(() => {
      expect(store.themeId).toBe("paper");
    });

    await waitFor(() => {
      expect(setSettingValueMock).toHaveBeenCalledWith(
        "settings.themeId",
        "paper",
      );
    });
    expect(refreshStatusMock).toHaveBeenCalled();
  });
});
