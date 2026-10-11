// Storybook 10 on builder-webpack5: `webpackFinal: (c) => withStuntDouble(c)` in .storybook/main.ts, TSX
// compiled by @storybook/addon-webpack5-compiler-babel. Fixture: examples/customer-storybook-webpack. The
// build is the real `storybook build` (webpack mode production, bail: true); the render probe opens the built
// story in headless Chromium. See tests/README.md and docs/tools/storybook.md.
import { defineToolSuite } from './harness/index.mjs';
import { storybookDevProbe } from './storybook-dev.mjs';

defineToolSuite({
  name: 'storybook-webpack',
  family: 'webpack',
  fixtureDir: 'examples/customer-storybook-webpack',
  toolConfig: '.storybook/main.ts',
  commands: {
    build: 'node probes/storybook.mjs build -o storybook-static --quiet',
    render: 'node probes/render.mjs storybook-static app-page--page',
  },
  outputs: ['storybook-static'],
  positive: { bundle: { files: 'storybook-static/*.js' }, alsoPass: ['check'] },
  unwired: { files: {}, command: 'node probes/storybook.mjs build -c .storybook-unwired -o storybook-static-unwired --quiet' },
  devProbe: storybookDevProbe({ configDir: '.storybook', builder: 'webpack' }),
  typescript5: true,
});
