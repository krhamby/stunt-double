// Vite 8 + Vitest 5 installed with Yarn 4 Plug'n'Play: no node_modules, packages read from zip archives, strict
// dependency boundaries. Fixture: examples/customer-yarn-pnp (customer-vite plus "packageManager", .yarnrc.yml and
// typescript@5.9 as the project's "typescript": TypeScript 7.0 cannot resolve under PnP, and Yarn patches only the
// package named "typescript" for PnP).
// Every command runs through `corepack yarn` (the PnP runtime). See tests/README.md.
import { defineToolSuite } from './harness/index.mjs';

process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
const Y = 'corepack yarn';

const UNWIRED_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()] });
`;
const UNIVERSAL_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], ssr: { noExternal: ['@acme/core'] } });
`;
const UNIVERSAL_BUILD = `${Y} vite build --config vite.universal.config.ts && ${Y} vite build --config vite.universal.config.ts --ssr src/entry-server.tsx --outDir dist-ssr`;

defineToolSuite({
  name: 'vite-yarn-pnp',
  pm: 'yarn',
  family: 'vite',
  fixtureDir: 'examples/customer-yarn-pnp',
  toolConfig: 'vite.config.ts',
  commands: {
    build: `${Y} vite build && ${Y} vite build --ssr src/entry-server.tsx --outDir dist-ssr`,
    render: `${Y} node probes/render.mjs`,
    check: `${Y} stunt-double check`,
    test: `${Y} vitest run`,
  },
  outputs: ['dist', 'dist-ssr'],
  positive: {
    bundle: { files: 'dist/assets/*.js' },
    alsoPass: ['check', 'test'],
  },
  unwired: {
    files: { 'vite.unwired.config.ts': UNWIRED_CONFIG },
    command: `${Y} vite build --config vite.unwired.config.ts`,
  },
  expectations: {
    // Yarn installs no peers, so a tool or process nobody wired fails on Yarn's own missing-peer error instead of
    // the registry placeholder's poison: still a resolve error, never SDK defaults.
    'F6b-config': { messages: [/STUNT-DOUBLE-NOT-WIRED|tried to access @acme\/core-slots \(a peer dependency\)/] },
    // plain `node` has no PnP runtime and could not resolve @acme/core at all: run it the way a PnP project does
    'F6b-node': {
      run: `${Y} node --input-type=module -e "const m = await import('@acme/core'); console.log('RENDERED-DEFAULTS', Object.keys(m).join(','))"`,
      messages: [/STUNT-DOUBLE-NOT-WIRED|tried to access @acme\/core-slots \(a peer dependency\)/],
    },
  },
  universal: {
    pm: 'yarn',
    files: { 'vite.universal.config.ts': UNIVERSAL_CONFIG },
    build: `${Y} stunt-double check && ${UNIVERSAL_BUILD}`,
    bare: UNIVERSAL_BUILD,
  },
  timeout: 8 * 60_000,
});
