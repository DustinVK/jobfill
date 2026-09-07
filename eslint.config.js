import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-harness/**',
      'demo/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'src/shared/schema/*.gen.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Only entrypoints and the real adapters may name `browser.*`.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: [
      'src/shared/adapters/**',
      'src/background/index.ts',
      'src/content/index.ts',
      'src/content/auto-entry.ts',
      'src/options/main.tsx',
      'src/popup/main.tsx',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'browser',
          message: 'browser.* access must go through src/shared/adapters (CLAUDE.md invariant).',
        },
        {
          name: 'chrome',
          message: 'browser.* access must go through src/shared/adapters (CLAUDE.md invariant).',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.mjs', 'tests/harness/**/*.js'],
    rules: { 'no-console': 'off' },
  },
);
