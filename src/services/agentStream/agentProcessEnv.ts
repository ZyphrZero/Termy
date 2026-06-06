/**
 * Build the environment passed to external ACP agent processes.
 *
 * Obsidian/Electron may run with Node/V8 flags that are valid for the
 * host process but hostile to npm-backed agent launchers. Do not leak
 * inherited NODE_OPTIONS into ACP children unless the user explicitly
 * configured it on that agent.
 */
export function buildAgentProcessEnv(
  baseEnv: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  removeInheritedNodeOptions(env);
  return overrides ? { ...env, ...overrides } : env;
}

function removeInheritedNodeOptions(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'node_options') {
      delete env[key];
    }
  }
}
