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
- Theme architecture lives in:
  - `src/assets/themes/*.css` (one file per theme token set).
  - `src/assets/main.css` (shared semantic theme consumers and global styling).
  - `src/core/theme-registry.ts` (supported theme ids, labels, and Monaco metadata).
  - `src/stores/app-settings.ts` + `src/views/SettingsView.vue` (theme persistence and selection UI).
- Auth/login-specific frontend modules live in:
  - `src/components/layout/AppHeader.vue` (login/profile menu trigger and UX).
  - `src/stores/auth.ts` (auth session state and login actions).
  - `src/core/auth-api.ts` (Nest auth HTTP API client).
  - `src/core/auth-session.ts` + `src/core/auth-types.ts` (JWT session persistence/types).
- Connection password helpers live in:
  - `src/core/secret-vault.ts` (PIN unlock state + per-record encrypt/decrypt).
  - `src/core/connection-secrets.ts` (resolve password from plain/encrypted/none).
- Runtime-specific query adapters live in `src/platform/desktop/` and `src/platform/web/`.
- Desktop backend code is in `src-tauri/src/` (Rust + Tauri commands).
- Static assets are in `public/`; build outputs are `dist/` and `src-tauri/target/`.

## Runtime Architecture Rules

- Keep runtime boundaries explicit:
  - Desktop engine accepts only `desktop-tcp` profiles (including `dialect: "sqlite"` path-based profiles).
  - Browser engine accepts only `web-provider` profiles.
- Do not add browser fallbacks that attempt direct Postgres/MySQL/SQL Server sockets.
- Keep provider adapters isolated per provider.
- Proxy web-provider flows require authenticated JWT sessions; do not add unauthenticated proxy fallbacks.

## Storage Architecture Rules

- Use Dexie/IndexedDB for browser app persistence; do not use `useStorage()` or raw `localStorage` for app state.
- Keep the IndexedDB schema in `src/core/storage/indexed-db.ts` as the single source of truth.
- Current app database structure:
  - `connections`: persisted `ConnectionProfile` records and ordering.
  - `tabs`: unified tab records across scopes (`workbench`, `app`) with `type` limited to `query` or `table`.
  - `settings`: persisted UI/settings flags and templates.
  - `variables`: persisted singleton-like values (for example active tab IDs, active connection id, and auth session values).
- For app tabs, persist table/page-style tabs as `type: "table"` (never `type: "page"`).
- Persist only one global active app tab variable (`variables.appTabs.activeTabId`) as the source of truth for active tab state.
- Persist auth JWT session state under `variables.auth.session` (access token, expiry, and user payload).
- Do not store auth JWT in `localStorage`; keep browser persistence in IndexedDB (`variables` table).
- Do not add backward-compatibility code for legacy localStorage keys unless explicitly requested.
- Persist the selected UI theme under the `settings` table via `settings.themeId`; do not add theme persistence in `localStorage`.

## Theme Architecture Rules

- Current supported themes are:
  - `graphite`
  - `paper`
  - `nord`
  - `catppuccin`
  - `tokyo-night`
- Each theme must live in its own CSS file under `src/assets/themes/`.
- `src/core/theme-registry.ts` is the canonical source for supported theme ids, labels, and Monaco theme mappings.
- `src/assets/main.css` must stay theme-agnostic:
  - keep shared component classes and global rules there.
  - consume semantic CSS variables only.
  - do not add theme-specific hex values there.
- When adding a new theme:
  - create a new file in `src/assets/themes/`.
  - register the theme in `src/core/theme-registry.ts`.
  - import the theme file from `src/assets/main.css`.
  - provide Monaco theme colors through the registry.
- Do not hardcode component colors in Vue templates or shared CSS when a semantic theme token should be used instead.
- Keep third-party surfaces theme-aware:
  - Monaco editor.
  - AG Grid.
  - splitpanes.
  - scrollbars.
  - overlays and modal backdrops.
- Preserve the flat, minimalist styling direction:
  - no background gradients for app shell, panels/cards, headers, or buttons unless explicitly requested.

## Authentication and Login Rules

- Login entrypoint is the user/profile button in `src/components/layout/AppHeader.vue`.
- Backend integration targets the Nest API app at `/home/sergio/workspace/qwerio-api`.
- Supported login methods:
  - GitHub OAuth via `GET /auth/github` and callback token handling (web).
  - GitHub OAuth device flow via:
    - `POST /auth/github/device/start` (desktop challenge start).
    - `POST /auth/github/device/poll` (desktop challenge polling).
  - Email OTP via:
    - `POST /auth/email/request-otp` (email only).
    - `POST /auth/email/verify-otp` (email + 6-digit numeric OTP).
- Validate OTP as exactly 6 numeric digits in UI before verify requests.
- Use `GET /auth/me` with Bearer token to validate/hydrate stored sessions.
- Default frontend auth base URL is `/api` (Vite dev proxy to `http://localhost:3000`), overridable via `VITE_QWERIO_API_BASE_URL`.
- For GitHub callback flows, consume `accessToken` and `expiresAt` URL params, then strip them from the browser URL after hydration.

## Current Connection and Provider Model

- `ConnectionProfile` includes:
  - `type`: `"personal"` or `"team"` (UI renders separate sections; hide empty sections).
  - `target`: runtime/provider config.
  - `credentials`: password storage mode (`none`, `plain`, `encrypted`).
- Supported `ConnectionTarget` providers:
  - `desktop-tcp` for desktop (`dialect` supports `postgres`, `mysql`, `sqlserver`, `sqlite`).
    - For `sqlite`, use file-path style config with `database` only (no host/port/user).
  - `web-provider` `neon` (Postgres).
  - `web-provider` `proxy` (Postgres via proxy adapter).
  - `web-provider` `planetscale` (MySQL HTTP).
- For Postgres web providers (`neon`, `proxy`), persist `connectionStringTemplate` without password.
- For PlanetScale web provider, persist `username` in target and treat password via `credentials`.
- For Neon/local Postgres web flows, support wsproxy-style endpoints (for example `localhost:6543`).
- Preserve both Postgres input modes in UI:
  - Connection string.
  - Separate host/port/database/user/password fields.

## Secrets and Security Rules

- Password storage is record-level inside `ConnectionProfile.credentials`:
  - `storage: "none"`: no saved password; ask on connect and keep session-only.
  - `storage: "plain"`: store password as plaintext in the record.
  - `storage: "encrypted"`: store password as per-record envelope (`salt`, `iv`, `ciphertext`).
- PIN state is in-memory only; do not persist global vault envelopes or decrypted payloads.
- Request PIN only when opening an encrypted connection (not globally on startup).
- Desktop backend reads optional password from `db_connect` payload; do not reintroduce keyring secret commands for connection passwords.
- Treat JWT access tokens as sensitive secrets; never log raw token values.
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
- For themed UI work, prefer semantic CSS vars (`var(--chrome-...)`) over inline hardcoded colors in templates.

## Tailwind 4.2 Rules

- The project is on Tailwind CSS `4.2.x`; do not downgrade or reintroduce v3 configuration patterns.
- Use Tailwind v4 CSS entrypoint style in `src/assets/main.css`: `@import "tailwindcss";` and `@config "../../tailwind.config.cjs";`.
- Do not use v3-only directives such as `@tailwind base`, `@tailwind components`, or `@tailwind utilities`.
- PostCSS integration must use `@tailwindcss/postcss` in `postcss.config.cjs` (do not switch back to `tailwindcss` plugin wiring).

## Testing Guidelines

- Primary frameworks are Vitest (`pnpm test`).
- Place new unit tests under runtime roots (`tests/shared`, `tests/web`, `tests/desktop`).
- Add e2e specs as `*.spec.ts` under `e2e/`.
- Prioritize coverage for:
  - Connection profile validation and store behavior.
  - Connection type grouping (`personal`/`team`) and section visibility behavior.
  - Dexie persistence behavior for `connections`, `tabs`, `settings`, and `variables`.
  - Theme registry behavior, theme persistence, and theme-aware UI controls.
  - Query-engine runtime routing (desktop vs web).
  - Provider adapter error handling and schema/query flows.
  - Password resolution flow for `none`/`plain`/`encrypted`, including PIN-required errors.

## Test Organization Rules

- Runtime-separated unit test roots are required:
  - `tests/shared/**` for runtime-agnostic logic.
  - `tests/web/**` for browser-only logic (IndexedDB, web providers/adapters, browser crypto).
  - `tests/desktop/**` for desktop/Tauri runtime logic.
- Keep focus on high-value behavior:
  - Adapters and provider error mapping.
  - Runtime routing and query-engine boundaries.
  - Storage, auth session persistence, connection secrets, and encryption flows.
  - Key store behavior where persistence/runtime boundaries matter.
- Do not pursue exhaustive UI/button-level coverage unless explicitly requested.
- Use `pnpm test` as the single canonical unit-test command. It runs all runtime projects (`shared`, `web`, `desktop`).
- New tests should be added under runtime test roots (`tests/shared`, `tests/web`, `tests/desktop`) rather than colocated under `src/`.

## Change Workflow

- Keep changes focused by concern (UI, stores, runtime adapter, or Tauri backend).
- If touching `src/platform/` or `src-tauri/`, run both JS and Rust checks before finalizing.
- When changing connection flows, verify:
  - Desktop connect + query:
    - TCP drivers (Postgres, MySQL, SQL Server).
    - SQLite file path (`dialect: "sqlite"`).
  - Web Neon/proxy connect + query.
  - Auth flows:
    - GitHub login redirect + callback token hydration.
    - Email OTP request + 6-digit verify.
    - Session restoration from IndexedDB `variables.auth.session`.
  - `credentials.storage` modes:
    - `none` prompts for password when needed.
    - `plain` connects without PIN prompt.
    - `encrypted` prompts for PIN only when accessed.
  - Refresh/hydration paths:
    - Active connection restoration should not trigger unrelated PIN prompts.
    - Table tabs should load after hydration without false "Object tab not found" errors.
- When changing shared UI, verify the affected surfaces in the supported themes, especially:
  - `graphite` as the default baseline.
  - `paper` for light-theme contrast regressions.
  - any specialty theme directly affected by the change (`nord`, `catppuccin`, `tokyo-night`).

## Commit and Pull Request Guidelines

- Use short, imperative, sentence-case commit summaries (for example `Fix proxy adapter ws endpoint handling`).
- Keep commits scoped and reviewable.
- PRs should include:
  - Purpose and key changes.
  - Test evidence (`pnpm build`, `pnpm test`, and when relevant `cargo check`).
  - Screenshots or recordings for UI changes.
  - Explicit platform impact when touching `src-tauri/` or runtime adapters.
