import tseslint from 'typescript-eslint';
import js from '@eslint/js';

export default [
  // JavaScript base rules (inherits ESLint recommended config)
  js.configs.recommended,

  // TypeScript/TSX file rules
  {
    files: ['src/**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        // Obsidian global variables
        ObsidianModAPI: 'readonly',
        requestUrl: 'readonly',
        // Browser environment (Obsidian Electron app environment)
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        navigator: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLButtonElement: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        DOMRect: 'readonly',
        ResizeObserver: 'readonly',
        SVGElement: 'readonly',
        SVGElementTagNameMap: 'readonly',
        Blob: 'readonly',
        MessageEvent: 'readonly',
        WheelEvent: 'readonly',
        DOMParser: 'readonly',
        atob: 'readonly',
        requestAnimationFrame: 'readonly',
        // Node.js environment (Electron main process communication)
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Buffer: 'readonly',
        WebSocket: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        URL: 'readonly',
        require: 'readonly',
        NodeJS: 'readonly',
      },
    },
    rules: {
      // TypeScript-related rules
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      // Disable unused variable checks (too strict for a plugin project under development)
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      // For Obsidian plugins, disable no-undef because browser/Node APIs are available in this environment
      'no-undef': 'off',
    },
  },

  // Ignore patterns
  {
    ignores: [
      'node_modules/',
      'dist/',
      '*.config.mjs',
      'scripts/',
      'main.js',
      'styles.css',
      'rust-servers/',
      'binaries/',
      'plugin-package/'
    ],
  },
];
