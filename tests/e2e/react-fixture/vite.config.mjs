// Tiny React 19 app served by Vite in DEV mode for tests/e2e/react.mjs.
// The shared primitive lives in a sibling folder outside the Vite root (like a monorepo
// package), so its source URLs look like /@fs/<abs>/packages/ui/src/Text.tsx?t=…
import { defineConfig } from 'vite';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: join(here, 'web'),
  cacheDir: join(tmpdir(), 'redline-react-fixture-vite'),
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  server: {
    host: '127.0.0.1',
    fs: { allow: [join(here, 'web'), join(here, 'packages'), join(here, '../../..', 'node_modules')] },
  },
});
