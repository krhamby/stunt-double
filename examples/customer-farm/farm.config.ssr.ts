import { defineConfig } from '@farmfe/core';
import { stuntDouble } from 'stunt-double/vite';

// SSR bundle for the render probe. React stays external; @acme/core MUST be bundled so its socket imports
// reach the shims.
export default defineConfig({
  compilation: {
    input: { 'entry-server': './src/entry-server.tsx' },
    output: { path: 'dist-ssr', targetEnv: 'node', format: 'esm', entryFilename: '[entryName].js' },
    external: ['^react$', '^react-dom', '^react/'],
    minify: false,
  },
  plugins: ['@farmfe/plugin-react'],
  vitePlugins: [stuntDouble()],
});
