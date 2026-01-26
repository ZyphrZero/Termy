# Obsidian Terminal

A full-featured terminal plugin for Obsidian with xterm.js and Rust PTY backend.

## Features

- **Full Terminal Experience**: Powered by xterm.js with Canvas/WebGL rendering
- **Cross-Platform Support**: Works on Windows, macOS, and Linux
- **Multiple Shell Support**: 
  - Windows: cmd, PowerShell, WSL, Git Bash
  - macOS/Linux: bash, zsh, custom shells
- **Advanced Features**:
  - Split panes (horizontal/vertical)
  - Multiple terminal sessions
  - Search functionality
  - Font customization
  - Theme support (Obsidian theme or custom)
  - Background images with blur effects
- **Keyboard Shortcuts**:
  - Ctrl+O: Open terminal
  - Ctrl+Shift+R: Clear screen
  - Ctrl+Shift+C/V: Copy/Paste
  - Ctrl+F: Search
  - Ctrl+=/−/0: Zoom in/out/reset
  - Ctrl+Shift+H/J: Split horizontal/vertical

## Installation

### From Obsidian Community Plugins

1. Open Obsidian Settings
2. Go to Community Plugins
3. Search for "Terminal"
4. Click Install
5. Enable the plugin

### Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/ZyphrZero/Obsidian-Terminal/releases)
2. Extract the files to your vault's .obsidian/plugins/obsidian-terminal/ directory
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

## Usage

1. Press Ctrl+O or use the command palette to open a terminal
2. The terminal will start in your vault directory by default
3. Use the toolbar buttons or right-click menu for additional options

## Configuration

Access plugin settings in Obsidian Settings → Terminal to configure:

- Default shell and arguments
- Font size and family
- Cursor style and blinking
- Theme colors
- Background images
- Renderer type (Canvas/WebGL)
- Scrollback buffer size

## Development

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for build instructions and development guide.

## License

GPL-3.0 License - see [LICENSE](LICENSE) for details.

## Credits

- Built with [xterm.js](https://xtermjs.org/)
- PTY backend powered by [portable-pty](https://github.com/wez/wezterm/tree/main/pty)
- Inspired by various terminal emulators and Obsidian plugins

## Support

- Report issues: [GitHub Issues](https://github.com/ZyphrZero/Obsidian-Terminal/issues)
- Discussions: [GitHub Discussions](https://github.com/ZyphrZero/Obsidian-Terminal/discussions)
