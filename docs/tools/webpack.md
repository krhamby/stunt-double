# webpack 5 and Rspack 2

One adapter covers webpack 5, Rspack 2 and everything configured through them (Rsbuild, Next `--webpack`, CRA via craco, Gatsby, Storybook `webpackFinal`).

```js
// webpack.config.mjs or rspack.config.mjs: an object, an array (multi-compiler) or a function of (env, argv)
import { withStuntDouble } from 'stunt-double/webpack';

export default withStuntDouble((env, argv) => configs(argv.mode));
```

```js
// rsbuild.config.ts:  tools: { rspack: (config) => withStuntDouble(config) }
// craco.config.js:    webpack: { configure: (config) => withStuntDouble(config) }
```

| Stage | What happens |
|---|---|
| config | validates `src/overrides`, writes `.stunt-double/`, adds one exact-match alias per slot (`@acme/core-slots/Button$` → the shim; it wins over a user alias for the same socket), sets `module.parser.javascript.exportsPresence: 'error'` (webpack only warns about a missing export otherwise) and folds the fingerprint into a filesystem `cache.version` |
| every run | regenerates; validation errors become compilation errors (exit 1 in a build, the overlay in a dev server) |
| production compilations | the contract type check runs alongside the compilation and is awaited in `finishModules`; then the post-bundle audit, and `[F6]` when the SDK became an external module |
| watch / dev server | `src/overrides` is a context dependency: adding, removing or editing an override recompiles; a mistake writes poisoned shims so nothing half-broken runs, and the fix recovers without a restart |

Never use `resolve.plugins` for this (Rspack ignores them) or replace modules in `afterResolve` (loaders would be chosen for the old path); the adapter does neither. **TypeScript 7 has no JavaScript API**, so `ts-loader` and fork-ts-checker do not work with it: compile with Babel, SWC (`builtin:swc-loader` in Rspack) or esbuild-loader, and let the adapter type-check.

**SSR with webpack-node-externals:** allowlist the SDK (`allowlist: [/^@acme\/core/]`), or the build fails with `[F6] @acme/core is an external module`.

Options: `withStuntDouble(config, { typecheck, audit, mode, ...anyConfigKey })`.

**Rsbuild 2.** Rsbuild builds with Rspack; apply the adapter through `tools.rspack`, which runs once per environment (e.g. `web` and `node`):

```ts
// rsbuild.config.ts
export default defineConfig({ plugins: [pluginReact()], tools: { rspack: (config) => withStuntDouble(config) } });
```

`output.externals` that match the SDK fail the build with `[F6]`, as with webpack's `externals`.

**Verified with** webpack 5.111.1 + webpack-cli 7.2.3 + Babel 8 (`tests/webpack.test.mjs`), @rspack/core 2.2.8 + builtin:swc-loader (`tests/rspack.test.mjs`) and @rsbuild/core 2.2.12 with web + node environments (`tests/rsbuild.test.mjs`), TypeScript 7.0.2 and 5.9.3: the shared catalogue, the webpack-family scenarios (SSR externals, a user alias bypassing a slot) and the universal tier; plus `webpack --watch` (a typo fails the recompilation, the fix recovers).
