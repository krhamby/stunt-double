// React Router 8 framework mode (its Vite plugin + stuntDouble() from stunt-double/vite). Fixture:
// examples/customer-react-router: the home route renders the shared <App/>, prerendered to
// build/client/index.html. Runs the positive scenario, the per-tool scenarios of the shared catalogue, the
// Vite-family scenarios and the universal tier. See tests/README.md.
import { defineToolSuite } from './harness/index.mjs';

/** vite.config.ts without stunt-double (a config nobody wired, or the universal tier with a package link). */
const PLAIN_CONFIG = `import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [reactRouter()], ssr: { noExternal: ['@acme/core'] } });
`;

defineToolSuite({
  name: 'react-router',
  family: 'vite',
  fixtureDir: 'examples/customer-react-router',
  toolConfig: 'vite.config.ts',
  commands: {
    build: 'react-router build',
    render: 'node probes/render.mjs',
  },
  outputs: ['build', '.react-router'],
  positive: {
    bundle: { files: 'build/client/assets/*.js' },
    alsoPass: ['check'],
  },
  unwired: {
    files: { 'vite.unwired.config.ts': PLAIN_CONFIG },
    command: 'react-router build --config vite.unwired.config.ts',
  },
  universal: {
    files: { 'vite.universal.config.ts': PLAIN_CONFIG },
    build: 'stunt-double check && react-router build --config vite.universal.config.ts',
    bare: 'react-router build --config vite.universal.config.ts',
  },
});
