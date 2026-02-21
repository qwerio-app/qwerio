# Repository Guidelines

## Purpose and Scope

- Build and maintain a dual-mode database client with a consistent UX across desktop (Tauri) and web.
- Desktop mode supports native database access:
  - TCP-based drivers for Postgres, MySQL, SQL Server.
  - File-based SQLite connections.
- Web mode supports provider adapters only, never raw TCP.

## Project Structure and Module Organization

- `src/` contains the Vue 3 frontend.
- `src/components/` holds reusable UI by area (`layout/`, `security/`, `workbench/`), while pages live in `src/views/`.
- `src/stores/` contains Pinia stores, `src/router/` defines routes, and shared logic lives in `src/core/` and `src/lib/`.
- Browser persistence is centralized in `src/core/storage/indexed-db.ts` (Dexie + IndexedDB).
- Runtime-specific query adapters live in `src/platform/desktop/` and `src/platform/web/`.
- Desktop backend code is in `src-tauri/src/` (Rust + Tauri commands).
- Static assets are in `public/`; build outputs are `dist/` and `src-tauri/target/`.

## Runtime Architecture Rules

- Keep runtime boundaries explicit:
  - Desktop engine accepts only `desktop-tcp` profiles (including `dialect: "sqlite"` path-based profiles).
  - Browser engine accepts only `web-provider` profiles.
- Do not add browser fallbacks that attempt direct Postgres/MySQL/SQL Server sockets.
- Keep provider adapters isolated per provider.

## Storage Architecture Rules

- Use Dexie/IndexedDB for browser app persistence; do not use `useStorage()` or raw `localStorage` for app state.
- Keep the IndexedDB schema in `src/core/storage/indexed-db.ts` as the single source of truth.
- Current app database structure:
  - `connections`: persisted `ConnectionProfile` metadata and ordering.
  - `tabs`: unified tab records across scopes (`workbench`, `app`) with `type` limited to `query` or `table`.
  - `settings`: persisted UI/settings flags and templates.
  - `variables`: persisted singleton-like values (for example active tab IDs and vault envelope metadata).
- For app tabs, persist table/page-style tabs as `type: "table"` (never `type: "page"`).
- Persist only one global active app tab variable (`variables.appTabs.activeTabId`) as the source of truth for active tab state.
- Do not add backward-compatibility code for legacy localStorage keys unless explicitly requested.

## Current Connection and Provider Model

- Supported `ConnectionTarget` providers:
  - `desktop-tcp` for desktop (`dialect` supports `postgres`, `mysql`, `sqlserver`, `sqlite`).
    - For `sqlite`, use file-path style config with `database` only (no host/port/user).
  - `web-provider` `neon` (Postgres).
  - `web-provider` `proxy` (Postgres via proxy adapter).
  - `web-provider` `planetscale` (MySQL HTTP).
- For Neon/local Postgres web flows, support wsproxy-style endpoints (for example `localhost:6543`).
- Preserve both Postgres input modes in UI:
  - Connection string.
  - Separate host/port/database/user/password fields.

## Secrets and Security Rules

- `ConnectionProfile` stores metadata only. Never store plaintext credentials there.
- `ConnectionSecret` stores credentials and must stay type-aligned with the profile target/provider.
- Desktop secret storage must go through Tauri commands (`secret_store`, `secret_load`, `secret_delete`).
- SQLite desktop secrets should remain empty metadata-only payloads (no password field required).
- Web secrets must stay in encrypted vault flow (`src/core/secret-vault.ts`) and require unlock before use.
- Web vault envelope metadata is persisted in IndexedDB (`variables` table) under the existing vault key.
- On failure to save secret after creating/updating a profile, roll back profile changes where applicable.
- Never log raw passwords, connection strings, or decrypted secret payloads.

## Error Handling Rules

- Convert low-level transport/protocol errors into actionable user-facing messages.
- Include likely operator actions in failures for web Postgres/proxy paths:
  - Endpoint reachability from browser origin.
  - wsproxy `ALLOW_ADDR_REGEX`/target address mismatch.
  - Upstream DB auth/protocol mismatch.
- Avoid generic outputs such as `[object Event]`.

## Build, Test, and Development Commands

- `pnpm install`: install dependencies.
- `pnpm dev`: run the Vite web app locally.
- `pnpm build`: type-check (`vue-tsc --noEmit`) and produce production build.
- `pnpm preview`: preview the production web build.
- `pnpm tauri dev`: run the desktop app with Tauri.
- `pnpm tauri build`: build desktop binaries.
- `pnpm test`: run unit tests with Vitest.
- `cargo check --manifest-path src-tauri/Cargo.toml`: validate Rust/Tauri changes.

## Coding Style and Naming Conventions

- Use TypeScript strictness from `tsconfig.json`; keep code warning-free (`noUnusedLocals`, `noUnusedParameters`).
- Follow existing style: 2-space indentation, semicolons, and double quotes in TS/Vue scripts.
- Vue SFCs use PascalCase filenames (for example `ConnectionsView.vue`).
- Use descriptive kebab-case for utility/core files (for example `query-engine-service.ts`).
- Keep Tailwind usage aligned with shared design tokens and classes in `src/assets/main.css`.

## Tailwind 4.2 Rules

- The project is on Tailwind CSS `4.2.x`; do not downgrade or reintroduce v3 configuration patterns.
- Use Tailwind v4 CSS entrypoint style in `src/assets/main.css`: `@import "tailwindcss";` and `@config "../../tailwind.config.cjs";`.
- Do not use v3-only directives such as `@tailwind base`, `@tailwind components`, or `@tailwind utilities`.
- PostCSS integration must use `@tailwindcss/postcss` in `postcss.config.cjs` (do not switch back to `tailwindcss` plugin wiring).

## Testing Guidelines

- Primary frameworks are Vitest (`pnpm test`).
- Place unit tests as `*.test.ts` near the module under test (or under nearby `__tests__/`).
- Add e2e specs as `*.spec.ts` under `e2e/`.
- Prioritize coverage for:
  - Connection profile validation and store behavior.
  - Dexie persistence behavior for `connections`, `tabs`, `settings`, and `variables`.
  - Query-engine runtime routing (desktop vs web).
  - Provider adapter error handling and schema/query flows.
  - Vault unlock/lock behavior and secure secret reads/writes.

## Change Workflow

- Keep changes focused by concern (UI, stores, runtime adapter, or Tauri backend).
- If touching `src/platform/` or `src-tauri/`, run both JS and Rust checks before finalizing.
- When changing connection flows, verify:
  - Desktop connect + query:
    - TCP drivers (Postgres, MySQL, SQL Server).
    - SQLite file path (`dialect: "sqlite"`).
  - Web Neon/proxy connect + query.
  - Web vault locked/unlocked paths.
  - Edit existing connection without secret/profile mismatch.

## Commit and Pull Request Guidelines

- Use short, imperative, sentence-case commit summaries (for example `Fix proxy adapter ws endpoint handling`).
- Keep commits scoped and reviewable.
- PRs should include:
  - Purpose and key changes.
  - Test evidence (`pnpm build`, `pnpm test`, and when relevant `cargo check`).
  - Screenshots or recordings for UI changes.
  - Explicit platform impact when touching `src-tauri/` or runtime adapters.
