import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { withStuntDouble } from 'stunt-double/webpack';

export default defineConfig({
  plugins: [pluginReact()],
  environments: {
    // the browser bundle
    web: { source: { entry: { index: './src/main.tsx' } } },
    // the SSR bundle the render probe imports; @acme/core is bundled, so its slot imports go through stunt-double
    node: {
      source: { entry: { 'entry-server': './src/entry-server.tsx' } },
      output: { target: 'node', module: true, distPath: { root: 'dist-ssr' }, filename: { js: '[name].js' } },
    },
  },
  // Rsbuild builds with Rspack: the webpack adapter applies to each environment's Rspack config.
  tools: { rspack: (config) => withStuntDouble(config) },
});
