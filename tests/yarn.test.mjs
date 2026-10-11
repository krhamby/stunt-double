// Yarn 4 Plug'n'Play: the Vite reference fixture (examples/customer-vite) installed with Yarn (nodeLinker: pnp, the
// default), running the whole shared catalogue, the Vite-family scenarios, the TypeScript 5.9 type gate and the
// universal tier with Yarn's link form ("portal:./sdk-slots"). Needs Yarn 4 on PATH (CI: corepack).
// TypeScript 7 cannot resolve modules under PnP ([TS-PNP]), so the main runs use the fixture with TypeScript 5.9
// (Yarn patches the dependency named "typescript"), and the TypeScript 5.9 block runs the documented setup for a
// project that keeps TypeScript 7: the patched alias "typescript5" + config "typescript": "typescript5".
// See docs/tools/package-managers.md.
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
  name: 'yarn',
  pm: 'yarn',
  family: 'vite',
  fixtureDir: 'examples/customer-vite',
  toolConfig: 'vite.config.ts',
  commands: {
    build: 'vite build && vite build --ssr src/entry-server.tsx --outDir dist-ssr',
    render: 'node probes/render.mjs',
    test: 'vitest run',
  },
  // The fixture stands in for the registry's placeholder peer with npm "overrides", which Yarn ignores (and Yarn
  // never auto-installs peers). A direct dependency on the placeholder tarball is what a Yarn project adds to get
  // STUNT-DOUBLE-NOT-WIRED from unwired tools; the universal tier replaces it with the link.
  addDependencies: { '@acme/core-slots': `file:${path.join(PACKS_DIR, 'acme-core-slots-0.0.1.tgz')}` },
  addDevDependencies: { typescript: '5.9.3' },
  outputs: ['dist', 'dist-ssr'],
  positive: { bundle: { files: 'dist/assets/*.js' }, alsoPass: ['check'] },
  unwired: { files: { 'vite.unwired.config.ts': UNWIRED_CONFIG }, command: 'vite build --config vite.unwired.config.ts' },
  expectations: {
    // PnP's resolver reports the placeholder's poison import itself (still fails, still names the fix)
    'F6b-node': { messages: [/Qualified path resolution failed/, /STUNT-DOUBLE-NOT-WIRED/] },
    // not a residual: the mistake cannot happen here. tests/package-managers.test.mjs asserts that this SDK builds
    // and renders the overrides correctly under Yarn.
    F8: 'Yarn ignores bundleDependencies: the 1.0.0-nested-react SDK resolves the app\'s single React, so there is no duplicate to catch',
  },
  typescript5: { spec: 'patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>' },
  universal: {
    pm: 'yarn',
    files: { 'vite.universal.config.ts': UNIVERSAL_CONFIG },
    build: `stunt-double check && ${UNIVERSAL_BUILD}`,
    bare: UNIVERSAL_BUILD,
    mutations: ['F1a', 'F2a', 'F3a', 'F4', 'F5a', 'F6g', 'F7b'],
  },
});
