import { BrowserQueryEngine } from "../platform/web/browser-query-engine";
import { TauriQueryEngine } from "../platform/desktop/tauri-query-engine";
import { detectRuntimeMode, type RuntimeMode } from "./runtime";
import type { QueryEngine } from "./query-engine";

let engine: QueryEngine | null = null;

export function getRuntimeMode(): RuntimeMode {
  return detectRuntimeMode();
}

export function getQueryEngine(): QueryEngine {
  if (!engine) {
    engine = detectRuntimeMode() === "desktop" ? new TauriQueryEngine() : new BrowserQueryEngine();
  }

  return engine;
}
