import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { stuntDouble } from 'stunt-double/vite';

// The app's own Vite config. Storybook's builder-vite loads it, so `storybook build` / `storybook dev` get
// stuntDouble() with no Storybook-specific wiring (.storybook/main.ts).
export default defineConfig({
  plugins: [react(), stuntDouble()],
});
