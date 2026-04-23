<div align="center">

# Termy

<img src="assets/termy.svg" width="150" alt="Termy logo" />

*面向 Obsidian 桌面端的终端工作区插件*

Termy 为 Obsidian 提供完整终端体验：原生 Rust PTY 后端、分屏、多会话、可复用工作流、文件感知拖拽，以及面向 AI CLI 的上下文集成。

中文版 / [English](./README.md)

<p align="center">
  <img src="assets/termy-workspace-overview.png" width="980" alt="Termy 主工作区预览，包含 Obsidian、Codex CLI 和 Claude Code" />
</p>

</div>

## 为什么用 Termy

Termy 不是“把一个终端嵌进 Obsidian”这么简单，它更像是把命令行工作流真正带进了笔记环境。

- **原生 PTY 后端**：Rust 后端更轻量，不依赖额外桥接运行时。
- **真实终端体验**：基于 xterm.js，支持搜索、复制粘贴、提示符导航、分屏和多终端会话。
- **工作流启动器**：可从状态栏或命令面板执行终端命令、Obsidian 命令和外部链接组合工作流。
- **文件感知交互**：支持拖拽文本 / 文件 / 目录到终端，也支持从终端输出中直接点击文件引用返回 Obsidian。
- **AI 工作流友好**：可把当前笔记上下文传给 Claude Code 和 Codex CLI。
- **桌面端定制完善**：Shell 选择、分屏 / 新标签行为、主题同步、背景图、模糊、渲染器切换都可配置。

## 核心亮点

Termy 不只是一个终端面板，而是一套围绕 Obsidian 工作流设计的终端环境：

- **工作流驱动自动化**：支持可复用的预设工作流、多动作组合、启用开关、备注和终端启动控制。
- **AI 上下文接力**：支持 Claude Code 与 Codex CLI 在终端启动时继承当前笔记上下文。
- **编辑器到终端的快速发送**：可直接把当前选区、整篇笔记或当前路径推送到活动终端。
- **终端文件引用点击跳转**：工具、脚本或 AI 输出的路径可以快速回到对应文件。
- **对 Windows 输入更友好**：支持依赖原生按键事件的 `win32-input-mode`。
- **运维与分发控制**：支持内置更新日志查看，以及在 GitHub Releases 和 Cloudflare R2 之间切换原生二进制下载源。

## 你可以用它做什么

### 终端能力

- 在 Obsidian 内直接运行本地 shell，支持 Windows、macOS、Linux。
- Windows 可选 `cmd`、PowerShell、PowerShell Core、WSL、Git Bash、自定义 shell。
- macOS / Linux 可选 `bash`、`zsh`、自定义 shell。
- 新终端可以打开在：
  - 当前标签页
  - 新标签页
  - 左 / 右侧标签组
  - 水平 / 垂直分屏
  - 新窗口
- 可配置是否靠近已有终端创建、是否自动聚焦、是否默认锁定标签页。
- 支持终端搜索、清屏 / 清缓冲区、字号调整、复制粘贴等常用操作。

### 工作流与启动器

- 创建 **预设工作流**，每个工作流可以包含多个动作。
- 动作类型支持：
  - **终端命令**
  - **Obsidian 命令**
  - **外部链接**
- 工作流可从以下位置启动：
  - 状态栏菜单
  - 命令面板
  - 自动注册的工作流命令
- 每个工作流都可以配置：
  - 是否显示在状态栏菜单
  - 触发时是否自动打开终端
  - 是否每次都在新终端实例中运行
  - 是否给目标终端重命名
- 内置起步工作流包括 **Claude Code**、**Codex** 和 **Gemini CLI**。

<details>
<summary><strong>查看工作流界面</strong></summary>
<br />

<table>
  <tr>
    <td width="34%" align="center">
      <img src="assets/termy-statusbar-workflows.png" alt="Termy 状态栏工作流菜单" />
      <br />
      <sub>状态栏工作流启动菜单</sub>
    </td>
    <td width="66%" align="center">
      <img src="assets/termy-settings-workflows.png" alt="Termy 工作流设置界面，包含 Claude Code、Codex CLI 和 Gemini CLI 内置项" />
      <br />
      <sub>工作流配置、实例行为与内置启动项</sub>
    </td>
  </tr>
</table>

<p align="center">
  <img src="assets/termy-workflow-editor.png" width="900" alt="Termy 预设工作流编辑器，包含动作、备注与上下文感知设置" />
  <br />
  <sub>预设工作流编辑器，支持动作顺序、备注与上下文感知配置</sub>
</p>

</details>

### Obsidian 感知交互

- 将当前编辑器选区发送到终端。
- 将当前整篇笔记内容发送到终端。
- 将当前笔记路径发送到终端。
- 将文本、文件、目录拖拽到终端，自动粘贴文本或解析后的路径。
- 从终端输出中点击文件引用，直接打开匹配的库内文件或外部路径。
- 从命令面板或设置里打开内置更新日志。

### AI 与编码工作流集成

- **Claude Code 集成**：把当前 Obsidian 文件与选区暴露给 Claude 会话。
- **Codex CLI 集成**：可自动注册本地 MCP server `termy-context`。
- Codex 上下文快照可包含：
  - 当前活动文件
  - 当前选区
  - 已打开文件
  - vault / workspace 上下文
- 可在设置里自动保持 Codex MCP 注册、手动重注册，或移除该注册。

### 外观与体验

- 可跟随 Obsidian 主题，也可自定义前景 / 背景色。
- 支持 Canvas / WebGL 渲染；启用背景图时会自动回退到 Canvas。
- 支持配置背景图 URL / 路径、不透明度、尺寸、位置、模糊和文本透明度。
- 已支持英语、简体中文、日语、韩语、俄语界面。

<details>
<summary><strong>查看主题定制界面</strong></summary>
<br />

<p align="center">
  <img src="assets/termy-settings-theme.png" width="900" alt="Termy 主题设置界面，包含背景图、模糊和文字透明度控制" />
</p>

</details>

## 界面导览

<details>
<summary><strong>展开截图画廊</strong></summary>
<br />

<table>
  <tr>
    <td width="60%">
      <img src="assets/termy-workspace-overview.png" alt="Termy 完整工作区预览" />
    </td>
    <td width="40%">
      <img src="assets/termy-statusbar-workflows.png" alt="Termy 状态栏工作流菜单" />
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="assets/termy-settings-workflows.png" alt="Termy 通用设置与工作流管理界面" />
    </td>
    <td width="50%">
      <img src="assets/termy-settings-theme.png" alt="Termy 主题设置与背景图控制界面" />
    </td>
  </tr>
</table>

<p align="center">
  <img src="assets/termy-workflow-editor.png" width="900" alt="Termy 工作流编辑器预览" />
</p>

</details>

## 重点命令

Termy 不只提供“打开终端”这一条命令，比较常用的还有：

| 命令 | 作用 |
| --- | --- |
| `Open Termy terminal` | 按当前实例布局策略打开新终端 |
| `Termy: show changelog` | 打开内置更新日志弹窗 |
| `Terminal: split horizontal / split vertical` | 对活动终端进行分屏 |
| `Terminal: send selection` | 将当前编辑器选区发送到活动终端 |
| `Terminal: send current note` | 将当前整篇笔记内容发送到活动终端 |
| `Terminal: send current path` | 将当前文件路径发送到活动终端 |
| `Terminal: previous prompt / next prompt` | 在提示符历史之间导航 |
| `Terminal: last failed command` | 跳转到最近一次失败命令 |

## 安装

### 环境要求

- Obsidian 桌面端
- Windows / macOS / Linux 桌面系统

### 当前分发方式

目前 Termy **尚未进入官方 Obsidian Community Plugins 列表**，因此请通过 BRAT 或 GitHub Releases 手动安装。

### 使用 BRAT 安装

1. 先安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat)。
2. 打开 BRAT 设置，选择 **Add beta plugin**。
3. 输入 `ZyphrZero/Termy`。
4. 安装插件，并在 **设置 -> 社区插件** 中启用。

### 手动安装

1. 从 [GitHub Releases](https://github.com/ZyphrZero/Termy/releases) 下载最新发布包。
2. 解压到当前 vault 的 `.obsidian/plugins/termy/` 目录。
3. 重启或重新加载 Obsidian。
4. 在 **设置 -> 社区插件** 中启用 Termy。

## 快速上手

1. 通过左侧 ribbon、命令面板、空标签页按钮或状态栏打开 Termy。
2. 在设置里配置 shell、终端创建位置和外观。
3. 从状态栏菜单试运行内置工作流。
4. 用发送命令把当前选区、整篇笔记或当前路径推送到终端。
5. 拖一个文件或目录到终端，确认路径会被正确解析并插入。
6. 点击 AI 输出中的文件引用，直接跳回对应文件。

## 开发

<details>
<summary><strong>展开开发说明</strong></summary>
<br />

```bash
pnpm install
pnpm build
pnpm build:rust
pnpm package:zip
```

常用脚本：

- `pnpm dev`：前端构建 / 监听
- `pnpm build`：TypeScript 检查、生产构建、bundle smoke check
- `pnpm build:rust`：构建原生 PTY 后端
- `pnpm package:zip`：生成发布压缩包
- `pnpm install:dev`：构建并安装到本地开发 vault

</details>

## 架构概览

<details>
<summary><strong>展开架构说明</strong></summary>
<br />

- **前端**：TypeScript + Obsidian Plugin API + xterm.js
- **后端**：基于 `portable-pty` 的原生 Rust PTY server
- **上下文桥接**：
  - Claude Code IDE bridge
  - Codex CLI context bridge + 本地 MCP 注册

</details>

## 许可证

GPL-3.0。详见 [LICENSE](LICENSE)。

## 致谢

- [xterm.js](https://xtermjs.org/)
- [portable-pty](https://github.com/wez/wezterm/tree/main/pty)

## 支持

- 问题反馈：[GitHub Issues](https://github.com/ZyphrZero/Termy/issues)
- 讨论区：[GitHub Discussions](https://github.com/ZyphrZero/Termy/discussions)
