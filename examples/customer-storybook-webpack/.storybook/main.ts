import type { StorybookConfig } from '@storybook/react-webpack5';
import { withStuntDouble } from 'stunt-double/webpack';

// builder-webpack5: add the stunt-double alias, validation, audit and (in `storybook build`) the type gate.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  core: { disableTelemetry: true },
  framework: { name: '@storybook/react-webpack5', options: {} },
  addons: ['@storybook/addon-webpack5-compiler-babel'],
  webpackFinal: (c) => withStuntDouble(c),
};
export default config;
