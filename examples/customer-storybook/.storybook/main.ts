import type { StorybookConfig } from '@storybook/react-vite';

// No stunt-double line here: builder-vite picks up the plugin from vite.config.ts.
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx'],
  core: { disableTelemetry: true },
};

export default config;
