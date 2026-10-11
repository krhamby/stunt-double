// React Router 8 framework mode (SSR): examples/customer-react-router under `react-router build` and
// `react-router dev`. Sources live in app/ (the React Router convention), so the fixture declares
// "overridesDir": "app/overrides" and "sourceDirs": ["app"] and the suite passes the same layout.
// Every expectation was observed for real; see docs/tools/react-router.md. Run: npm test -- react-router
import { defineToolSuite } from './harness/index.mjs';
import { frameworkDevProbe } from './frameworks/dev.mjs';

// A second, forgotten Vite config (a one-off script bundling a route) that never got the plugin.
const UNWIRED_CONFIG = `import { defineConfig } from 'vite';

export default defineConfig({ build: { outDir: 'dist-unwired', rolldownOptions: { input: 'app/routes/home.tsx' } } });
`;

defineToolSuite({
  name: 'react-router',
  family: 'vite',
  fixtureDir: 'examples/customer-react-router',
  toolConfig: 'vite.config.ts',
  layout: { srcDir: 'app', overridesDir: 'app/overrides' },
  commands: {
    // builds the client AND the SSR server bundle; the render probe serves GET / through the BUILT server
    // bundle with react-router's own createRequestHandler
    build: 'react-router build',
    render: 'node probes/render.mjs',
    typecheck: 'react-router typegen && tsc',
  },
  outputs: ['build', '.react-router', 'dist-unwired'],
  positive: {
    bundle: { files: 'build/client/assets/*.js' },
    alsoPass: ['check', 'typecheck'],
  },
  unwired: {
    files: { 'vite.unwired.config.ts': UNWIRED_CONFIG },
    command: 'vite build --config vite.unwired.config.ts',
  },
  devProbe: frameworkDevProbe({ command: 'react-router dev --strictPort' }),
});
