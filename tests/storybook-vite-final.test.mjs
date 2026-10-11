// Storybook 10 on builder-vite with its OWN Vite config (vite.plain.config.ts, no plugin) and the plugin added
// in .storybook-vite-final/main.ts: `viteFinal: (c) => mergeConfig(c, { plugins: [stuntDouble()] })`.
// Fixture: examples/customer-storybook-vite. Family mutations edit vite.plain.config.ts, the config this
// Storybook loads.
import { defineToolSuite } from './harness/index.mjs';

defineToolSuite({
  name: 'storybook-vite-final',
  family: 'vite',
  fixtureDir: 'examples/customer-storybook-vite',
  toolConfig: 'vite.plain.config.ts',
  commands: {
    build: 'node probes/storybook.mjs build -c .storybook-vite-final -o storybook-static --quiet',
    render: 'node probes/render.mjs storybook-static app-page--page',
  },
  outputs: ['storybook-static'],
  positive: { bundle: { files: 'storybook-static/assets/*.js' } },
  unwired: { files: {}, command: 'node probes/storybook.mjs build -c .storybook-unwired -o storybook-static-unwired --quiet' },
});
