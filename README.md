# Qwerio

Dual-mode database manager scaffold built with Tauri + Vue.

## Current Scope

- Shared Vue app shell for desktop and web modes.
- Tailwind-based UI with a multi-pane SQL workbench.
- Runtime-aware query engine abstraction (`desktop` vs `web`).
- Connection manager with local persistence and schema/form validation.
- Monaco SQL editor, schema browser, AG Grid result table.
- Tauri command stubs for desktop query operations.

## Stack

- Vue 3 + TypeScript + Vite
- Tauri 2 (Rust)
- Tailwind CSS
- Pinia + Vue Router + TanStack Query
- Monaco Editor + AG Grid

## Run

```bash
pnpm install
pnpm dev
```

Desktop mode:

```bash
pnpm tauri dev
```

## Build

```bash
pnpm build
```

## Notes

- Browser mode is scaffolded for provider-based HTTP endpoints only.
- Desktop mode currently returns mock results through Tauri command stubs until native DB drivers are integrated.
