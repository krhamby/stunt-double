import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// A SECOND config that forgot the stunt-double plugin (the "F6b: a tool that was never wired" mistake). It
// exists to prove fail-closed behaviour: running it must fail, never render the SDK defaults.
export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', include: ['src/**/*.node.test.tsx'] },
});
