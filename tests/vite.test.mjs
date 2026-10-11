// Vite 8 + Vitest 5: the reference suite. Fixture: examples/customer-vite (wraps Button, replaces PriceTag with
// a memo() component, provides the required Logo). Runs the positive scenario, the shared mutation catalogue
// (tests/mutations), the Vite-family scenarios, a live dev-server probe, the type gate under TypeScript 5.9,
// and the universal tier. See tests/README.md.
import { defineToolSuite, viteDevProbe } from './harness/index.mjs';

// The same app built by Vite WITHOUT the stunt-double plugin: what a second, forgotten config looks like.
const UNWIRED_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A second Vite config that never got the stunt-double plugin (e.g. a docs site or a one-off script).
export default defineConfig({ plugins: [react()] });
`;

// Universal tier: no adapter at all, the socket resolves through the package link. SSR keeps the SDK in the
// bundle (noExternal), as any SSR setup of an ESM-only, JSX-shimmed SDK must.
const UNIVERSAL_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], ssr: { noExternal: ['@acme/core'] } });
`;
const UNIVERSAL_BUILD = 'vite build --config vite.universal.config.ts && vite build --config vite.universal.config.ts --ssr src/entry-server.tsx --outDir dist-ssr';

// Mistakes Vitest must also refuse at startup (the plugin validates when Vitest loads vite.config).
const ALSO_VITEST = ['F2a', 'F3a', 'F4', 'F5a', 'F7b'];

defineToolSuite({
  name: 'vite',
  family: 'vite',
  fixtureDir: 'examples/customer-vite',
  toolConfig: 'vite.config.ts',
  commands: {
    build: 'vite build && vite build --ssr src/entry-server.tsx --outDir dist-ssr',
    render: 'node probes/render.mjs',
    test: 'vitest run',
  },
  outputs: ['dist', 'dist-ssr'],
  positive: {
    bundle: { files: 'dist/assets/*.js' },
    alsoPass: ['check', 'test'],
  },
  unwired: {
    files: { 'vite.unwired.config.ts': UNWIRED_CONFIG },
    command: 'vite build --config vite.unwired.config.ts',
  },
  expectations: (m) => {
    if (ALSO_VITEST.includes(m.id)) return { also: [{ command: 'test' }] };
    return undefined;
  },
  devProbe: viteDevProbe({ entry: '/src/entry-server.tsx' }),
  typescript5: true,
  universal: {
    files: { 'vite.universal.config.ts': UNIVERSAL_CONFIG },
    build: `stunt-double check && ${UNIVERSAL_BUILD}`,
    bare: UNIVERSAL_BUILD,
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b'],
  },
});
