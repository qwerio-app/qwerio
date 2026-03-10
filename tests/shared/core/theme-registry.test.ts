import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  getMonacoThemeId,
  getThemeDefinition,
  getThemeLabel,
  isThemeId,
  normalizeThemeId,
  themeOptions,
} from "../../../src/core/theme-registry";

describe("theme registry", () => {
  it("recognizes valid theme ids and normalizes unknown values", () => {
    expect(isThemeId("graphite")).toBe(true);
    expect(isThemeId("paper")).toBe(true);
    expect(isThemeId("nord")).toBe(true);
    expect(isThemeId("catppuccin")).toBe(true);
    expect(isThemeId("tokyo-night")).toBe(true);
    expect(isThemeId("unknown")).toBe(false);
    expect(normalizeThemeId("unknown")).toBe(DEFAULT_THEME_ID);
  });

  it("exposes stable labels and monaco theme mappings", () => {
    expect(themeOptions.map((option) => option.value)).toEqual([
      "graphite",
      "paper",
      "nord",
      "catppuccin",
      "tokyo-night",
    ]);
    expect(getThemeLabel("graphite")).toBe("Graphite");
    expect(getThemeLabel("nord")).toBe("Nord");
    expect(getThemeLabel("catppuccin")).toBe("Catppuccin");
    expect(getThemeLabel("tokyo-night")).toBe("Tokyo Night");
    expect(getThemeDefinition("paper").colorScheme).toBe("light");
    expect(getMonacoThemeId("graphite")).toBe("qwerio-graphite");
    expect(getMonacoThemeId("paper")).toBe("qwerio-paper");
    expect(getMonacoThemeId("nord")).toBe("qwerio-nord");
    expect(getMonacoThemeId("catppuccin")).toBe("qwerio-catppuccin");
    expect(getMonacoThemeId("tokyo-night")).toBe("qwerio-tokyo-night");
  });
});
