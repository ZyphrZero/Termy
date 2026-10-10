# Public terminal API

Other Obsidian desktop plugins can use `app.plugins.getPlugin('termy').api` to open Termy terminals. API version 1 supports a new terminal tab with a per-terminal executable, literal arguments, working directory, and title. It returns a handle after both the native PTY and terminal view are ready.

## Accessing the API

Obsidian's plugin registry is not included in its public TypeScript definitions. Use a narrow local type for accessing the registry, and check that Termy is enabled and exposes the expected API version. The supported Termy contract is in [`src/api.ts`](../src/api.ts); copy its types into your integration or vendor that file as a type-only dependency. Do not import Termy's runtime implementation or depend on private services.

```ts
import type { App } from 'obsidian';
import type { TermyApi } from './vendor/termy-api';

function getTermyApi(app: App): TermyApi | undefined {
  const appWithPlugins = app as App & {
    plugins?: { getPlugin(id: string): unknown };
  };
  const plugin = appWithPlugins.plugins?.getPlugin('termy');
  if (!plugin || typeof plugin !== 'object' || !('api' in plugin)) return;
  const api = plugin.api;
  if (!api || typeof api !== 'object' || !('version' in api) || api.version !== 1
    || !('createTerminal' in api) || typeof api.createTerminal !== 'function') return;
  return api as TermyApi;
}

const api = getTermyApi(this.app);
if (!api) throw new Error('Enable a version of Termy that supports public API v1');

const terminal = await api.createTerminal({
  executable: 'tmux',
  args: ['new-session', '-A', '-s', 'project-a'],
  cwd: '/projects/project-a',
  title: 'Project A',
  focus: true,
});

terminal.setTitle('Project A — terminal');
await terminal.focus();
// To send input, explicitly include the Enter character when appropriate:
terminal.write('pwd\r');
// Close only when your integration intends to close the user's terminal:
await terminal.close();
```

Use an executable installed on the user's host OS. `tmux` and `zmx` are external programs; Termy does not install or manage their named sessions. On Windows, use a host executable such as `wsl.exe` with its own arguments to run a program inside WSL; `cwd` still refers to a host directory.

## Creation options

| Option | Behavior when supplied | Default when omitted |
| --- | --- | --- |
| `executable` | An unquoted executable path or a name on the native server's PATH, launched directly through the PTY. | Termy's configured platform shell and custom shell path. |
| `args` | Literal argv entries, including empty strings. `[]` clears configured arguments. Do not quote or join them into a shell command. | `[]` for a supplied executable; configured shell arguments otherwise. |
| `cwd` | Working directory for this terminal. Use an absolute path on the host OS. | Vault directory when auto-enter-vault is enabled, otherwise the native backend's inherited directory. |
| `title` | Custom tab title that process title escape sequences cannot overwrite. | Termy's automatic terminal title. |
| `focus` | Activate and focus the new tab when `true`; leave it in the background when `false`. | Termy's focus-new-instance preference. |

Termy always creates a fresh tab for API calls, inherits appearance and pin-new-instance preferences, and keeps global shell settings unchanged. Creation options and argument arrays are copied before asynchronous initialization. Concurrent launches are serialized because the PTY protocol currently supports one pending initialization at a time.

## Handle and errors

| Member | Behavior |
| --- | --- |
| `id` | Stable terminal instance ID for this handle's lifetime. |
| `isClosed` | Becomes `true` when the tab is closed or Termy unloads. Process exit alone leaves the tab open so its output can be read. |
| `getTitle()` / `setTitle(title)` | Read or change the custom tab title. |
| `write(data)` | Send raw input, without appending Enter or applying paste formatting. Throws when closed, disconnected, or the process has exited. |
| `focus()` | Reveal and focus the terminal's current tab, including after window moves. |
| `close()` | Destroy the PTY and close its tab. Repeated and concurrent calls are safe. |

Invalid options, missing executables, invalid working directories, native server failures, view initialization failures, and plugin unload during creation reject the creation promise. Partial terminals are cleaned up. Handle operations after closure throw, except `close()`, which is idempotent. Handle focus and close operations return promises; handle write and title operations are synchronous.

Handles are in-memory references. They do not survive plugin reload or Obsidian restart. API launch options are not persisted into the workspace layout, and reopening a saved terminal tab uses Termy's regular defaults. Closing a Termy terminal is not a guarantee that an external session manager destroys its named session; that behavior belongs to the external program.
