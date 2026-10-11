// Next.js 16 (withStuntDouble() from stunt-double/next), shared by tests/next.test.mjs (Turbopack, the default
// bundler) and tests/next-webpack.test.mjs (`next build --webpack`). Fixture: examples/customer-next, an App
// Router app whose page renders the shared <App/>; `next build` prerenders it and the probe reads the HTML.
import { defineToolSuite } from './harness/index.mjs';

const ENV = 'NEXT_TELEMETRY_DISABLED=1';

/** next.config.mjs without stunt-double (a config nobody wired, or the universal tier with a package link). */
const PLAIN_CONFIG = `// No stunt-double adapter: the SDK's slot imports resolve through node_modules.
export default { transpilePackages: ['@acme/core'] };
`;

/**
 * @param {object} o
 * @param {string} o.name     suite name
 * @param {string} o.build    the `next build` command line (without env)
 * @param {Function} [o.mutations]  filter the applicable mutations
 */
export function nextSuite({ name, build, mutations }) {
  defineToolSuite({
    name,
    family: 'next',
    fixtureDir: 'examples/customer-next',
    toolConfig: 'next.config.mjs',
    mutations,
    commands: {
      build: `${ENV} ${build}`,
      render: 'node probes/render.mjs',
    },
    outputs: ['.next', 'next-env.d.ts'],
    positive: {
      bundle: { files: '.next/static/chunks/**/*.js' },
      alsoPass: ['check'],
    },
    // Next reads only next.config.*: the forgotten-adapter case replaces it (F6b-config writes these files)
    unwired: {
      files: { 'next.config.mjs': PLAIN_CONFIG },
      command: `${ENV} ${build}`,
    },
    universal: {
      files: { 'next.config.mjs': PLAIN_CONFIG },
      build: `stunt-double check && ${ENV} ${build}`,
      bare: `${ENV} ${build}`,
    },
    timeout: 8 * 60_000,
  });
}
