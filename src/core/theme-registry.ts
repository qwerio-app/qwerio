export const themeIds = ["graphite", "paper"] as const;

export type ThemeId = (typeof themeIds)[number];

export type ThemeDefinition = {
  id: ThemeId;
  label: string;
  colorScheme: "dark" | "light";
  monaco: {
    id: string;
    base: "vs-dark" | "vs";
    colors: Record<string, string>;
  };
};

export const DEFAULT_THEME_ID: ThemeId = "graphite";
const PAPER_THEME_ID: ThemeId = "paper";

const themeDefinitions: Record<ThemeId, ThemeDefinition> = {
  graphite: {
    id: "graphite",
    label: "Graphite",
    colorScheme: "dark",
    monaco: {
      id: "qwerio-graphite",
      base: "vs-dark",
      colors: {
        "editor.background": "#0b0f16",
        "editor.lineHighlightBorder": "#161b24",
        "editorCursor.foreground": "#9ca1ad",
      },
    },
  },
  paper: {
    id: "paper",
    label: "Paper",
    colorScheme: "light",
    monaco: {
      id: "qwerio-paper",
      base: "vs",
      colors: {
        "editor.background": "#faf7f1",
        "editor.lineHighlightBorder": "#ddd5c8",
        "editorCursor.foreground": "#5d6570",
      },
    },
  },
};

export const themeOptions = themeIds.map((themeId) => ({
  value: themeId,
  label: themeDefinitions[themeId].label,
}));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && themeIds.includes(value as ThemeId);
}

export function normalizeThemeId(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME_ID;
}

export function getThemeDefinition(themeId: ThemeId): ThemeDefinition {
  return themeDefinitions[themeId];
}

export function getMonacoThemeId(themeId: ThemeId): string {
  return themeDefinitions[themeId].monaco.id;
}

export function getThemeLabel(themeId: ThemeId): string {
  return themeDefinitions[themeId].label;
}

export function applyThemeToDocument(themeId: ThemeId): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const normalizedThemeId = normalizeThemeId(themeId);
  const definition = getThemeDefinition(normalizedThemeId);

  root.dataset.theme = normalizedThemeId;
  root.style.colorScheme = definition.colorScheme;
}

export function getAlternateThemeId(themeId: ThemeId): ThemeId {
  return themeId === PAPER_THEME_ID ? DEFAULT_THEME_ID : PAPER_THEME_ID;
}
