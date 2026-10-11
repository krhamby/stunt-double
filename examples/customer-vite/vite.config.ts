/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { stuntDouble } from 'stunt-double/vite';

// stuntDouble(): validates src/overrides at every start, aliases @acme/core-slots/* to the generated shims,
// runs the contract type check in `vite build` and pushes injection errors to the dev overlay.
export default defineConfig({
  plugins: [react(), stuntDouble()],
  test: {
    environment: 'node',
  },
});
