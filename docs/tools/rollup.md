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

Plus the usual project wiring from `npx stunt-double init`: the `@acme/core-slots` link in `package.json`, `paths` and `files` in `tsconfig.json`, and `"postinstall": "stunt-double gen --no-fail"`.

- **Plugin order does not matter.** node-resolve 16 lets other plugins resolve first (`this.resolve(…, { skipSelf: true })`). Verified with `stuntDouble()` first, last, and with the `@acme/core-slots` link replaced by the registry placeholder.
- The JSX/TS transform is yours to choose (rollup-plugin-esbuild, @rollup/plugin-swc, @rollup/plugin-babel). The generated shims are plain ESM in `.jsx` files and need no transform, but `nodeResolve` must list `.jsx`, `.tsx` and `.ts` in `extensions`.
- The SDK keeps its `"use client"` directives, so a client bundle logs `MODULE_LEVEL_DIRECTIVE` warnings. They are harmless; the example filters them with `onwarn`.
- An SSR bundle must bundle the SDK (`external` may list React, never `@acme/core`), otherwise Node loads the SDK natively and fails on the `.jsx` shims.

What the plugin does in Rollup:

| Hook | What it does |
|---|---|
| `options` | Validates `src/overrides` and writes the shims. |
| `resolveId` | Maps `@acme/core-slots/<Slot>` to `sdk-slots/gen/<Slot>.jsx`. |
| `buildStart` | Validation errors and the contract type check fail the build (`this.error`). In watch mode it regenerates on every rebuild and watches the overrides directory and the config file. |
| `buildEnd` | Audits the module graph: an SDK default reached around its slot, a socket resolved elsewhere, or a second copy of React or the SDK fails the build. |

Options: `typecheck: false`, `audit: false`, plus every option of `stunt-double.config.json`.

## Which mistakes fail where

"Build" means `rollup -c` exits non-zero with the message shown. The IDs are explained in [DESIGN.md §2](../DESIGN.md#2-failure-catalogue-the-north-star).

| Mistake | `stuntDouble()` | bare Rollup, link only, no chain |
|---|---|---|
| F1 props don't fit the contract; F9c async client override | build (type gate at `buildStart`) | **passes** |
| F2 typo'd or stray override file; F2b slot renamed or removed in an SDK upgrade | build (`buildStart`) | passes (file unused) |
| F3 required slot missing | build (`buildStart`) | build (native resolve error) |
| F4 two files claim a slot | build | passes |
| F5 wrong export name | build | build (native `MISSING_EXPORT`) |
| F6a SDK imports a default directly | build (installed-dist scan) | passes (R2) |
| F6b tool not wired at all | n/a | build: `Could not resolve "./STUNT-DOUBLE-NOT-WIRED …"` |
| F6g app imports `@acme/core/original/X`; a plugin resolves a socket elsewhere | build (import scan; `buildEnd` audit) | passes |
| F6h override added/removed without regenerating | regenerated on every build and watch rebuild | previous decision |
| F7 override imports its own slot | build | passes: infinite render at runtime |
| F8 duplicate React / SDK | build (preflight + audit) | passes: runtime crash |
| F9b `server-only` in a client slot | build | passes |

`rollup -c -w`: adding `Buton.tsx` fails the next rebuild with `[F2]`, deleting it passes again; breaking and fixing a contract does the same with `[F1]`.

Without the plugin, use `"build": "stunt-double check && rollup -c"`: the check covers every row above except the bundle audit.

## Known gaps

- The audit sees only bundled modules: anything in `external` is not audited for duplicates (the install-level F8 preflight still runs).
