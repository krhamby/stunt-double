# Rollup

Rollup uses the same plugin object as Vite: `stuntDouble()` from `stunt-double/rollup` (an alias of `stunt-double/vite`). Vite-only hooks are ignored. Every injection mistake fails `rollup -c` with an `[Fx]` message.

Verified with Rollup 4.64.5, @rollup/plugin-node-resolve 16.0.3, @rollup/plugin-commonjs 29.0.3, rollup-plugin-esbuild 6.2.1, TypeScript 7.0.2, React 19.3.0 and Node 22.22.0. Reference project: [`examples/customer-rollup`](../../examples/customer-rollup).

## Setup

```js
// rollup.config.mjs
import { stuntDouble } from 'stunt-double/rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import esbuild from 'rollup-plugin-esbuild';

export default {
  input: 'src/main.tsx',
  output: { dir: 'dist', format: 'es' },
  plugins: [
    stuntDouble(),
    nodeResolve({ browser: true, extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'] }),
    commonjs(),
    esbuild({ jsx: 'automatic' }),
  ],
};
```

That is the whole setup: `npm i -D stunt-double`, this one plugin line, and your overrides in `src/overrides/<Slot>.tsx`. No tsconfig, `.gitignore` or `package.json` edits: generated files go to `.stunt-double/` (it ignores itself). `npx stunt-double init` only offers optional extras (editor squiggles, a CI script).

- **Plugin order does not matter.** node-resolve 16 lets other plugins resolve first (`this.resolve(…, { skipSelf: true })`). Verified with `stuntDouble()` first, last, and with the `@acme/core-slots` link replaced by the registry placeholder.
- The JSX/TS transform is yours to choose (rollup-plugin-esbuild, @rollup/plugin-swc, @rollup/plugin-babel). The generated shims are plain ESM in `.jsx` files and need no transform, but `nodeResolve` must list `.jsx`, `.tsx` and `.ts` in `extensions`.
- The SDK keeps its `"use client"` directives, so a client bundle logs `MODULE_LEVEL_DIRECTIVE` warnings. They are harmless; the example filters them with `onwarn`.
- An SSR bundle must bundle the SDK (`external` may list React, never `@acme/core`), otherwise Node loads the SDK natively and fails on the `.jsx` shims.

What the plugin does in Rollup:

| Hook | What it does |
|---|---|
| `options` | Validates `src/overrides` and writes the shims. |
| `resolveId` | Maps `@acme/core-slots/<Slot>` to `.stunt-double/gen/<Slot>.jsx`. |
| `buildStart` | Validation errors and the contract type check fail the build (`this.error`). In watch mode it regenerates on every rebuild and watches the overrides directory and the config file. |
| `buildEnd` | Audits the module graph: an SDK default reached around its slot, a socket resolved elsewhere, or a second copy of React or the SDK fails the build. |

Options: `typecheck: false`, `audit: false`, plus every option of `stunt-double.config.json`.

## Which mistakes fail where

"Build" means `rollup -c` exits non-zero with the message shown. The IDs are explained in [DESIGN.md §2](../DESIGN.md#2-failure-catalogue-the-north-star).

| Mistake | `stuntDouble()` | universal tier: `stunt-double check && rollup` (no plugin) | Rollup without the plugin and without the chain (universal tier) |
|---|---|---|---|
| F1 props don't fit the contract (extra required prop, narrowed union, ignored props); F9c async client override | build (type gate at `buildStart`) | `check` | **passes** |
| F1 an SDK upgrade widened the contract of an own-props override (tested: 1.0.0 → 1.1.0) | build | `check` | build: `ENOENT Could not load …/gen/Badge.jsx` (1.1.0 adds a slot; nothing regenerated the shims) |
| F1c `forwardRef`, `memo`, class overrides (must pass) | passes | passes | passes |
| F2a typo'd or stray override file | build (`buildStart`) | `check` | passes (file unused) |
| F2b slot renamed / new required slot in an SDK upgrade | build, with the rename hint | `check` | build: `ENOENT Could not load …/gen/Price.jsx` (no such shim) |
| F3 required slot missing | build | `check` | build: `UNRESOLVED_IMPORT` (native) |
| F4 two files claim a slot | build | `check` | passes |
| F5 wrong export name | build | `check` | build: `MISSING_EXPORT` (native) |
| F6a SDK imports a default directly (checked in the installed dist) | build | `check` | passes: the SDK default renders there (R2) |
| F6b no plugin and no universal-tier link: the registry placeholder answers the sockets | passes: the plugin is the wiring (the default setup) | build: `Could not resolve './STUNT-DOUBLE-NOT-WIRED …'` | build: same |
| F6g app code imports `@acme/core/original/X` | build (import scan) | `check` | passes |
| F6c a server build leaves the SDK or a socket external (array, regex or function, for example "every dependency") | build (`buildEnd`: `[F6] the bundle leaves "@acme/core" external`; nothing is written) | not checked: loud when Node starts (placeholder poison or `.jsx` shim) | same as the chain |
| F6g a plugin resolves a socket before this one | build (`buildEnd` audit; nothing is written) | not checked | n/a |
| F6h override deleted without regenerating | regenerated: the SDK default renders, correctly | regenerated | build: `UNRESOLVED_IMPORT` (old shim) |
| F6h override added without regenerating | regenerated: the override renders | regenerated | passes: **the SDK default renders** (R1) |
| F7 override imports its own slot (directly or through a helper) | build | `check` | passes: infinite render at runtime |
| F8 duplicate React / SDK | build (install preflight + `buildEnd` audit) | `check` (preflight only) | passes |
| F9b `server-only` in a client slot | build | `check` | passes; Node fails on the uninstalled `server-only` at load |

`rollup -c -w`: adding `Buton.tsx` fails the next rebuild with `[F2]`, deleting it passes again; breaking and fixing a contract does the same with `[F1]`.

Without the plugin, use the universal tier: run `npx stunt-double init --universal` once (it adds the `@acme/core-slots` link to `sdk-slots/`), then `"build": "stunt-double check && rollup -c"`. The check covers every row above except the bundle audit; without the check, nothing regenerates the shims (see the last column).

## Known gaps

- The audit sees only bundled modules: anything in `external` is not audited for duplicates (the install-level F8 preflight still runs).
