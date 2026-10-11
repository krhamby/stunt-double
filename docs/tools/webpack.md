# webpack 5

stunt-double plugs into webpack through one wrapper, `withStuntDouble()` from `stunt-double/webpack`. The same wrapper serves Rspack, Rsbuild, Create React App (craco) and Gatsby; see their pages for the one-line differences.

## Setup

1. `npm i -D stunt-double`
2. Wrap your config:

   ```js
   // webpack.config.mjs
   import { withStuntDouble } from 'stunt-double/webpack';

   export default withStuntDouble({
     entry: './src/main.tsx',
     // ...the rest of your config, unchanged
   });
   ```

   It also accepts an array of configs (multi-compiler) and a config function: `export default withStuntDouble((env, argv) => ({ ... }))`.
3. Put your components in `src/overrides/<Slot>.tsx` (for example `src/overrides/Button.tsx` exporting `Button`).

`webpack` and `webpack serve` then validate the overrides at every start and rebuild, and a mistake fails the build or shows in the dev overlay.

### What the wrapper changes in your config

- `resolve.alias`: one exact-match entry per slot, `@acme/core-slots/<Slot>$` → the generated shim. Your own aliases are kept.
- `module.parser.javascript.exportsPresence: 'error'`: a missing named export is an error rather than a warning. This applies to your whole build, not just the slots.
- `cache.version` (filesystem cache): a fingerprint of the current override decisions is appended, so a warm cache can never serve an old decision.
- `plugins`: adds `StuntDoublePlugin`, which reports problems through `compilation.errors`, runs the contract type check and audits the final module graph.

Options: `withStuntDouble(config, { typecheck, audit, root })`. `typecheck: 'build'` skips the type check in watch mode; `false` turns it off (then run `stunt-double check` in CI). `root` defaults to `config.context`, then the current directory.

Don't add `fork-ts-checker-webpack-plugin` for the slot contracts: with TypeScript 7 it crashes and the build still passes. The wrapper runs the check itself.

## Verified with

webpack 5.111.1, webpack-cli 7.2.3, webpack-dev-server 6.0.0, swc-loader 0.2.7 with @swc/core 1.16.13, html-webpack-plugin 5.6.8, TypeScript 7.0.2, React 19.3.0, Node 22.22.0. The example app is [`examples/customer-webpack`](../../examples/customer-webpack); the suite is `tests/webpack.test.mjs`.

## Where each mistake fails

"build" = `webpack --mode production` exits non-zero and prints the `[Fx]` line. "overlay" = the message appears in the webpack-dev-server browser overlay and clears when fixed. Every build cell is run by `tests/webpack.test.mjs` (the shared catalogue in `tests/mutations/` plus the webpack-family scenarios in `tests/webpack-family/extras.mjs`); ✓ in the dev column marks what the suite drives in a real browser. The other dev cells go through the same channel (`compilation.errors`) but are not run separately.

| # | Mistake | `webpack --mode production` | dev server |
|---|---|---|---|
| F1a | Override requires a prop the SDK never passes | build (type check) | overlay after the edit ✓ |
| F1b, F1b-upgrade | Override ignores SDK props; an SDK upgrade widens a hand-typed contract | build (type check) | overlay |
| F1c-* | `React.FC`, `memo`, `forwardRef`, class, returns `children` | passes and renders | passes |
| F2a, F2a-stray | Typo (`Buton.tsx`) or stray file in `src/overrides` | build | overlay ✓ |
| F2b | SDK 2.0.0 renames a slot | build, "RENAMED to \"Price\"" | overlay |
| F3a, F3b | Required slot missing (also: new required slot after an upgrade) | build | overlay ✓ |
| F4 | Two files claim one slot | build | overlay |
| F5a, F5b | Default export, or wrong export name | build | overlay ✓ |
| CFG | Unknown key in `stunt-double.config.json` | build | overlay |
| UPG-minor | SDK minor adds an optional slot | passes, SDK default renders | passes |
| F6a | Installed SDK imports its own default | build (scan of the installed SDK) | overlay |
| F6b-config | A second config without the adapter | build: `Module not found: … STUNT-DOUBLE-NOT-WIRED …` | same text |
| F6b-node | Plain Node imports `@acme/core` | `ERR_MODULE_NOT_FOUND … STUNT-DOUBLE-NOT-WIRED` | n/a |
| F6c-externals | Server build with `webpack-node-externals` | the SDK stays bundled, renders correctly | n/a |
| F6c-externals-regex | A string/RegExp external captures `@acme/core` | build: `[F6] "@acme/core" is external in this node build` | n/a |
| F6-audit | A plugin resolves a socket elsewhere | build (module-graph audit) | overlay |
| F6e-remove, F6e-add | Override removed / added with a warm persistent cache | correct output, never the cached decision | correct |
| F6g | App code imports `@acme/core/original/X` | build | overlay |
| F6h-add, F6h-remove | Override added / removed without regenerating | regenerated, correct output | regenerated in the same rebuild ✓ |
| F7a–F7d | Override reaches its own slot (socket, barrel, helper file, namespace) | build | overlay ✓ |
| F8 | Two copies of React | build | overlay |
| F9b | Client-slot override imports `server-only` | build | overlay |
| F9c | Async component in a client slot | build (type check) | overlay |

The type-check cells also pass with TypeScript 5.9 (`"typescript": "typescript5"`, an npm alias of typescript@5.9.3). Without the wrapper (universal tier: package link + `stunt-double check && webpack --mode production`), the `check` prefix catches F1a, F2a, F3a, F5a and F7b; a bare build without the prefix does not validate overrides (see [DESIGN.md §14](../DESIGN.md#14-known-limitations), R1).

Nothing in this table reaches runtime when the wrapper is in the config.

## Dev server behaviour

- Adding or removing an override is picked up in the same rebuild: the wrapper regenerates the shims in `watchRun` and invalidates them for that compilation. webpack then runs one extra rebuild that changes nothing (it notices the shim write). You don't need `stunt-double watch --`.
- The contract type check runs after rebuilds that touched an override, a file an override imports, or the generated files. It adds about 0.2–0.5 s (TypeScript 7) to those rebuilds only. Set `typecheck: 'build'` to skip it in dev.

## Known gaps

- `exportsPresence: 'error'` is global. If a dependency relies on importing names that don't exist (rare, usually type-only re-exports compiled by a non-type-aware tool), the build fails where webpack used to warn. Fix the import, or set `module.parser.javascript.exportsPresence` back to `'warn'` for that dependency with a `module.rules[].parser` override (F5 is then still caught by the type check and the generator).
- Server builds: externals run before aliases, so an externalized SDK would be loaded by Node without your overrides. The wrapper wraps *function* externals (what `webpack-node-externals` returns) so `@acme/core`, brand layers and `@acme/core-slots/*` stay bundled. It can't rewrite string, RegExp or object externals; those fail the build with `[F6]` and the allowlist to add.
- In a multi-compiler build (for example client + SSR) each compiler reports the same problem, so you see each message twice.
- Wrapping with `withStuntDouble()` is the only supported integration. A config without it is caught (F6b), but only as a resolution error.
