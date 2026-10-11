import path from 'node:path';
import { fileURLToPath } from 'node:url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import { withStuntDouble } from 'stunt-double/webpack';

const root = path.dirname(fileURLToPath(import.meta.url));

const swc = {
  test: /\.[jt]sx?$/,
  exclude: /node_modules/,
  use: {
    loader: 'swc-loader',
    options: {
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        transform: { react: { runtime: 'automatic' } },
        target: 'es2022',
      },
    },
  },
};

const shared = (env, argv) => ({
  context: root,
  mode: argv.mode ?? 'production',
  resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js'] },
  module: { rules: [swc] },
  cache: { type: 'filesystem', buildDependencies: { config: [fileURLToPath(import.meta.url)] } },
  devtool: false,
});

// withStuntDouble(): validates src/overrides at every start and rebuild, aliases each @acme/core-slots/<Slot>
// to its generated shim, runs the contract type check and the bundle audit, and reports every injection
// mistake through compilation.errors (non-zero exit in `webpack`, overlay in `webpack serve`).
const client = (env, argv) =>
  withStuntDouble({
    ...shared(env, argv),
    name: 'client',
    entry: './src/main.tsx',
    output: { path: path.join(root, 'dist'), clean: true },
    plugins: [new HtmlWebpackPlugin({ templateContent: '<!doctype html><html><body><div id="root"></div></body></html>' })],
    devServer: { port: Number(process.env.PORT ?? 8080), hot: true, client: { overlay: true } },
  });

const ssr = (env, argv) =>
  withStuntDouble({
    ...shared(env, argv),
    name: 'ssr',
    target: 'node',
    entry: './src/entry-server.tsx',
    experiments: { outputModule: true },
    output: { path: path.join(root, 'dist-ssr'), filename: 'entry-server.mjs', library: { type: 'module' }, clean: true },
  });

// The dev server serves the browser bundle only; builds also emit the SSR bundle the render probe imports.
export default (env, argv) => (env?.WEBPACK_SERVE ? [client(env, argv)] : [client(env, argv), ssr(env, argv)]);
