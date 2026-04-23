# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the TypeScript Obsidian plugin. Use `src/services/` for runtime and integration logic (`terminal/`, `server/`, `codexCli/`, `context/`), `src/ui/` for views and modals, `src/settings/` for settings models/renderers, `src/i18n/` for locales, and `src/utils/` for shared helpers. The native PTY backend lives in `rust-servers/`. Generated plugin assets are emitted at the repo root as `main.js` and `styles.css`; native binaries are copied to `binaries/`. Supporting docs and screenshots live in `docs/` and `assets/`.

## Build, Test, and Development Commands
- `pnpm dev` builds the plugin in development mode.
- `pnpm build` runs TypeScript checks, bundles the plugin, and smoke-checks the generated bundle.
- `pnpm build:rust` builds the current-platform `termy-server` into `binaries/`.
- `pnpm test:terminal` compiles the test TS config and runs the terminal-layer Node tests.
- `cargo test --manifest-path rust-servers/Cargo.toml` runs Rust unit tests.
- `pnpm install:dev <vault-path>` builds both layers and installs the plugin into an Obsidian vault for manual verification.

## Coding Style & Naming Conventions
Match the existing codebase: 2-space indentation in TypeScript and 4 spaces in Rust. TypeScript is `strict`-oriented; keep single quotes, semicolons, and explicit types where they improve clarity. Use `PascalCase` for classes and UI types, `camelCase` for functions and variables, and descriptive lower-camel-case filenames such as `terminalPathUtils.ts` or `settingsTab.ts`. Run `pnpm exec eslint src --ext .ts` before submitting changes.

## Testing Guidelines
Keep tests close to the code they cover as `*.test.ts`; script-level tests live in `scripts/*.test.js`. The repo uses Node's built-in `node:test` and `assert/strict` for TS/JS tests, plus standard Rust `#[test]` modules under `rust-servers/src/`. There is no enforced coverage threshold, so add focused regression tests for terminal input/output, path handling, changelog parsing, and server routing whenever behavior changes.

## Commit & Pull Request Guidelines
Commit subjects must start with a Conventional Commit type such as `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`, `perf:`, `style:`, or `revert:`. Optional scopes are encouraged when they improve clarity, for example `feat(terminal):`, `fix(settings):`, or `chore(assets):`. An optional emoji may precede the type when it adds signal without replacing the required prefix, for example `✨ feat: add workflow gallery`, `🐛 fix(terminal): resolve folder drops`, or `🧹 chore: rename screenshot assets`. Keep commit subjects short, imperative, and specific. PRs should summarize user-visible impact, list local verification steps, link related issues, and include screenshots or short recordings for UI changes. If packaging, release notes, or versioned behavior changes, update `CHANGELOG.md` so release automation can map the correct version section.
