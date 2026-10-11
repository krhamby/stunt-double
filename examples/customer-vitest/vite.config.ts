/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { stuntDouble } from 'stunt-double/vite';

// One config for the app and for Vitest. stuntDouble() aliases @acme/core-slots/* to the generated shims and
// inlines @acme/core into Vitest's module graph, so the SDK's own internal slot imports get the overrides too.
// Vitest projects inherit the root plugins with `extends: true`.
export default defineConfig({
  plugins: [react(), stuntDouble()],
  test: {
    projects: [
      { extends: true, test: { name: 'node', environment: 'node', include: ['src/**/*.node.test.tsx'] } },
      { extends: true, test: { name: 'jsdom', environment: 'jsdom', include: ['src/**/*.dom.test.tsx'] } },
    ],
  },
});
