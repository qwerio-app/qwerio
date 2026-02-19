# Repository Guidelines

## Purpose and Scope

- Build and maintain a dual-mode database client with a consistent UX across desktop (Tauri) and web.
- Desktop mode supports direct TCP database access.
- Web mode supports provider adapters only, never raw TCP.

## Project Structure and Module Organization

- `src/` contains the Vue 3 frontend.
- `src/components/` holds reusable UI by area (`layout/`, `security/`, `workbench/`), while pages live in `src/views/`.
- `src/stores/` contains Pinia stores, `src/router/` defines routes, and shared logic lives in `src/core/` and `src/lib/`.
- Runtime-specific query adapters live in `src/platform/desktop/` and `src/platform/web/`.
- Desktop backend code is in `src-tauri/src/` (Rust + Tauri commands).
- Static assets are in `public/`; build outputs are `dist/` and `src-tauri/target/`.

## Runtime Architecture Rules

- Keep runtime boundaries explicit:
  - Desktop engine accepts only `desktop-tcp` profiles.
  - Browser engine accepts only `web-provider` profiles.
- Do not add browser fallbacks that attempt direct Postgres/MySQL sockets.
- Keep provider adapters isolated per provider.

## Current Connection and Provider Model

- Supported `ConnectionTarget` providers:
  - `desktop-tcp` for desktop.
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
- Web secrets must stay in encrypted vault flow (`src/core/secret-vault.ts`) and require unlock before use.
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

## Testing Guidelines

- Primary frameworks are Vitest (`pnpm test`) and Playwright (`pnpm test:e2e`).
- Place unit tests as `*.test.ts` near the module under test (or under nearby `__tests__/`).
- Add e2e specs as `*.spec.ts` under `e2e/`.
- Prioritize coverage for:
  - Connection profile validation and store behavior.
  - Query-engine runtime routing (desktop vs web).
  - Provider adapter error handling and schema/query flows.
  - Vault unlock/lock behavior and secure secret reads/writes.

## Change Workflow

- Keep changes focused by concern (UI, stores, runtime adapter, or Tauri backend).
- If touching `src/platform/` or `src-tauri/`, run both JS and Rust checks before finalizing.
- When changing connection flows, verify:
  - Desktop TCP connect + query.
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
