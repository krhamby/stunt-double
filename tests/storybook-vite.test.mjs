// Storybook 10 on builder-vite, plugin INHERITED from the app's vite.config.ts (the default setup: nothing
// stunt-double-specific in .storybook/main.ts). Fixture: examples/customer-storybook-vite. The build is the
// real `storybook build`; the render probe opens the built story in headless Chromium. See tests/README.md
// and docs/tools/storybook.md.
import { defineToolSuite } from './harness/index.mjs';
import { storybookDevProbe } from './storybook-dev.mjs';

defineToolSuite({
  name: 'storybook-vite',
  family: 'vite',
  fixtureDir: 'examples/customer-storybook-vite',
  toolConfig: 'vite.config.ts',
  commands: {
    build: 'node probes/storybook.mjs build -o storybook-static --quiet',
    render: 'node probes/render.mjs storybook-static app-page--page',
  },
  outputs: ['storybook-static'],
  positive: { bundle: { files: 'storybook-static/assets/*.js' }, alsoPass: ['check'] },
  unwired: { files: {}, command: 'node probes/storybook.mjs build -c .storybook-unwired -o storybook-static-unwired --quiet' },
  devProbe: storybookDevProbe({ configDir: '.storybook', builder: 'vite' }),
  typescript5: true,
});
