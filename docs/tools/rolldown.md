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

Plus the usual project wiring from `npx stunt-double init`: the `@acme/core-slots` link in `package.json`, `paths` and `files` in `tsconfig.json`, and `"postinstall": "stunt-double gen --no-fail"`.

- Rolldown resolves, transforms TSX and handles CommonJS on its own: no other plugins are needed.
- The SDK keeps its `"use client"` directives, so a client bundle logs `MODULE_LEVEL_DIRECTIVE` warnings. They are harmless; the example filters them with `onLog`.
- An SSR bundle must bundle the SDK (`external` may list React, never `@acme/core`), otherwise Node loads the SDK natively and fails on the `.jsx` shims.

The hooks are the same as in [Rollup](rollup.md#setup): `options` validates and writes the shims, `resolveId` maps `@acme/core-slots/<Slot>` to `sdk-slots/gen/<Slot>.jsx`, `buildStart` fails the build on validation and contract errors (and regenerates on every watch rebuild), and `buildEnd` audits the module graph. Options: `typecheck: false`, `audit: false`, plus every option of `stunt-double.config.json`.

## Which mistakes fail where

"Build" means `rolldown -c` exits non-zero with the message shown. The IDs are explained in [DESIGN.md §2](../DESIGN.md#2-failure-catalogue-the-north-star).

| Mistake | `stuntDouble()` | bare Rolldown, link only, no chain |
|---|---|---|
| F1 props don't fit the contract; F9c async client override | build (type gate at `buildStart`) | **passes** |
| F2 typo'd or stray override file; F2b slot renamed or removed in an SDK upgrade | build (`buildStart`) | passes (file unused) |
| F3 required slot missing | build | build (native `UNRESOLVED_IMPORT`) |
| F4 two files claim a slot | build | passes |
| F5 wrong export name | build | build (native `MISSING_EXPORT`) |
| F6a SDK imports a default directly | build (installed-dist scan) | passes (R2) |
| F6b tool not wired at all | n/a | build: `Could not resolve './STUNT-DOUBLE-NOT-WIRED …'` |
| F6g app imports `@acme/core/original/X`; a plugin resolves a socket elsewhere | build (import scan; `buildEnd` audit) | passes |
| F6h override added/removed without regenerating | regenerated on every build and watch rebuild | previous decision |
| F7 override imports its own slot | build | passes: infinite render at runtime |
| F8 duplicate React / SDK | build (preflight + audit) | passes: runtime crash |
| F9b `server-only` in a client slot | build | passes |

`rolldown -c -w`: adding `Buton.tsx` fails the next rebuild with `[F2]`, deleting it passes again; breaking and fixing a contract does the same with `[F1]`.

Without the plugin, use `"build": "stunt-double check && rolldown -c"`: the check covers every row above except the bundle audit.

## Known gaps

- The audit sees only bundled modules: anything in `external` is not audited for duplicates (the install-level F8 preflight still runs).
- Vite 8 uses Rolldown internally; for Vite projects follow the Vite setup, not this page.
