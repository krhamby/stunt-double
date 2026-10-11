// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { stuntDouble } from 'stunt-double/vite';

// Astro has no top-level `plugins`: stuntDouble() goes into `vite.plugins`. Astro builds the server/prerender
// graph (static HTML) and the client graph (React islands) with the same Vite config, so both get the overrides.
export default defineConfig({
  integrations: [react()],
  vite: { plugins: [stuntDouble()] },
});
