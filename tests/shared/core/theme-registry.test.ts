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
    expect(isThemeId("unknown")).toBe(false);
    expect(normalizeThemeId("unknown")).toBe(DEFAULT_THEME_ID);
  });

  it("exposes stable labels and monaco theme mappings", () => {
    expect(themeOptions.map((option) => option.value)).toEqual([
      "graphite",
      "paper",
    ]);
    expect(getThemeLabel("graphite")).toBe("Graphite");
    expect(getThemeDefinition("paper").colorScheme).toBe("light");
    expect(getMonacoThemeId("graphite")).toBe("qwerio-graphite");
    expect(getMonacoThemeId("paper")).toBe("qwerio-paper");
  });
});
