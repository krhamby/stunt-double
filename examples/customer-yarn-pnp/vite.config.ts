/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { stuntDouble } from 'stunt-double/vite';

// stuntDouble() is the whole setup: it validates src/overrides at every start, generates .stunt-double/
// (self-ignoring), aliases @acme/core-slots/* to the generated shims, runs the contract type check in
// `vite build`, and pushes injection errors to the dev overlay. Plugin order does not matter.
export default defineConfig({
  plugins: [react(), stuntDouble()],
  test: {
    environment: 'node',
  },
});
