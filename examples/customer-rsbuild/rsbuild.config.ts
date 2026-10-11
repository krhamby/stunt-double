import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { withStuntDouble } from 'stunt-double/webpack';

// withStuntDouble() wraps the final Rspack config of every environment: it validates src/overrides at every
// start and rebuild, aliases each @acme/core-slots/<Slot> to its generated shim, runs the contract type check
// and the bundle audit, and reports every injection mistake through compilation.errors (non-zero exit in
// `rsbuild build`, error overlay in `rsbuild dev`).
export default defineConfig({
  plugins: [pluginReact()],
  tools: { rspack: (config) => withStuntDouble(config) },
  // Rspack persistent cache; withStuntDouble folds its generation fingerprint into the cache version (F6e).
  performance: { buildCache: true },
  // One React and one react-dom in the bundle, whatever the install looks like (F8)
  // (Not @acme/core: dedupe is a directory alias, which bypasses the SDK's package.json "exports" subpaths.)
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: Number(process.env.PORT ?? 3000) },
  environments: {
    web: {
      source: { entry: { index: './src/main.tsx' } },
    },
    node: {
      source: { entry: { 'entry-server': './src/entry-server.tsx' } },
      output: {
        target: 'node',
        module: true,
        distPath: { root: 'dist-ssr', js: '' },
        filename: { js: '[name].mjs' },
        filenameHash: false,
        minify: false,
      },
    },
  },
});
