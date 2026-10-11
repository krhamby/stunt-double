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

"build" = `rspack build` exits non-zero and prints the `[Fx]` line. "overlay" = the message appears in the Rspack dev-server browser overlay and clears when fixed. Every build cell is run by `tests/rspack.test.mjs` (the shared catalogue in `tests/mutations/` plus the webpack-family scenarios in `tests/webpack-family/extras.mjs`); ✓ in the dev column marks what the suite drives in a real browser. The other dev cells go through the same channel (`compilation.errors`) but are not run separately.

| # | Mistake | `rspack build` | dev server |
|---|---|---|---|
| F1a | Override requires a prop the SDK never passes | build (type check) | overlay after the edit ✓ |
| F1b, F1b-upgrade | Override ignores SDK props; an SDK upgrade widens a hand-typed contract | build (type check) | overlay |
| F1c-* | `React.FC`, `memo`, `forwardRef`, class, returns `children` | **passes** and renders | passes |
| F2a, F2a-stray | Typo (`Buton.tsx`) or stray file in `src/overrides` | build | overlay ✓ |
| F2b | SDK 2.0.0 renames a slot | build, "RENAMED to \"Price\"" | overlay |
| F3a, F3b | Required slot missing (also: new required slot after an upgrade) | build | overlay ✓ |
| F4 | Two files claim one slot | build | overlay |
| F5a, F5b | Default export, or wrong export name | build | overlay ✓ |
| CFG | Unknown key in `stunt-double.config.json` | build | overlay |
| UPG-minor | SDK minor adds an optional slot | **passes**, SDK default renders | passes |
| F6a | Installed SDK imports its own default | build (scan of the installed SDK) | overlay |
| F6b-config | A second config without the adapter | build: `Module not found: … STUNT-DOUBLE-NOT-WIRED …` | same text |
| F6b-node | Plain Node imports `@acme/core` | `ERR_MODULE_NOT_FOUND … STUNT-DOUBLE-NOT-WIRED` | — |
| F6c-externals | Server build with `webpack-node-externals` | **handled**: the SDK stays bundled, renders correctly | — |
| F6c-externals-regex | A string/RegExp external captures `@acme/core` | build: `[F6] "@acme/core" is external in this node build` | — |
| F6-audit | A plugin resolves a socket elsewhere | build (module-graph audit) | overlay |
| F6e-remove, F6e-add | Override removed / added with a warm persistent cache | **correct** output, never the cached decision | correct |
| F6g | App code imports `@acme/core/original/X` | build | overlay |
| F6h-add, F6h-remove | Override added / removed without regenerating | **regenerated**, correct output | regenerated in the same rebuild ✓ |
| F7a–F7d | Override reaches its own slot (socket, barrel, helper file, namespace) | build | overlay ✓ |
| F8 | Two copies of React | build | overlay |
| F9b | Client-slot override imports `server-only` | build | overlay |
| F9c | Async component in a client slot | build (type check) | overlay |

The type-check cells also pass with TypeScript 5.9 (`"typescript": "typescript5"`, an npm alias of typescript@5.9.3). Without the wrapper (universal tier: package link + `stunt-double check && rspack build`), the `check` prefix catches F1a, F2a, F3a, F5a and F7b; a bare build without the prefix does not validate overrides (see [DESIGN.md §14](../DESIGN.md#14-known-limitations), R1).

Nothing in this table reaches runtime when the wrapper is in the config.

## Dev server behaviour

- Adding or removing an override is picked up in the same rebuild. The wrapper regenerates the shims in `watchRun` and marks them in `compiler.modifiedFiles`, which Rspack's incremental rebuild reads. Without that step, the first rebuild after removing an override fails with a transient `Module not found` and re-adding one stays stale for one rebuild; the wrapper does it for you. One extra rebuild that changes nothing follows the shim write.
- The contract type check reruns only after rebuilds that touched an override, a file it imports, or the generated files (about 0.2 s with TypeScript 7). `typecheck: 'build'` skips it in dev.

## Known gaps

- `exportsPresence: 'error'` applies to your whole build (see [webpack.md](webpack.md#known-gaps)).
- Server builds: externals run before aliases, so an externalized SDK would be loaded by Node without your overrides. The wrapper wraps *function* externals (what `webpack-node-externals` returns) so `@acme/core`, brand layers and `@acme/core-slots/*` stay bundled. It can't rewrite string, RegExp or object externals; those fail the build with `[F6]` and the allowlist to add.
- In a multi-compiler build each compiler reports the same problem, so you see each message twice.
