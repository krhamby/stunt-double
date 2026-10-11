import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A separate Vite config WITHOUT stunt-double, as some projects keep for Storybook. Used by
// .storybook-vite-final (which adds the plugin in viteFinal) and by .storybook-unwired (which does not, and
// must therefore fail on the @acme/core-slots registry placeholder).
export default defineConfig({
  plugins: [react()],
});
