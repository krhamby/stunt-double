// Gatsby 5 (webpack 5 underneath): examples/customer-gatsby with stunt-double/webpack through
// `onCreateWebpackConfig: ({ actions, getConfig }) => actions.replaceWebpackConfig(withStuntDouble(getConfig()))`.
// The render is the page `gatsby build` server-rendered (public/index.html). Runs the positive scenario, the shared
// mutation catalogue, the webpack-family scenarios (tests/webpack-family/extras.mjs) and a live `gatsby develop`
// probe in Chromium. Not run here, for the time budget (a Gatsby build takes 12 to 35 s): the TypeScript 5.9 rerun
// and the universal tier. Neither has Gatsby-specific code: the same adapter gate and the same CLI gate run in
// tests/rsbuild.test.mjs and tests/webpack.test.mjs. See tests/README.md and docs/tools/gatsby.md.
import { defineToolSuite } from './harness/index.mjs';
import { unwiredConfig, webpackFamilyMutations, webpackDevProbe } from './webpack-family/extras.mjs';

const fixtureDir = 'examples/customer-gatsby';
const build = 'GATSBY_TELEMETRY_DISABLED=1 gatsby build';

const family = webpackFamilyMutations({
  build,
  toolPackage: 'webpack',
  // Gatsby's server build is the build-html stage (target node); gatsby-node edits its config in place.
  ssrMarker: '  const config = getConfig();\n',
  externalsLine: (v) => `  if (String(config.target).startsWith('node')) config.externals = [...[].concat(config.externals ?? []), ...${v}];\n`,
  ssrBundle: '.cache/page-ssr/routes/render-page.js',
  // A site has exactly one gatsby-node: the "audit config" replaces it, and the build is the plain build.
  auditConfig: () => ({
    file: 'gatsby-node.mjs',
    run: build,
    text: `import webpack from 'webpack';
import { withStuntDouble } from 'stunt-double/webpack';

// A user plugin that "helpfully" resolves the PriceTag socket itself.
export const onCreateWebpackConfig = ({ actions, getConfig }) => {
  const config = withStuntDouble(getConfig());
  config.plugins.unshift(new webpack.NormalModuleReplacementPlugin(/^@acme\\/core-slots\\/PriceTag$/, '@acme/core/original/PriceTag'));
  actions.replaceWebpackConfig(config);
};
`,
  }),
});

defineToolSuite({
  name: 'gatsby',
  family: 'webpack',
  fixtureDir,
  toolConfig: 'gatsby-node.mjs',
  commands: {
    build,
    render: 'node probes/render.mjs public/index.html',
  },
  outputs: ['public', '.cache'],
  positive: { bundle: { files: 'public/*.js' }, alsoPass: ['check'] },
  // A site has exactly one gatsby-node: "the tool without the adapter" is the same site with an unwired one.
  unwired: {
    files: { 'gatsby-node.mjs': unwiredConfig(fixtureDir, 'gatsby-node.mjs') },
    command: build,
  },
  addDevDependencies: { 'webpack-node-externals': '3.0.0' },
  mutations: (list) => [...list, ...family],
  expectations: {
    // Externalizing node_modules breaks Gatsby's own HTML renderer under React 19 (TypeError: Cannot read properties
    // of undefined (reading 'ContextRegistry') from react internals). The adapter still kept @acme/core bundled
    // (0 require("@acme/core") in render-page.js). The regex case (F6c-externals-regex) runs.
    'F6c-externals': "webpack-node-externals is not a working Gatsby setup: it breaks Gatsby's HTML renderer itself (React internals: 'ContextRegistry'), with the SDK still bundled",
  },
  devProbe: webpackDevProbe({ dev: 'GATSBY_TELEMETRY_DISABLED=1 gatsby develop -p $PORT', overlay: 'gatsby-fast-refresh' }),
});
