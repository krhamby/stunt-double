// Storybook 10 with builder-vite (stuntDouble() from stunt-double/vite, picked up from vite.config.ts). Fixture:
// examples/customer-storybook: one story renders the shared <App/>; `storybook build` writes storybook-static/,
// and the probe renders the story in Chromium (playwright-core). Runs the positive scenario, the per-tool
// scenarios of the shared catalogue, the Vite-family scenarios that apply and the universal tier.
import { defineToolSuite } from './harness/index.mjs';

/** A Storybook config dir whose builder-vite uses `viteConfig` instead of vite.config.ts. */
const storybookDir = (viteConfig) => `import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: { builder: { viteConfigPath: '${viteConfig}' } } },
  stories: ['../src/**/*.stories.tsx'],
  core: { disableTelemetry: true },
};

export default config;
`;

/** vite.config.ts without stunt-double (a config nobody wired, or the universal tier with a package link). */
const PLAIN_VITE = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()] });
`;

defineToolSuite({
  name: 'storybook',
  family: 'vite',
  fixtureDir: 'examples/customer-storybook',
  toolConfig: 'vite.config.ts',
  commands: {
    build: 'storybook build',
    render: 'node probes/render.mjs',
  },
  outputs: ['storybook-static'],
  positive: {
    bundle: { files: 'storybook-static/assets/*.js' },
    alsoPass: ['check'],
  },
  unwired: {
    files: { 'vite.unwired.config.ts': PLAIN_VITE, '.storybook-unwired/main.ts': storybookDir('vite.unwired.config.ts') },
    command: 'storybook build -c .storybook-unwired -o storybook-unwired',
  },
  expectations: {
    'F6c-ssr': 'a Storybook build has no SSR environment',
  },
  universal: {
    files: { 'vite.universal.config.ts': PLAIN_VITE, '.storybook-universal/main.ts': storybookDir('vite.universal.config.ts') },
    build: 'stunt-double check && storybook build -c .storybook-universal',
    bare: 'storybook build -c .storybook-universal',
  },
  timeout: 8 * 60_000,
});
