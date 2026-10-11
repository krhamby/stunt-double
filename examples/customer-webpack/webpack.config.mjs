import path from 'node:path';
import { withStuntDouble } from 'stunt-double/webpack';

const root = import.meta.dirname;

/** @param {'production' | 'development'} mode */
function configs(mode) {
  const shared = {
    context: root,
    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js', '...'] },
    module: {
      rules: [
        {
          test: /\.[jt]sx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            // babel.config.json is Jest's (CommonJS output); the bundles keep ES modules
            options: { configFile: false, babelrc: false, presets: ['@babel/preset-typescript', ['@babel/preset-react', { runtime: 'automatic', development: mode === 'development' }]] },
          },
        },
      ],
    },
  };

  /** The browser bundle. */
  const client = { ...shared, name: 'client', entry: './src/main.tsx', output: { path: path.join(root, 'dist'), filename: 'main.js', clean: true } };

  /** The SSR bundle the render probe imports. @acme/core is bundled, so its slot imports go through stunt-double. */
  const ssr = {
    ...shared,
    name: 'ssr',
    target: 'node',
    entry: './src/entry-server.tsx',
    output: { path: path.join(root, 'dist-ssr'), filename: 'entry-server.js', library: { type: 'module' }, chunkFormat: 'module', clean: true },
    experiments: { outputModule: true },
  };
  return [client, ssr];
}

// withStuntDouble() is the whole setup: one alias per slot to the generated shims, validation of src/overrides at
// every run, the contract type check in production builds and a post-bundle audit, all as webpack errors.
export default withStuntDouble((_env, argv) => configs(argv.mode ?? 'production'));
