import type { StorybookConfig } from '@storybook/react-vite';

// builder-vite loads ./vite.config.ts, which already has stuntDouble(): nothing stunt-double-specific here.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  core: { disableTelemetry: true },
  framework: { name: '@storybook/react-vite', options: {} },
};
export default config;
