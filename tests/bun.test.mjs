// Bun 1.4 as the package manager: the Vite reference fixture (examples/customer-vite) installed with `bun install`,
// running the whole shared catalogue, the Vite-family scenarios, the TypeScript 5.9 type gate and the universal tier with
// Bun's link form ("workspace:*" + "workspaces"). Needs Bun 1.4 on PATH. See docs/tools/package-managers.md.
import path from 'node:path';
import { defineToolSuite } from './harness/index.mjs';
import { PACKS_DIR } from './harness/util.mjs';

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
  name: 'bun',
  pm: 'bun',
  family: 'vite',
  fixtureDir: 'examples/customer-vite',
  toolConfig: 'vite.config.ts',
  commands: {
    build: 'vite build && vite build --ssr src/entry-server.tsx --outDir dist-ssr',
    render: 'node probes/render.mjs',
    test: 'vitest run',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: { bundle: { files: 'dist/assets/*.js' }, alsoPass: ['check'] },
  unwired: { files: { 'vite.unwired.config.ts': UNWIRED_CONFIG }, command: 'vite build --config vite.unwired.config.ts' },
  typescript5: true,
  universal: {
    pm: 'bun',
    files: { 'vite.universal.config.ts': UNIVERSAL_CONFIG },
    build: `stunt-double check && ${UNIVERSAL_BUILD}`,
    bare: UNIVERSAL_BUILD,
    mutations: ['F1a', 'F2a', 'F3a', 'F4', 'F5a', 'F6g', 'F7b', 'F8'],
  },
});
