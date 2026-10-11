import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { stuntDouble } from 'stunt-double/vite';

// Storybook's builder-vite merges this config into its own, so stuntDouble() covers every story too.
export default defineConfig({
  plugins: [react(), stuntDouble()],
});
