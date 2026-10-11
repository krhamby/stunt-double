// Vite 8 + Vitest 5 installed with pnpm (strict, symlinked node_modules) instead of npm: the same fixture
// (examples/customer-vite) and the per-tool scenarios of the shared catalogue. The universal tier uses pnpm's
// "link:" form (a "file:" dependency would be a stale copy, which the wiring self-test rejects). See
// tests/README.md.
import path from 'node:path';
import { PACKS_DIR } from './harness/util.mjs';
import { defineToolSuite } from './harness/index.mjs';

const UNWIRED_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()] });
`;
const UNIVERSAL_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], ssr: { noExternal: ['@acme/core'] } });
`;
const UNIVERSAL_BUILD = 'vite build --config vite.universal.config.ts && vite build --config vite.universal.config.ts --ssr src/entry-server.tsx --outDir dist-ssr';

defineToolSuite({
  name: 'vite-pnpm',
  pm: 'pnpm',
  family: 'vite',
  fixtureDir: 'examples/customer-vite',
  toolConfig: 'vite.config.ts',
  // npm's "overrides" stand in for the registry in the fixture; with pnpm, the placeholder is a direct dependency
  // (what pnpm's auto-installed peer from the registry amounts to)
  addDependencies: { '@acme/core-slots': `file:${path.join(PACKS_DIR, 'acme-core-slots-0.0.1.tgz')}` },
  commands: {
    build: 'vite build && vite build --ssr src/entry-server.tsx --outDir dist-ssr',
    render: 'node probes/render.mjs',
    test: 'vitest run',
  },
  outputs: ['dist', 'dist-ssr'],
  // the installed SDK's layout is pnpm's own: also run the dist scan (F6a) and the singleton preflight (F8)
  mutations: (list, all) => [...list, ...all.filter((m) => m.tags.includes('sdk-bug'))],
  positive: {
    bundle: { files: 'dist/assets/*.js' },
    alsoPass: ['check', 'test'],
  },
  unwired: {
    files: { 'vite.unwired.config.ts': UNWIRED_CONFIG },
    command: 'vite build --config vite.unwired.config.ts',
  },
  universal: {
    pm: 'pnpm',
    files: { 'vite.universal.config.ts': UNIVERSAL_CONFIG },
    build: `stunt-double check && ${UNIVERSAL_BUILD}`,
    bare: UNIVERSAL_BUILD,
  },
});
