import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: ['.next/**', '.next-*/**', 'node_modules/**', 'public/**', 'next-env.d.ts', 'src/features/_generated.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Pages use plain <a> on purpose: the shared vanilla JS (app.js/pages.js) initialises per full page load.
      '@next/next/no-html-link-for-pages': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': ['error', { patterns: [
        { group: ['node:sqlite', 'node:fs', 'fs'], message: 'Only src/lib/db.ts, src/lib/crypto.ts, src/lib/workspace.ts and src/lib/env.ts may touch storage directly. Use Store.' },
      ] }],
    },
  },
  {
    // the storage layer itself, tests and scripts may use the builtins
    files: ['src/lib/db.ts', 'src/lib/crypto.ts', 'src/lib/workspace.ts', 'src/lib/env.ts', 'src/app/sw.js/route.ts', 'tests/**', 'scripts/**', 'src/instrumentation*.ts', 'next.config.mjs'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

export default config;
