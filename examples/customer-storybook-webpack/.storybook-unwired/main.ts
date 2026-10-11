import type { StorybookConfig } from '@storybook/react-webpack5';

// NEGATIVE FIXTURE (F6b): builder-webpack5 without withStuntDouble(): must fail on the registry placeholder.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  core: { disableTelemetry: true },
  framework: { name: '@storybook/react-webpack5', options: {} },
  addons: ['@storybook/addon-webpack5-compiler-babel'],
};
export default config;
