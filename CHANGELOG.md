# Changelog

All notable changes to Termy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Reworked preset scripts into preset workflows with configurable action lists, including terminal commands, Obsidian command search, and external link actions.
- Standardized internal source comments to English across the TypeScript, CSS, and Rust codebases for easier maintenance.

### Fixed
- Merged community fix from [#3](https://github.com/ZyphrZero/Termy/pull/3) to bump the esbuild target to ES2021, preserving xterm's `requestMode()` handling and preventing TUI sessions such as Claude Code from freezing on DECRQM output, and added a bundle smoke check to catch regressions before packaging.

## [1.2.3] - 2026-02-26

### Added
- Added a localized drag hint key for terminal drag-to-paste interactions.
- Added a custom Termy SVG ribbon icon for opening the terminal view.

### Changed
- Updated terminal drag hint copy to a consistent message: "Drag to paste file path".
- Expanded drop payload parsing to support file entries, URI payloads, Obsidian links, and vault-relative paths.
- Updated command and ribbon labels from "Open terminal" to "Open Termy terminal".
- Improved drag hint overlay transitions for clearer visual feedback.

### Fixed
- Improved dropped file absolute path resolution on desktop via Electron `webUtils`.
- Refined drag enter/leave depth tracking to prevent stale overlay visibility during nested drag events.

## [1.2.2] - 2026-02-05

### Added
- Added emoji support for preset script icons, rendered consistently across the picker, list, and status bar menu.
- Added Japanese (`ja`), Korean (`ko`), and Russian (`ru`) translations.

### Changed
- Converted English UI strings to sentence case for settings, menus, and commands.
- Replaced `Obsidian Termy` with `Termy` in UI strings and theme preview text.
- Applied theme preview and terminal appearance via element CSS variables instead of injected style tags.
- Replaced native confirm with an Obsidian modal for preset script deletion.
- Localized debug settings labels and notices.
- Updated preset script icon placeholder text to mention emoji support.
- Updated locale detection to follow the Obsidian language with base-language fallback.

### Fixed
- Switched active view lookup to `getActiveViewOfType` to avoid `activeLeaf` deprecation.
- Marked background promises as handled/voided to satisfy lint rules.
- Removed redundant assertions in preset script actions and PTY shell events.
- Updated debug logging to `console.debug` to meet console restrictions.
- Added explicit error handling when opening external links and file paths from terminal output.

## [1.2.1] - 2026-02-05

### Fixed
- Tracked renderer type explicitly to avoid WebGL misreporting after bundling/minification.
- Added automatic fallback to Canvas on WebGL context loss with reliable state updates.
- Validated WebGL2 support to align with xterm WebGL addon requirements.

### Changed
- Replaced inline style writes with scoped style rules for terminal appearance and theme preview.
- Resolved plugin directory using `vault.configDir` instead of hard-coded `.obsidian`.
- Deferred UI setup to `workspace.onLayoutReady` for safer startup timing.
- Optimized preset script icon loading with explicit named imports to improve tree-shaking and runtime lookup.

### Removed
- Removed duplicated terminal stylesheet and generated `main.css`.
- Cleaned unused fields and imports in server/client modules and modals.

## [1.2.0] - 2025-02-05

### Added
- Added explicit PowerShell 7 (`pwsh`) shell option for Windows platform.
- Added a new `pwsh` option to the shell dropdown in terminal settings.
- Added automatic fallback from `pwsh` to PowerShell 5.x when PowerShell 7 is not installed.
- Added diagnostic logging for shell detection and selection.
- Added i18n translations for the PowerShell 7 option in English and Chinese.

### Changed
- Changed plugin ID from `obsidian-termy` to `termy` to comply with Obsidian community guidelines.
- Updated npm package name from `obsidian-termy` to `termy`.
- Updated installation path to `.obsidian/plugins/termy/` instead of `.obsidian/plugins/obsidian-termy/`.
- Renamed release package from `obsidian-termy.zip` to `termy.zip`.
- Reordered Windows shell detection to prioritize PowerShell 5.x for broader compatibility.

### Fixed
- Updated all internal references to use the new plugin ID.
- Updated environment variable from `TERM_PROGRAM=obsidian-termy` to `TERM_PROGRAM=termy`.
- Improved shell selection logic with clearer compatibility comments.

### Technical
- Updated `WindowsShellType` to include `pwsh`.
- Enhanced shell detection with fallback mechanisms.

### Migration Notes
If you're upgrading from version 1.1.1 or earlier:
1. The plugin will automatically reinstall with the new ID.
2. Your settings will be preserved.
3. The old plugin folder can be safely deleted: `.obsidian/plugins/obsidian-termy/`.

## [1.1.1] - 2025-02-05

### Added
- Added full-featured terminal emulation with xterm.js.
- Added cross-platform support (Windows, macOS, Linux).
- Added support for multiple shells (cmd, PowerShell, WSL, Git Bash, bash, zsh).
- Added split panes (horizontal/vertical).
- Added terminal search functionality (`Ctrl+F`).
- Added font customization.
- Added theme support (Obsidian theme or custom).
- Added background images with blur effects.
- Added internationalization support (English, Chinese).

### Technical
- Adopted a hybrid TypeScript + Rust architecture.
- Used WebSocket-based IPC between frontend and backend.
- Implemented a Rust PTY server using portable-pty.
- Added Canvas/WebGL rendering support.

### Known Issues
- First launch may take a few seconds to start the PTY server.
- On macOS, you may need to allow the binary in System Preferences > Security & Privacy.

---

[Unreleased]: https://github.com/ZyphrZero/Termy/compare/1.2.3...HEAD
[1.2.3]: https://github.com/ZyphrZero/Termy/releases/tag/1.2.3
[1.2.2]: https://github.com/ZyphrZero/Termy/releases/tag/1.2.2
[1.2.1]: https://github.com/ZyphrZero/Termy/releases/tag/1.2.1
[1.2.0]: https://github.com/ZyphrZero/Termy/releases/tag/1.2.0
[1.1.1]: https://github.com/ZyphrZero/Termy/releases/tag/1.1.1
