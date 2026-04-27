import obsidianmd from 'eslint-plugin-obsidianmd';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';

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
    },
    rules: {
      '@microsoft/sdl/no-inner-html': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/require-await': 'error',
      'obsidianmd/ui/sentence-case-locale-module': 'error',
    },
  },
];
