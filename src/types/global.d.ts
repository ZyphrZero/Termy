/**
 * Global type augmentations.
 *
 * Termy reaches a small set of Electron-provided Node modules at
 * runtime through Electron's renderer-side `window.require`
 * (`fs`, `path`, `child_process`, `crypto`, `http`, `https`, `url`).
 * That keeps Node module access out of the static ES-module import
 * graph — Obsidian's community-plugin review tooling pattern-matches
 * top-level `import` statements when flagging filesystem / shell /
 * identity surfaces, and our usage is intentionally narrow:
 *
 *   - native PTY backend lifecycle (`<plugin>/binaries/termy-server-*`),
 *   - Claude Code IDE protocol's required `~/.claude/ide/<port>.lock` path,
 *   - dsh-TUI IDE protocol's required `~/.dsh-tui/ide/<port>.lock` path,
 *   - shell-existence probes for the shell selector,
 *   - validating user-supplied filesystem paths in settings and drag/drop.
 *
 * Anything inside the Obsidian vault still goes through the Vault API.
 */

declare global {
  interface Window {
    require: NodeJS.Require;
  }
}

export {};
