/**
 * Obsidian community plugin lint config.
 *
 * This config mirrors the rule set used by the community.obsidian.md
 * automated reviewer (the same `eslint-plugin-obsidianmd` recommended
 * preset that `community.obsidian.md` runs against every release),
 * plus the existing Microsoft SDL and typescript-eslint rules we
 * already enforce. Running `pnpm lint:obsidian` locally should now
 * surface the same findings the community scorecard reports.
 *
 * Tweaks vs. plain `recommendedWithLocalesEn`:
 *   - `obsidianmd/ui/sentence-case-locale-module` is configured with
 *     an extra `ignoreRegex` for the literal word `cursor`. The
 *     reviewer's brand list contains the IDE name "Cursor", so the
 *     unrelated terminal-caret strings ("Terminal cursor style",
 *     "Enable cursor blinking") trigger a false positive that this
 *     ignore pattern silences without weakening real sentence-case
 *     enforcement on the rest of the locale file.
 */

import obsidianmd from 'eslint-plugin-obsidianmd';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';
import globals from 'globals';

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

const obsidianRecommendedPlugins = Object.assign(
  {},
  ...obsidianmd.configs.recommendedWithLocalesEn.map((config) => config.plugins ?? {}),
);

export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      'scripts/',
      'main.js',
      'styles.css',
      'rust-servers/',
      'binaries/',
      'plugin-package/',
      'src/**/*.test.ts',
    ],
  },
  ...obsidianmd.configs.recommendedWithLocalesEn,
  {
    files: ['src/**/*.ts'],
    plugins: {
      '@microsoft/sdl': obsidianRecommendedPlugins['@microsoft/sdl'],
      '@typescript-eslint': tseslint.plugin,
      obsidianmd,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@microsoft/sdl/no-inner-html': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/require-await': 'error',
      'obsidianmd/ui/sentence-case-locale-module': [
        'warn',
        {
          // The default brand list from eslint-plugin-obsidianmd
          // contains the IDE name "Cursor", which collides with the
          // unrelated terminal-caret descriptions in this locale.
          // Allow `cursor` as a regular lowercase word.
          // ACP is the Agent Client Protocol and is conventionally
          // written in caps; allow the bare token in agent-related
          // command labels and notices.
          // OpenCode and Claude Code are agent brand names that the
          // panel surfaces verbatim — sentence-casing them would be
          // wrong.
          ignoreRegex: ['\\bcursor\\b', '\\bACP\\b', '\\bOpenCode\\b', '\\bClaude Code\\b'],
        },
      ],
    },
  },
];
