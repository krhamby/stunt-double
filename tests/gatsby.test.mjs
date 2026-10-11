// Gatsby 5 (webpack 5 underneath): examples/customer-gatsby, stunt-double/webpack through
// `onCreateWebpackConfig: ({ actions, getConfig }) => actions.replaceWebpackConfig(withStuntDouble(getConfig()))`.
// The render is the page `gatsby build` server-rendered (public/index.html). Runs the positive scenario, the shared
// catalogue, the Gatsby-specific scenarios below and a live `gatsby develop` probe in Chromium. Not run here (time
// budget, a Gatsby build is 10-35 s): the TypeScript 5.9 rerun and the universal tier, which exercise no
// Gatsby-specific code (the same adapter and the same CLI gate as tests/rsbuild.test.mjs). See docs/tools/gatsby.md.
import assert from 'node:assert/strict';
import { defineToolSuite } from './harness/index.mjs';
import { browserDevProbe } from './harness/browser-dev.mjs';

const ENV = 'GATSBY_TELEMETRY_DISABLED=1';
const BUILD = `${ENV} gatsby build`;
const ADAPTER_LINE = 'actions.replaceWebpackConfig(withStuntDouble(getConfig()));';

const GATSBY = [
  {
    id: 'GATSBY-F6e',
    title: 'warm Gatsby webpack cache (.cache/webpack): removing an override is never served from the cache',
    catches: 'fingerprint in cache.version + shim content',
    tags: ['cache', 'must-pass'],
    apply: async (fx) => {
      const warm = await fx.run(BUILD);
      assert.equal(warm.code, 0, `warm-up build failed\n${warm.output.slice(-3000)}`);
      fx.remove(fx.override('PriceTag.tsx'));
    },
    expect: { outcome: 'pass', command: 'build', render: { sdk: { SDK_DEFAULT_PRICETAG: 3, BRAND_PRICE: 0, BRAND_LOGO: 1 } } },
  },
  {
    id: 'GATSBY-audit',
    title: 'a NormalModuleReplacementPlugin added in onCreateWebpackConfig resolves the PriceTag socket to the SDK default: the bundle audit fails the build',
    catches: 'AUD',
    tags: ['aud'],
    apply: (fx) => fx.edit('gatsby-node.mjs', (s) => `import webpack from 'webpack';\n${s.replace(ADAPTER_LINE, "const config = withStuntDouble(getConfig());\n  config.plugins.unshift(new webpack.NormalModuleReplacementPlugin(/^@acme\\/core-slots\\/PriceTag$/, '@acme/core/original/PriceTag'));\n  actions.replaceWebpackConfig(config);")}`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F6\] @acme\/core imports @acme\/core-slots\/PriceTag but [^\n]*PriceTag\.jsx is not in the bundle/] },
  },
];

defineToolSuite({
  name: 'gatsby',
  fixtureDir: 'examples/customer-gatsby',
  toolConfig: 'gatsby-node.mjs',
  commands: {
    build: BUILD,
    render: 'node probes/render.mjs public/index.html',
  },
  outputs: ['public', '.cache'],
  positive: {
    bundle: { files: 'public/*.js' },
    alsoPass: ['check'],
  },
  // Gatsby has one gatsby-node per site: "the tool without the adapter" is the same site whose gatsby-node never
  // got onCreateWebpackConfig.
  unwired: {
    files: { 'gatsby-node.mjs': 'export {};\n' },
    command: BUILD,
  },
  mutations: (list) => [...list, ...GATSBY],
  devProbe: browserDevProbe({ command: `${ENV} gatsby develop -p {port}`, overlay: 'gatsby-fast-refresh', startTimeoutMs: 240_000 }),
});
