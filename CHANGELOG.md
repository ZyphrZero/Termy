# Changelog

All notable changes to Termy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added a built-in Hermes Agent launcher to the workflow gallery, status bar menu, and command palette. The launcher detects the `hermes` CLI on PATH, surfaces install / update guidance for macOS, Linux, and Windows, and queries `https://api.github.com` for the latest `NousResearch/hermes-agent` release when **Check for AI launcher updates** is opted in.
- Added a built-in DeepSeek TUI launcher. The launcher detects the `deepseek` dispatcher on PATH, surfaces install / update guidance via `npm install -g deepseek-tui`, and queries `https://registry.npmjs.org` for the latest `deepseek-tui` release when update checks are opted in.

## [1.4.1] - 2026-05-16

### Fixed
- Fixed Ctrl+C and Ctrl+V not firing on consecutive presses while Ctrl was still held in PowerShell and other shells using win32 input mode. The same shortcut-suppression rule that previously broke repeat Shift+Enter newlines now keeps the trailing keyup of the chord suppressed but lets a fresh Ctrl+C or Ctrl+V keydown trigger another copy or paste.
- Fixed Termy's right-click menu stealing Claude Code's "right-click to paste" gesture. Active Claude Code TUI sessions now suppress the Termy menu so Claude Code's own paste fires once instead of being doubled by an extra Termy paste; other shells keep the Termy context menu, and Shift+RightClick always opens the Termy menu as an escape hatch.

## [1.4.0] - 2026-05-16

### Added
- Mapped each Termy version to the minimum Obsidian version it supports so the in-app updater only offers builds that match your installation.

### Changed
- Raised the minimum Obsidian version to 1.8.7 and refreshed the plugin description to match what Termy actually does today.
- Tuned terminal appearance handling so font, theme, and renderer changes apply to every open terminal the moment you save settings, and custom background colors and images now show through reliably across the canvas, WebGL, and DOM renderers.
- Reworked home-directory resolution so paths like `~/Documents` expand correctly on every platform, including profiles where the usual environment variables are not set.

## [1.3.7] - 2026-05-16

### Added
- Added a terminal context-menu action for switching the default shell straight from an open terminal.

### Changed
- Refreshed the README version badges and the project positioning copy.

### Fixed
- Fixed the "open in file manager" action opening the parent folder after `cd <subdir>`, so cmd, PowerShell, Git Bash, and WSL terminals now open the actual current folder.
- Fixed always-on-top terminals: the pinned window now stays scoped to its own terminal, new terminals open with the normal layout, and the pinned session can be returned to the main window without restarting.
- Fixed missing lock indicators on always-on-top terminal tabs and in the terminal right-click menu.
- Fixed Claude Code terminal titles being lost after a session, and cleared stale Claude Code drag references between sessions.
- Fixed terminal context menus drifting off-screen near the edge of the pane.
- Fixed missing translations on terminal notices, and corrected the Windows shell label to `CMD`.
- Fixed preset workflow pins not staying put, and reduced reconnect churn while the plugin reinstalls in development vaults.

### Removed
- Removed the automatic plugin disable / re-enable used by the settings reload button and the development install watcher. Reloading Termy now goes through Obsidian's normal plugin settings, in line with Obsidian's developer policy.

## [1.3.6] - 2026-05-14

### Fixed
- Fixed newline insertion (Shift+Enter, Ctrl+Enter, Alt+Enter) not working in Codex CLI sessions running under WSL2. The modifier+Enter combinations now bypass win32-input-mode encoding and send a real newline through the bracketed paste path so TUI programs correctly interpret it as a multiline edit.
- Fixed inability to insert consecutive newlines by holding Shift and pressing Enter repeatedly. The win32 shortcut suppression flag is no longer set for newline operations, allowing key-repeat to work as expected.

## [1.3.5] - 2026-05-07

### Added
- Added developer scrollback reproduction scripts for comparing synchronized redraw behavior across terminals and validating Termy's compatibility layer.

### Changed
- Split generic AI TUI synchronized-output compatibility helpers out of the Claude Code support module so terminal protocol boundaries are clearer.

### Fixed
- Preserved terminal scrollback more reliably for AI TUIs that redraw on the normal buffer in xterm.js hosts, including synchronized-output redraw flows that previously purged history in Termy.

## [1.3.4] - 2026-04-27

### Added
- Added a local Obsidian review lint command so community-review checks can run before publishing.

### Changed
- Updated English UI copy and README disclosures to align with Obsidian community review requirements.
- Upgraded Node type definitions to Node 20 and adjusted byte handling for stricter Buffer typing.

### Fixed
- Prevented redundant agent context snapshot writes when the active Obsidian context has not changed.
- Hardened IDE bridge message decoding and binary checksum hashing to use explicit byte handling.

## [1.3.3] - 2026-04-26

### Added
- Added OpenCode as a built-in workflow launcher with a dedicated icon and context-aware integration settings.
- Added OpenCode context handoff through Termy's IDE bridge so OpenCode sessions launched from Termy can inherit the active Obsidian workspace context.
- Added development auto-reload support so `pnpm install:dev <vault-path>` can refresh the running Termy plugin after copying updated assets.

### Changed
- Changed Codex context awareness to use a Termy-managed vault-local Skill while the built-in launcher starts `codex` directly.
- Kept Claude Code and OpenCode on the IDE bridge path while documenting Codex as the Skill-based integration.
- Normalized built-in workflow definitions from current defaults so saved built-ins pick up refreshed launcher commands and icons.

### Removed
- Removed Codex MCP auto-registration, global CLI configuration mutation, and the old launch-prompt context handoff path.
- Removed the legacy context instructions file path in favor of the single live context snapshot consumed by the Codex Skill.

## [1.3.2] - 2026-04-26

### Added
- Added selectable installed terminal shell programs, such as `tmux`, in terminal settings while keeping custom shell paths supported.
- Added Claude Code-aware file and folder drops that insert working-directory-relative `@path` references with safe quoting, directory trailing slashes, and trailing spacing.
- Added support for literal `file://` links in terminal output, complementing OSC 8 hyperlinks from Claude Code and other CLIs.
- Added Telegram community links in settings, README files, and generated release notes.

### Changed
- Improved Claude Code TUI compatibility by advertising Termy as an xterm.js host and handling terminal capability, extended keyboard, and OSC 52 clipboard flows expected by Claude Code.
- Improved release-note generation so generated notes use the correct changelog header format and include refreshed support links.

### Fixed
- Fixed WebSocket reconnect recovery so each open terminal recreates and rebinds its PTY session after reconnect, restoring keyboard input instead of leaving the pane attached to a stale session.
- Fixed Claude Code file hyperlinks and literal file URI output so matching files open inside Obsidian when possible.
- Fixed Claude Code drag-and-drop paths from Obsidian URIs with encoded separators and ampersands, and prevented basename-only folder drops from losing full path context.
- Fixed Windows Codex prompt redraw corruption by preventing duplicate IME/input events in Windows input mode.
- Fixed shell selection detection in Obsidian's renderer process and filtered GUI terminal apps out of the shell launcher list.
- Fixed local development install copying so plugin installs are more reliable when refreshing generated assets and native binaries.

## [1.3.1] - 2026-04-23

This section covers the combined changes shipped in versions `1.3.0-1.3.1`.

### Added
- Added terminal keyboard handling for multi-line `Shift+Enter`, using text insertion by default and Windows `win32-input-mode` when requested by the shell.
- Added Windows `win32-input-mode` keyboard encoding for printable keys, modifiers, navigation keys, function keys, lock-key state, and key release events.
- Added command palette actions to send the current editor selection, note content, or file path into the active terminal.
- Added clickable file references in terminal output so agent responses can open matching files directly from Obsidian.
- Added Claude Code context awareness so sessions launched from Termy can read the active Obsidian file and selection.
- Added Codex CLI context integration with optional auto-registration for the bundled `termy-context` MCP server.
- Added a server settings control to switch native binary downloads between GitHub Release and the built-in Cloudflare R2 mirror, plus a manual binary download trigger for on-demand checks and recovery.

### Changed
- Improved Windows terminal keyboard routing so PowerShell and other ConPTY-aware shells can opt into Win32 key event input instead of relying only on xterm-style input sequences.
- Reworked preset scripts into preset workflows with configurable action lists, including terminal commands, Obsidian command search, and external link actions.
- Standardized internal source comments to English across the TypeScript, CSS, and Rust codebases for easier maintenance.
- Streamlined agent handoffs by routing send and paste flows through terminal-owned APIs and focusing the receiving terminal after handoff.
- Expanded preset workflow controls with per-action enable toggles, notes, and built-in Claude Code and Codex CLI integration settings.
- Bundled the changelog into the plugin build so release notes can open reliably across BRAT and packaged installs, and moved the changelog shortcut beside the Termy title in settings.
- Added a dedicated Cloudflare R2 upload script and release workflow step so published binary artifacts are mirrored outside GitHub Releases.

### Fixed
- Merged community fix from [#3](https://github.com/ZyphrZero/Termy/pull/3) to bump the esbuild target to ES2021, preserving xterm's `requestMode()` handling and preventing TUI sessions such as Claude Code from freezing on DECRQM output, and added a bundle smoke check to catch regressions before packaging.
- Fixed a Windows keyboard handling crash while reading modifier and lock-key state for `win32-input-mode` events.
- Improved terminal drag-and-drop handling so dropped text and file paths resolve more reliably for agent and workflow launches.
- Fixed nested vault folder drags that could collapse into basename-only text such as `15040` instead of inserting the full absolute path into the terminal.
- Fixed same-name folder drags on Windows so dropped directories no longer resolve to folder-note markdown files instead of the dropped directory path.
- Updated the TypeScript project configuration away from deprecated compiler options and expanded binary download diagnostics to make update failures easier to troubleshoot.

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

[1.3.7]: https://github.com/ZyphrZero/Termy/releases/tag/1.3.7
[1.3.6]: https://github.com/ZyphrZero/Termy/releases/tag/1.3.6
[1.3.5]: https://github.com/ZyphrZero/Termy/releases/tag/1.3.5
[1.3.4]: https://github.com/ZyphrZero/Termy/releases/tag/1.3.4
[1.3.3]: https://github.com/ZyphrZero/Termy/releases/tag/1.3.3
[1.3.2]: https://github.com/ZyphrZero/Termy/releases/tag/1.3.2
[1.3.1]: https://github.com/ZyphrZero/Termy/releases/tag/1.3.1
[1.3.0]: https://github.com/ZyphrZero/Termy/releases/tag/1.3.0
[1.2.3]: https://github.com/ZyphrZero/Termy/releases/tag/1.2.3
[1.2.2]: https://github.com/ZyphrZero/Termy/releases/tag/1.2.2
[1.2.1]: https://github.com/ZyphrZero/Termy/releases/tag/1.2.1
[1.2.0]: https://github.com/ZyphrZero/Termy/releases/tag/1.2.0
[1.1.1]: https://github.com/ZyphrZero/Termy/releases/tag/1.1.1
