import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Next.js' recommended rules (React, hooks, accessibility, Core Web Vitals) plus TypeScript.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Reported, not blocking: every current case is deliberate (reading browser-only state such
      // as localStorage after mount, closing a drawer on navigation, a loading flag set before a
      // fetch). The cost is one extra render, not a wrong result. Reviewed 2026-11-01.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Other build folders (E2E, demo, audit servers), generated code, data and test artefacts.
    '.next-*/**',
    'src/generated/**',
    '.data/**',
    'storage/**',
    'backups/**',
    'playwright-report/**',
    'test-results/**',
    'audit/artifacts/**',
    'audit/perf/out/**',
    'audit/ux/out/**',
  ]),
]);

export default eslintConfig;
