# esbuild

stunt-double ships a native esbuild plugin, `stuntDoubleEsbuild()` from `stunt-double/esbuild`. It runs the same validation, contract type check and bundle audit as the Vite plugin, and every injection mistake fails `esbuild.build()` with an `[Fx]` message.

Verified with esbuild 0.28.2, TypeScript 7.0.2, React 19.3.0 and Node 22.22.0. Reference project: [`examples/customer-esbuild`](../../examples/customer-esbuild).

## Setup

```js
// build.mjs  (run it with `node build.mjs`; the esbuild CLI cannot load plugins)
import * as esbuild from 'esbuild';
import { stuntDoubleEsbuild } from 'stunt-double/esbuild';

try {
  await esbuild.build({
    entryPoints: ['src/main.tsx'],
    bundle: true,
    jsx: 'automatic',
    outdir: 'dist',
    logLevel: 'info',
    plugins: [stuntDoubleEsbuild()],
  });
} catch {
  process.exit(1); // the errors are already printed
}
```

Plus the usual project wiring from `npx stunt-double init`: the `@acme/core-slots` link in `package.json`, `paths` and `files` in `tsconfig.json`, and `"postinstall": "stunt-double gen --no-fail"`.

What the plugin does:

| Hook | What it does |
|---|---|
| `setup` | Validates `src/overrides` and writes the shims. Sets `metafile: true` (needed for the audit). |
| `onStart` | Regenerates on every `context.rebuild()` / watch rebuild. Validation errors and contract type errors are returned as esbuild `errors`, so the build fails. |
| `onResolve` | Maps `@acme/core-slots/<Slot>` to `sdk-slots/gen/<Slot>.jsx`. |
| `onEnd` | Audits the metafile: an SDK default that reached the bundle around its slot, a socket resolved elsewhere, or a second copy of React or the SDK fails the build. |

Options: `typecheck: false` skips the contract check, `audit: false` skips the audit. Every option of `stunt-double.config.json` can also be passed here.

Two esbuild behaviours the plugin works around, so you don't have to:

- esbuild writes output files **before** `onEnd` runs. The plugin holds the write (`write: false` internally) and writes the files itself only after the audit passed, so a failed build leaves no fresh bundle behind. If you set `write: false` yourself, nothing changes for you.
- esbuild 0.28 fails the build on `onEnd` errors but never prints them. The plugin prints them in esbuild's own format (unless `logLevel: 'silent'`).

### Zero-plugin variant

If you cannot add a plugin, use esbuild's `alias` option and chain the check in the script:

```js
import { stuntDoubleAlias } from 'stunt-double/esbuild';
await esbuild.build({ /* ... */, alias: stuntDoubleAlias() });
```

```json
"scripts": { "build": "stunt-double check && node build.mjs" }
```

`stuntDoubleAlias()` validates and throws on validation errors when the build script starts, but it does not run the contract type check or the audit: keep `stunt-double check &&`.

## Which mistakes fail where

"Build" means `node build.mjs` exits non-zero with the message shown. The catalogue IDs are explained in [DESIGN.md §2](../DESIGN.md#2-failure-catalogue-the-north-star).

| Mistake | `stuntDoubleEsbuild()` | `alias` + `stunt-double check &&` | bare esbuild, link only, no chain |
|---|---|---|---|
| F1 props don't fit the contract (extra required prop, narrowed union, ignored props, SDK upgrade widened the contract); F9c async client override | build (type gate in `onStart`) | `check` | **passes** |
| F1c `forwardRef`, `memo`, class overrides (must pass) | passes | passes | passes |
| F2a typo'd or stray override file | build (`onStart`) | `check` (and `stuntDoubleAlias()` throws) | passes (file unused) |
| F2b slot renamed / new required slot in an SDK upgrade | build, with the rename hint | `check` | build: `Could not resolve` (no such shim) |
| F3 required slot missing | build | `check` | build: `Could not resolve` (native) |
| F4 two files claim a slot | build | `check` | passes |
| F5 wrong export name | build | `check` | build: `No matching export` (native) |
| F6a SDK imports a default directly (checked in the installed dist) | build | `check` | passes: the SDK default renders there (R2) |
| F6b `@acme/core-slots` not linked (registry placeholder) | passes: the plugin is the wiring | passes: the alias is the wiring | build: `Could not resolve "./STUNT-DOUBLE-NOT-WIRED …"` |
| F6g app code imports `@acme/core/original/X` | build (import scan) | `check` | passes |
| F6c a server build leaves the SDK external (`packages: 'external'`, `external: ['@acme/*']`) | build (`onEnd`: `[F6] esbuild leaves "@acme/core" external`; nothing is written). An external *socket* alone is harmless: the plugin's `onResolve` wins | not checked: loud when Node starts (placeholder poison or `.jsx` shim) | same as the chain |
| F6g a plugin resolves a socket before this one | build (`onEnd` audit; nothing is written) | not checked | n/a |
| F6h override deleted without regenerating | regenerated: the SDK default renders, correctly | regenerated | build: `Could not resolve` (old shim) |
| F6h override added without regenerating | regenerated: the override renders | regenerated | passes: **the SDK default renders** (R1) |
| F7 override imports its own slot (directly or through a helper) | build | `check` | passes: infinite render at runtime |
| F8 duplicate React / SDK | build (install preflight + `onEnd` audit) | `check` (preflight only) | passes |
| F9b `server-only` in a client slot | build | `check` | fails only because `server-only` is not installed |

Watch mode and `context.rebuild()`: every rebuild regenerates and re-runs the type gate, so adding `Buton.tsx` fails the next rebuild and removing it makes the next one pass. esbuild has no browser overlay; errors print in the terminal.

## Known gaps

- `esbuild` on the command line cannot load plugins. Use a build script, or the zero-plugin variant with `stunt-double check &&`.
- The esbuild audit sees only what esbuild bundled. Packages you mark `external` (for example React in an SSR build) are not audited for duplicates there; the install-level F8 preflight still runs.
- `unplugin`'s esbuild adapter is not supported: it drops plugin errors and bundles overrides twice. Use `stunt-double/esbuild`.
