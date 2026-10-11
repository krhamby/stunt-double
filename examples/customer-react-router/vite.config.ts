import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';
import { stuntDouble } from 'stunt-double/vite';

// The same one-line setup as any Vite app: React Router's framework mode is a Vite plugin, and stuntDouble()
// covers its client and server builds (the server environment keeps @acme/core bundled).
export default defineConfig({
  plugins: [reactRouter(), stuntDouble()],
});
