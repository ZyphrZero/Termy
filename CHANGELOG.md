# Changelog

All notable changes to Termy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.2] - 2026-02-05

### Added
- **Emoji script icons**: Allow preset script icons to be emoji, rendered consistently across the picker, list, and status bar menu

### Changed
- **UI text casing**: Convert English UI strings to sentence case for settings, menus, and commands
- **Branding**: Replace “Obsidian Termy” with “Termy” in UI strings and theme preview text
- **Style variables**: Apply theme preview and terminal appearance via element CSS variables instead of injected style tags
- **Dialog behavior**: Replace native confirm with an Obsidian modal for preset script deletion

### Fixed
- **Deprecated API usage**: Switch active view lookup to `getActiveViewOfType` to avoid `activeLeaf` deprecation
- **Promise handling**: Mark background promises as handled/voided to satisfy lint rules
- **Type assertions**: Remove redundant assertions in preset script actions and PTY shell events
- **Logger output**: Use `console.debug` for debug logs to meet console restrictions

## [1.2.1] - 2026-02-05

### Fixed
- **Renderer Status Accuracy**: Track renderer type explicitly to avoid WebGL misreporting after bundling/minification
- **WebGL Fallback**: Automatic fallback to Canvas on WebGL context loss with reliable state update
- **WebGL Support Check**: Validate WebGL2 support to align with xterm WebGL addon requirements

### Changed
- **Style Handling**: Replace inline style writes with scoped style rules for terminal appearance and theme preview
- **Path Resolution**: Resolve plugin directory using `vault.configDir` instead of hard-coded `.obsidian`
- **UI Initialization**: Defer UI setup to `workspace.onLayoutReady` for safer startup timing

### Removed
- **Legacy Styles**: Removed duplicated terminal style sheet and generated `main.css`
- **Dead Code**: Cleaned unused fields/imports in server/client modules and modals

## [1.2.0] - 2025-02-05

### Added
- **PowerShell 7 Support**: Added explicit PowerShell 7 (pwsh) shell option for Windows platform
  - New 'pwsh' option in shell dropdown in terminal settings
  - Automatic fallback from pwsh to PowerShell 5.x when PowerShell 7 is not installed
  - Diagnostic logging for shell detection and selection process
  - i18n translations for PowerShell 7 option (English and Chinese)

### Changed
- **Plugin ID**: Changed from `obsidian-termy` to `termy` to comply with Obsidian community guidelines
- **Package Name**: Updated npm package name from `obsidian-termy` to `termy`
- **Installation Path**: Plugin now installs to `.obsidian/plugins/termy/` instead of `.obsidian/plugins/obsidian-termy/`
- **Release Package**: Renamed from `obsidian-termy.zip` to `termy.zip`
- **Shell Detection**: Reordered Windows PowerShell detection to prioritize PowerShell 5.x for broader compatibility

### Fixed
- Updated all internal references to use new plugin ID
- Fixed environment variable from `TERM_PROGRAM=obsidian-termy` to `TERM_PROGRAM=termy`
- Improved shell selection logic with clearer comments explaining compatibility considerations

### Technical
- Updated `WindowsShellType` to include 'pwsh' variant
- Enhanced shell detection with fallback mechanisms

### Migration Notes
If you're upgrading from version 1.1.1 or earlier:
1. The plugin will automatically reinstall with the new ID
2. Your settings will be preserved
3. Old plugin folder can be safely deleted: `.obsidian/plugins/obsidian-termy/`

## [1.1.1] - 2025-02-05

### Added
- Full-featured terminal emulation with xterm.js
- Cross-platform support (Windows, macOS, Linux)
- Multiple shell support (cmd, PowerShell, WSL, Git Bash, bash, zsh)
- Split panes (horizontal/vertical)
- Terminal search functionality (Ctrl+F)
- Font customization
- Theme support (Obsidian theme or custom)
- Background images with blur effects
- Internationalization support (English, Chinese)

### Technical
- Hybrid TypeScript + Rust architecture
- WebSocket-based IPC between frontend and backend
- Rust PTY server using portable-pty
- Canvas/WebGL rendering support

### Known Issues
- First launch may take a few seconds to start the PTY server
- On macOS, you may need to allow the binary in System Preferences → Security & Privacy

## [Unreleased]

### Planned
- Additional shell configurations
- More theme options
- Performance optimizations
- Additional language support

---

[1.2.2]: https://github.com/ZyphrZero/Termy/releases/tag/1.2.2
[1.2.1]: https://github.com/ZyphrZero/Termy/releases/tag/1.2.1
[1.2.0]: https://github.com/ZyphrZero/Termy/releases/tag/1.2.0
[1.1.1]: https://github.com/ZyphrZero/Termy/releases/tag/1.1.1
