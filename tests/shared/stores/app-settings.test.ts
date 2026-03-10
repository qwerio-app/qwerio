import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { getSettingValueMock, setSettingValueMock } = vi.hoisted(() => ({
  getSettingValueMock: vi.fn(),
  setSettingValueMock: vi.fn(),
}));

vi.mock("../../../src/core/storage/indexed-db", () => ({
  getSettingValue: getSettingValueMock,
  setSettingValue: setSettingValueMock,
}));

import { DEFAULT_THEME_ID } from "../../../src/core/theme-registry";
import { useAppSettingsStore } from "../../../src/stores/app-settings";

const THEME_ID_KEY = "settings.themeId";

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("app settings store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getSettingValueMock.mockReset();
    setSettingValueMock.mockReset();
    getSettingValueMock.mockImplementation(async (_key: string, fallback: unknown) => fallback);
    setSettingValueMock.mockResolvedValue(undefined);
  });

  it("hydrates the default theme when nothing is stored", async () => {
    const store = useAppSettingsStore();
    await flushAsyncWork();

    expect(store.themeId).toBe(DEFAULT_THEME_ID);
  });

  it("restores the stored theme id", async () => {
    getSettingValueMock.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === THEME_ID_KEY) {
        return "paper";
      }

      return fallback;
    });

    const store = useAppSettingsStore();
    await flushAsyncWork();

    expect(store.themeId).toBe("paper");
  });

  it("persists theme updates after hydration", async () => {
    const store = useAppSettingsStore();
    await flushAsyncWork();

    store.themeId = "paper";
    await flushAsyncWork();

    expect(setSettingValueMock).toHaveBeenCalledWith(THEME_ID_KEY, "paper");
  });

  it("resets the theme back to graphite", async () => {
    const store = useAppSettingsStore();
    await flushAsyncWork();

    store.themeId = "paper";
    await flushAsyncWork();

    store.resetToDefaults();
    await flushAsyncWork();

    expect(store.themeId).toBe(DEFAULT_THEME_ID);
    expect(setSettingValueMock).toHaveBeenCalledWith(THEME_ID_KEY, DEFAULT_THEME_ID);
  });
});
