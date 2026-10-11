import type { StorybookConfig } from '@storybook/react-vite';

// NEGATIVE FIXTURE (F6b): a Storybook nobody wired. No stunt-double plugin, so @acme/core's sockets resolve
// to the @acme/core-slots registry placeholder and `storybook build` must fail; it must never render defaults.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  core: { disableTelemetry: true },
  framework: { name: '@storybook/react-vite', options: { builder: { viteConfigPath: 'vite.plain.config.ts' } } },
};
export default config;
