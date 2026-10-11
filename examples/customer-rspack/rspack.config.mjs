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
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'typescript', tsx: true },
              transform: { react: { runtime: 'automatic', development: mode === 'development' } },
            },
          },
          type: 'javascript/auto',
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
    output: { path: path.join(root, 'dist-ssr'), filename: 'entry-server.js', library: { type: 'module' }, chunkFormat: 'module', module: true, clean: true },
  };
  return [client, ssr];
}

// The same adapter as webpack: one alias per slot to the generated shims, validation of src/overrides at every
// run, the contract type check in production builds and a post-bundle audit, all as Rspack errors.
export default withStuntDouble((_env, argv) => configs(argv.mode ?? 'production'));
