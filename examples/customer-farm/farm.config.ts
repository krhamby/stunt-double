import { defineConfig } from '@farmfe/core';
import { stuntDouble } from 'stunt-double/vite';

// Farm runs Vite plugins through its compatibility layer (vitePlugins). stuntDouble() validates src/overrides,
// maps @acme/core-slots/* to the generated shims and runs the contract type check at buildStart.
export default defineConfig({
  compilation: { input: { index: './index.html' }, output: { path: 'dist' } },
  plugins: ['@farmfe/plugin-react'],
  vitePlugins: [stuntDouble()],
});
