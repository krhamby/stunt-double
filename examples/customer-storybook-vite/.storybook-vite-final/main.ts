import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import { stuntDouble } from 'stunt-double/vite';

// Storybook with its own Vite config that lacks the plugin: add stuntDouble() in viteFinal.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  core: { disableTelemetry: true },
  framework: { name: '@storybook/react-vite', options: { builder: { viteConfigPath: 'vite.plain.config.ts' } } },
  viteFinal: (c) => mergeConfig(c, { plugins: [stuntDouble()] }),
};
export default config;
