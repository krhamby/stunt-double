// Astro 7 (static output, React islands): examples/customer-astro under `astro build` and `astro dev`. The page
// renders the app/sdk sections server-side and a client:load island; the render probe reads dist/index.html.
// Every expectation was observed for real; see docs/tools/astro.md. Run: npm test -- astro
import { defineToolSuite } from './harness/index.mjs';
import { frameworkDevProbe } from './frameworks/dev.mjs';

// Astro has no top-level Vite options: the Vite-family scenarios edit the `vite: { ... }` block instead of the
// top of the config object.
const intoViteBlock = (snippet) => (fx, suite) => fx.edit(suite.toolConfig, (s) => s.replace(/\bvite\s*:\s*\{/, (m) => `${m} ${snippet},`));
const ASTRO_VITE = {
  'F6c-ssr': intoViteBlock(`ssr: { external: ['@acme/core'] }`),
  'F6g-alias': intoViteBlock(`resolve: { alias: [{ find: /^@acme\\/core-slots\\/Button$/, replacement: '@acme/core/original/Button' }] }`),
};

const UNWIRED_CONFIG = `import { defineConfig } from 'vite';

export default defineConfig({ build: { outDir: 'dist-unwired', rolldownOptions: { input: 'src/components/App.tsx' } } });
`;

defineToolSuite({
  name: 'astro',
  family: 'vite',
  fixtureDir: 'examples/customer-astro',
  toolConfig: 'astro.config.mjs',
  commands: {
    build: 'astro build',
    render: 'node probes/render.mjs',
    typecheck: 'tsc --noEmit -p .',
  },
  outputs: ['dist', '.astro', 'dist-unwired'],
  positive: {
    bundle: { files: 'dist/_astro/*.js' },
    alsoPass: ['check', 'typecheck'],
  },
  unwired: {
    files: { 'vite.unwired.config.mjs': UNWIRED_CONFIG },
    command: 'vite build --config vite.unwired.config.mjs',
  },
  mutations: (list) => list.map((m) => (ASTRO_VITE[m.id] ? { ...m, apply: ASTRO_VITE[m.id] } : m)),
  // Astro 7 runs `astro dev` as a background daemon with JSON logs when it detects an AI-agent shell;
  // ASTRO_DEV_BACKGROUND=0 keeps the foreground server a person gets.
  devProbe: frameworkDevProbe({
    command: 'astro dev',
    env: { ASTRO_DEV_BACKGROUND: '0', ASTRO_TELEMETRY_DISABLED: '1' },
    forbidLog: /optimizer-tripwire|Failed to run dependency scan/,
  }),
});
