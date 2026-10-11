import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import { stuntDouble } from 'stunt-double/vite';

// stuntDouble() next to reactRouter(): the same plugin instance serves the client and the SSR environment
// (ssr.noExternal for @acme/core), so server-rendered HTML and hydrated islands carry the same overrides.
export default defineConfig({
  plugins: [stuntDouble(), reactRouter()],
});
