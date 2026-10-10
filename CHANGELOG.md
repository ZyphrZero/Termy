# Changelog

All notable changes to Termy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.2] - 2026-10-10

主题：**AI 启动器安装与版本诊断、Hermes / Pi / dsh-TUI 接入、公开终端 API，以及会话重连、输入与原生服务稳定性修复**。本版汇总 `1.4.1` 之后的改动，最低支持 Obsidian `1.8.7`。

### ✨ AI 启动器与安装诊断

- **新增 Hermes、Pi 与 dsh-TUI**：内置 `hermes`、`pi`、`dsh-tui` 工作流，可从工作流设置、状态栏菜单和命令面板启动；附带对应图标、平台安装说明与升级指引。
- **缺少 CLI 时直接查看安装方法**：工作流设置与状态栏菜单提供可复制的安装命令；需要 Node.js 的启动器同时显示运行环境要求，支持选择自定义 Node.js 可执行文件。
- **多安装与版本冲突诊断**：扫描 PATH、常见安装目录和 Node.js 版本管理器目录，展示可执行文件路径、版本及 PATH 优先级；只有发现不同版本时才标记冲突，检测不会自动修改本地安装。
- **手动刷新检测**：安装或升级 CLI 后，可在工作流设置重新检测启动器、Node.js 和 shell PATH，无需关闭并重新打开设置。命令发现改为读取 login-shell PATH，改善版本管理器安装的识别。
- **安装与升级完成验证**：shell 命令完成后重新探测版本，较慢的升级继续轮询；只有实际读到版本才报告成功，已打开的菜单同步更新状态。dsh-TUI 改为检测运行时 profile 版本，解决 profile 已升级但仍显示未完成的问题。
- **修复误报与路径问题**：修复启动时将 Codex CLI 误判为未安装的竞态；Windows 版本探测兼容空格和 shell 特殊字符路径，并等待输出流关闭后再解析版本。解析得到的 npm 路径仅用于自定义 Node.js 安装。
- **可选更新检查**：「检查 AI 启动器更新」默认关闭；开启后查询 npm 上的 Claude Code、Codex CLI、Pi、dsh-TUI，以及 GitHub 上的 OpenCode、Hermes 最新版本。离线模式下始终跳过这些请求。

### ✨ dsh-TUI 上下文桥接与公开终端 API

- **独立的 dsh-TUI protocol v2 IDE bridge**：通过 `~/.dsh-tui/ide/*.lock` 发布发现信息，并向 Termy 终端注入 `DSH_TUI_IDE_PORT` / `DSH_TUI_IDE_TOKEN`；通过仅限本机的 WebSocket 转发 Obsidian 编辑器选区，包括未保存的选区文本。
- **公开 terminal API v1**：其他 Obsidian 插件可通过 `api.createTerminal()` 创建终端，独立指定可执行程序、字面量参数、工作目录、标题和聚焦行为；返回的句柄支持写入输入、聚焦、改名与关闭。类型定义见 [`src/api.ts`](https://github.com/ZyphrZero/Termy/blob/master/src/api.ts)，接入说明见 [`docs/public-api.md`](https://github.com/ZyphrZero/Termy/blob/master/docs/public-api.md)。
- **修复上下文绝对路径**：Linux / macOS 的 vault 根目录不再被转换为相对路径，避免 Codex Skill 写入错误位置，以及上下文快照、IDE 锁文件中的工作区和笔记路径出错。参见 [PR #29](https://github.com/ZyphrZero/Termy/pull/29)。
- **IDE bridge 限制为本机连接**：Claude Code / OpenCode 的 WebSocket 桥接显式绑定 loopback 地址。参见 [PR #27](https://github.com/ZyphrZero/Termy/pull/27)。

### 🔧 原生终端服务与二进制管理

- **统一下载与移除入口**：服务设置集中显示本地安装状态、版本、可用操作和下载进度，支持刷新检测与离线提示；移除操作会先停止本地服务，再清理当前平台二进制和版本缓存，可用于故障恢复或磁盘清理。
- **下载校验与状态刷新**：外部文件变更后重新读取版本元数据；即使下载版本与目标一致，也必须通过 SHA-256 校验后才能安装。进行中的更新失败后，仍可执行本地文件清理。
- **修复重复下载路径**：保留 Linux / macOS 插件目录的绝对路径，同时兼容 Windows 盘符与 UNC 共享，避免二进制被写入重复拼接的相对目录。参见 [PR #26](https://github.com/ZyphrZero/Termy/pull/26)。
- **修复诊断输出导致服务崩溃**：stderr 管道断开、输出流写满或非阻塞写入失败时，不再触发进程 abort；日志恢复后报告遗漏的诊断，启动端口输出失败则返回明确错误。参见 [PR #30](https://github.com/ZyphrZero/Termy/pull/30)。

### 🛠 会话重连与终端输入修复

> 社区贡献：[PR #12](https://github.com/ZyphrZero/Termy/pull/12)，提交人 [@Burgerjoa](https://github.com/Burgerjoa)；[PR #17](https://github.com/ZyphrZero/Termy/pull/17)，提交人 [@ProjectAILeap](https://github.com/ProjectAILeap)。感谢贡献。

- **重连优先恢复原 PTY 会话**：WebSocket 重连时重新附着仍存活的 shell / TUI，保留会话与输入模式；原会话已结束或服务已重启时才创建新会话，并重置旧的终端模式，避免鼠标、替代屏幕或输入状态污染新 shell。参见 [PR #25](https://github.com/ZyphrZero/Termy/pull/25) 与 [PR #24](https://github.com/ZyphrZero/Termy/pull/24)。
- **重连提示本地化**：连接丢失、恢复中和恢复成功信息随插件语言显示。参见 [PR #23](https://github.com/ZyphrZero/Termy/pull/23)。
- **终端快捷键优先交给 TUI**：终端获得焦点时，避免 Obsidian 全局快捷键抢走 `Ctrl+B` 等按键，使 tmux 等程序能正常接收前缀键。来自 PR #17。
- **改善 Windows CJK 输入法兼容性**：组合输入期间交给 xterm.js 的 textarea / composition 流程处理，避免原始音节按键干扰；调整 ConPTY 输入路径与输入法样式，修复韩文等输入场景中的空格和布局异常。来自 PR #12。

### 🎨 工作流与显示体验

- **工作流菜单管理**：支持拖拽排序、直接编辑与删除自定义工作流，内置工作流受删除保护；多行提示展示工作流名称和已启用动作。
- **显示设置分区**：集中组织主题与外观设置，并补充背景图片的渲染器提示；改善 Canvas 渲染器下终端选区的对比度。
- **保留编辑器选区高亮**：从 CodeMirror 6 编辑器切换焦点到 Termy 时，已选文字仍保持可见高亮，方便将笔记片段交给终端中的 AI 工具。
- **进程标题同步**：支持 OSC 0/2 标题更新；用户自定义标题保持优先，不会被进程标题覆盖。
- **设置生命周期清理**：列表刷新或设置关闭时释放启动器徽章与渲染器订阅，关闭确认弹窗按取消处理；简化终端视图挂载和工作流设置渲染。

### 📦 构建与发布

- **构建来源证明**：发布流程为 `main.js` 和 `styles.css` 生成 GitHub build provenance attestation，便于核验产物来源。
- **Windows 开发安装**：通过 PowerShell 停止 Termy 服务进程，并明确报告停止失败；仅修改 TypeScript 时可使用 `pnpm install:dev <vault-path> --no-rust` 跳过原生后端重编译。
- **版本与兼容映射**：插件版本更新为 `1.4.2`，`versions.json` 保持最低 Obsidian 版本为 `1.8.7`，同步中英文 README 版本徽章。

### 📦 升级指南

1. **社区插件用户**：通过 Obsidian 的社区插件更新入口升级 Termy；使用 BRAT 的用户通过 BRAT 获取新标签版本。
2. **手动安装用户**：下载 `termy-1.4.2.zip` 完整包，或更新 `main.js`、`manifest.json`、`styles.css` 并配套当前平台的 `termy-server` 二进制。
3. **离线使用**：提前准备与 `1.4.2` 匹配的原生二进制；离线模式不会自动下载文件或检查 AI 启动器更新。遇到本地二进制状态异常时，可在服务设置中刷新检测，或移除后重新下载。

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
