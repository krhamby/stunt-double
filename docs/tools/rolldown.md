# Rolldown

Rolldown uses the same plugin object as Vite: `stuntDouble()` from `stunt-double/rolldown` (an alias of `stunt-double/vite`). Vite-only hooks are ignored. Every injection mistake fails `rolldown -c` with an `[Fx]` message.

Verified with Rolldown 1.2.13, TypeScript 7.0.2, React 19.3.0 and Node 22.22.0. Reference project: [`examples/customer-rolldown`](../../examples/customer-rolldown).

## Setup

```js
// rolldown.config.mjs
import { defineConfig } from 'rolldown';
import { stuntDouble } from 'stunt-double/rolldown';

export default defineConfig({
  input: 'src/main.tsx',
  platform: 'browser',
  plugins: [stuntDouble()],
  transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': '"production"' } },
  output: { dir: 'dist', format: 'es' },
});
```

That is the whole setup: `npm i -D stunt-double`, this one plugin line, and your overrides in `src/overrides/<Slot>.tsx`. No tsconfig, `.gitignore` or `package.json` edits: generated files go to `.stunt-double/` (it ignores itself). `npx stunt-double init` only offers optional extras (editor squiggles, a CI script).

- Rolldown resolves, transforms TSX and handles CommonJS on its own: no other plugins are needed.
- The SDK keeps its `"use client"` directives, so a client bundle logs `MODULE_LEVEL_DIRECTIVE` warnings. They are harmless; the example filters them with `onLog`.
- An SSR bundle must bundle the SDK (`external` may list React, never `@acme/core`), otherwise Node loads the SDK natively and fails on the `.jsx` shims.

The hooks are the same as in [Rollup](rollup.md#setup): `options` validates and writes the shims, `resolveId` maps `@acme/core-slots/<Slot>` to `.stunt-double/gen/<Slot>.jsx`, `buildStart` fails the build on validation and contract errors (and regenerates on every watch rebuild), and `buildEnd` audits the module graph. Options: `typecheck: false`, `audit: false`, plus every option of `stunt-double.config.json`.

## Which mistakes fail where

"Build" means `rolldown -c` exits non-zero with the message shown. The IDs are explained in [DESIGN.md §2](../DESIGN.md#2-failure-catalogue-the-north-star).

| Mistake | `stuntDouble()` | universal tier: `stunt-double check && rolldown` (no plugin) | Rolldown without the plugin and without the chain (universal tier) |
|---|---|---|---|
| F1 props don't fit the contract (extra required prop, narrowed union, ignored props); F9c async client override | build (type gate at `buildStart`) | `check` | **passes** |
| F1 an SDK upgrade widened the contract of an own-props override (tested: 1.0.0 → 1.1.0) | build | `check` | passes with an `UNRESOLVED_IMPORT` warning, fails when loaded (1.1.0 adds a slot; nothing regenerated the shims) |
| F1c `forwardRef`, `memo`, class overrides (must pass) | passes | passes | passes |
| F2a typo'd or stray override file | build (`buildStart`) | `check` | passes (file unused) |
| F2b slot renamed / new required slot in an SDK upgrade | build, with the rename hint | `check` | passes with an `UNRESOLVED_IMPORT` **warning**; the bundle fails when loaded (see Known gaps) |
| F3 required slot missing | build | `check` | build: `UNRESOLVED_IMPORT` (native) |
| F4 two files claim a slot | build | `check` | passes |
| F5 wrong export name | build | `check` | build: `MISSING_EXPORT` (native) |
| F6a SDK imports a default directly (checked in the installed dist) | build | `check` | passes: the SDK default renders there (R2) |
| F6b no plugin and no universal-tier link: the registry placeholder answers the sockets | passes: the plugin is the wiring (the default setup) | build: `Could not resolve './STUNT-DOUBLE-NOT-WIRED …'` | build: same |
| F6g app code imports `@acme/core/original/X` | build (import scan) | `check` | passes |
| F6c a server build leaves the SDK or a socket external (array, regex or function, for example "every dependency") | build (`buildEnd`: `[F6] the bundle leaves … external`; nothing is written) | not checked: loud when Node starts (placeholder poison or `.jsx` shim) | same as the chain |
| F6g a plugin resolves a socket before this one | build (`buildEnd` audit; nothing is written) | not checked | n/a |
| F6h override deleted without regenerating | regenerated: the SDK default renders, correctly | regenerated | build: `UNRESOLVED_IMPORT` (old shim) |
| F6h override added without regenerating | regenerated: the override renders | regenerated | passes: **the SDK default renders** (R1) |
| F7 override imports its own slot (directly or through a helper) | build | `check` | passes: infinite render at runtime |
| F8 duplicate React / SDK | build (install preflight + `buildEnd` audit) | `check` (preflight only) | passes |
| F9b `server-only` in a client slot | build | `check` | passes; Node fails on the uninstalled `server-only` at load |

`rolldown -c -w`: adding `Buton.tsx` fails the next rebuild with `[F2]`, deleting it passes again; breaking and fixing a contract does the same with `[F1]`.

Without the plugin, use the universal tier: run `npx stunt-double init --universal` once (it adds the `@acme/core-slots` link to `sdk-slots/`), then `"build": "stunt-double check && rolldown -c"`. The check covers every row above except the bundle audit; without the check, nothing regenerates the shims (see the last column).

## Known gaps

- **Bare Rolldown treats an unresolvable bare import as external.** Rolldown 1.2.13 turns `Could not resolve '@acme/core-slots/Price'` into an `UNRESOLVED_IMPORT` warning, keeps the import in the output and exits 0, for `platform: 'node'` and `'browser'` alike. Without the plugin or the check chain, stale shims after an SDK upgrade therefore fail only when the bundle is loaded (`ERR_MODULE_NOT_FOUND` in Node). The plugin and `stunt-double check` catch this before bundling. If you build without them, escalate the warning: `onLog(level, log, handler) { handler(log.code === 'UNRESOLVED_IMPORT' ? 'error' : level, log); }`.

- The audit sees only bundled modules: anything in `external` is not audited for duplicates (the install-level F8 preflight still runs).
- Vite 8 uses Rolldown internally; for Vite projects follow the Vite setup, not this page.
