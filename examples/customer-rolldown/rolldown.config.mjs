// Rolldown 1.2: a browser bundle (dist/) and an SSR bundle for the render probe (dist-ssr/).
// stuntDouble() is the same plugin object as in Vite: it validates src/overrides, maps @acme/core-slots/* to
// the generated shims, runs the contract type check at buildStart and audits the module graph at buildEnd.
// Every injection mistake fails `rolldown -c` with an [Fx] message (this.error).
import { defineConfig } from 'rolldown';
import { stuntDouble } from 'stunt-double/rolldown';

// The SDK's dist keeps its "use client" directives; a client bundle drops them, which is fine here.
const onLog = (level, log, handler) => { if (log.code !== 'MODULE_LEVEL_DIRECTIVE') handler(level, log); };

export default defineConfig([
  {
    input: 'src/main.tsx',
    platform: 'browser',
    plugins: [stuntDouble()],
    onLog,
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': '"production"' } },
    output: { dir: 'dist/assets', format: 'es', minify: true },
  },
  {
    input: 'src/entry-server.tsx',
    platform: 'node',
    // React stays external (Node loads it); @acme/core MUST be bundled so its socket imports reach the shims.
    external: [/^react(-dom)?(\/|$)/],
    plugins: [stuntDouble()],
    onLog,
    transform: { jsx: 'react-jsx' },
    output: { dir: 'dist-ssr', format: 'es' },
  },
]);
