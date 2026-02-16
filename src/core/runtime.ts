export type RuntimeMode = "desktop" | "web";

export function detectRuntimeMode(): RuntimeMode {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return "desktop";
  }

  return "web";
}
