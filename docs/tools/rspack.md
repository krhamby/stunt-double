# Rspack 2

Rspack uses the same wrapper as webpack, `withStuntDouble()` from `stunt-double/webpack`. Using Rsbuild? See [rsbuild.md](rsbuild.md).

## Setup

1. `npm i -D stunt-double`
2. Wrap your config:

   ```js
   // rspack.config.mjs
   import { withStuntDouble } from 'stunt-double/webpack';

   export default withStuntDouble({
     entry: './src/main.tsx',
     // ...the rest of your config, unchanged
   });
   ```

   Arrays (multi-compiler) and config functions (`withStuntDouble((env, argv) => ({ ... }))`) work too.
3. Put your components in `src/overrides/<Slot>.tsx`.

`rspack build` and `rspack dev` now validate the overrides at every start and rebuild.

### What the wrapper changes in your config

The same four things as for webpack (see [webpack.md](webpack.md#what-the-wrapper-changes-in-your-config)): exact `resolve.alias` entries per slot, `module.parser.javascript.exportsPresence: 'error'`, the decision fingerprint appended to `cache.version` (for `cache: { type: 'persistent' }` and `cache: { type: 'filesystem' }`), and the `StuntDoublePlugin`.

Two Rspack-specific notes:

- The wrapper uses `resolve.alias`, never `resolve.plugins`: Rspack ignores `resolve.plugins` without an error.
- Don't add a separate type checker for the slot contracts; the wrapper runs it. If you already use `ts-checker-rspack-plugin` for your app, it can stay.

## Verified with

@rspack/core 2.2.8, @rspack/cli 2.2.8, @rspack/dev-server 2.2.1, `builtin:swc-loader`, persistent cache, TypeScript 7.0.2, React 19.3.0, Node 22.22.0. The example app is [`examples/customer-rspack`](../../examples/customer-rspack); the suite is `tests/rspack.test.mjs`.

## Where each mistake fails

"build" = `rspack build` exits 1 with the `[Fx]` message. "overlay" = the message appears in the Rspack dev-server browser overlay and clears when fixed.

| # | Mistake | `rspack build` | `rspack dev` |
|---|---|---|---|
| F1a | Override props incompatible with the contract | build (type check) | overlay, after the edit (type check) ✓ |
| F1b | Override ignores contract props | build (type check) | overlay (type check) |
| F1c | `forwardRef` / `memo` / class override (must pass) | passes | passes |
| F2a | Typo or stray file in `src/overrides` | build | overlay ✓ |
| F2b | Slot renamed or removed by an SDK upgrade | build, with a "RENAMED to …" hint | overlay |
| F3 | Required slot not provided | build | overlay ✓ |
| F4 | Two files claim one slot | build | overlay |
| F5 | Wrong export | build (also Rspack's own `ESModulesLinkingError`) | overlay ✓ |
| F6a | The installed SDK imports its own default directly | build | overlay |
| F6b | A config that was never wrapped | build: `Module not found: Can't resolve './STUNT-DOUBLE-NOT-WIRED -- …'` | same text, in the overlay |
| F6e | Persistent cache after adding or removing an override | correct output with a warm cache ✓ | correct |
| F6g | App code imports `@acme/core/original/X` | build | overlay |
| F6h | Override added or removed without regenerating | regenerated; correct output ✓ | regenerated in the same rebuild ✓ |
| F6 audit | A plugin or alias resolves a socket elsewhere | build (module-graph audit) | overlay |
| F7 | Override imports its own slot | build | overlay ✓ |
| F8 | Two copies of React | build | overlay |
| F9c | Async component in a client slot | build (type check) | overlay (type check) |

Every production-build cell is run by the suite. In the dev column, ✓ marks the cells the suite drives in a real browser; the others use the same channel (`compilation.errors`) and were not run separately. Nothing in this table reaches runtime when the wrapper is in the config.

## Dev server behaviour

- Adding or removing an override is picked up in the same rebuild. The wrapper regenerates the shims in `watchRun` and marks them in `compiler.modifiedFiles`, which Rspack's incremental rebuild reads. Without that step, the first rebuild after removing an override fails with a transient `Module not found` and re-adding one stays stale for one rebuild; the wrapper does it for you. One extra rebuild that changes nothing follows the shim write.
- The contract type check reruns only after rebuilds that touched an override, a file it imports, or the generated files (about 0.2 s with TypeScript 7). `typecheck: 'build'` skips it in dev.

## Known gaps

- `exportsPresence: 'error'` applies to your whole build (see [webpack.md](webpack.md#known-gaps)).
- In a multi-compiler build each compiler reports the same problem, so you see each message twice.
