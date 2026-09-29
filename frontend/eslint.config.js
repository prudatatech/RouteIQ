import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import design from './eslint-rules/design-guardrails.js';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Legacy debt: the codebase makes pervasive use of `any` (external APIs, map/geo
      // libraries, event payloads). Downgraded to `warn` rather than fixed wholesale to
      // avoid a large, risky refactor; new code should still avoid introducing it.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow intentionally-unused bindings (params, destructured values, caught errors)
      // when prefixed with `_`, the standard convention for "required but unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // The whole app is on the shared theme (Phase 7). The design rules are errors
    // everywhere so they can't drift back in.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { design },
    rules: {
      'design/no-off-theme-classes': 'error',
      'design/no-inline-visual-style': 'error',
    },
  },
);
