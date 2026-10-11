# stunt-double with Parcel 2

Verified with **Parcel 2.16.4**, TypeScript 7.0.2, React 19.3.0 and Node 22.22.0 (October 2026). The verified example is [`examples/customer-parcel`](../../examples/customer-parcel) and the suite is [`tests/parcel.test.mjs`](../../tests/parcel.test.mjs).

## Setup

Parcel has no plugin hook in its config file, so stunt-double ships a **resolver plugin**. It resolves the SDK's slot imports to the generated shims (no link needed) and runs stunt-double's checks and the contract type gate inside `parcel build` and `parcel serve`. Four steps:

1. `npm i -D stunt-double`
2. A two-line local plugin file. Parcel accepts `.parcelrc` plugin names only as `parcel-resolver-*`, `@scope/parcel-resolver[-*]` or a relative path (`validatePackageName` in `@parcel/core`), so `"stunt-double/parcel"` cannot be listed directly:

   ```js
   // parcel-resolver-stunt-double.cjs
   const { stuntDouble } = require('stunt-double/parcel');
   module.exports = stuntDouble({ root: __dirname });   // options: any stunt-double.config.json key, typecheck: false
   ```

   ```json
   // .parcelrc
   { "extends": "@parcel/config-default", "resolvers": ["./parcel-resolver-stunt-double.cjs", "..."] }
   ```

3. Package exports on, in `package.json`. Parcel 2.16 leaves them off, and `@acme/core/original/*` (wrapping a default) needs them. Without this line the plugin fails the build with `[CFG]`:

   ```json
   "@parcel/resolver-default": { "packageExports": true }
   ```

4. Overrides in `src/overrides/<Slot>.tsx`.

There is no link, no tsconfig edit, no `.gitignore` edit and no postinstall. Generated files go to `.stunt-double/`, which ignores itself; Parcel's watcher sees writes there (verified in dev). `stunt-double doctor` recognizes the `.parcelrc` plugin. Keep `stunt-double check` in CI.

The plugin file is CommonJS on purpose. An `.mjs` file works too (`export default stuntDouble({ root: import.meta.dirname })`), but Parcel then warns "ES module dependencies are experimental" on every build. No wrapper package is needed.

**Server rendering.** A node target must be a library, or Parcel duplicates React (see below):

```json
"targets": {
  "app": { "source": "index.html", "distDir": "dist" },
  "ssr": { "source": "src/entry-server.tsx", "context": "node", "outputFormat": "esmodule",
           "includeNodeModules": true, "isLibrary": true, "distDir": "dist-ssr" }
}
```

**What the plugin does:**

- **`loadConfig`** runs the generator, the `packageExports` check and then the type gate. It reruns at every Parcel start, and in watch mode when a file in `src/overrides/` is created, changed or deleted, or when the config or the SDK manifest changes.
  - In `parcel build`, an error is thrown there: the build exits 1 with the `[Fx]` lines.
  - In `parcel serve` and `parcel watch`, the error is thrown from `resolve()` instead. Parcel keeps a config's invalidations only when `loadConfig` returns, so throwing there would leave the dev server stuck on the error until restart.
- **`resolve`** maps `@acme/core-slots/<Slot>` to `.stunt-double/gen/<Slot>.jsx` and passes the shim text as `code`. Parcel's asset id hashes it, so a warm `.parcel-cache` cannot replay the previous override decision.
- It never uses Parcel `alias`: a typo'd alias key is silently ignored.

**Without the plugin (universal tier).** Run `npx stunt-double init --universal`. It adds:

- `sdk-slots/package.json`, a stub to commit;
- `"@acme/core-slots": "file:./sdk-slots"`, the link (pnpm `link:`, Yarn `portal:`, Bun `workspace:*`);

and generated files then go to `sdk-slots/`. Then run `npm install`, keep the `packageExports` line, and prefix every Parcel script: `stunt-double check && parcel build`. Without that prefix, stunt-double's own checks never run (see "bare" below).

**Monorepos.** Parcel's project root is the nearest directory above the entry with a lockfile or `.git`. Parcel reads `@parcel/resolver-default` from *that* `package.json` and puts `.parcel-cache` there. If the app has no lockfile of its own, put the key in the root `package.json`. The plugin's `[CFG]` message names the file Parcel reads.

## Which mistake fails where

Three tiers:

- **T1**: the default setup above (plugin, no link) with a bare `parcel build`.
- **chain**: universal tier, `stunt-double check && parcel build`.
- **bare**: universal tier with no chain (what R1 warns about).

Every cell is observed in `tests/parcel.test.mjs`.

| # | Mistake | T1 `parcel build` | chain | bare `parcel build` | `parcel serve` + plugin | `stunt-double watch -- parcel serve` | bare `parcel serve` |
|---|---|---|---|---|---|---|---|
| F1a | Props incompatible | exit 1 `[F1] … TS2322` (type gate, ~0.2 s) | exit 1 | **passes**, renders | `[F1]` error page, cleared on fix | silent | silent |
| F1b | Override ignores contract props | exit 1 `[F1] … ignores these SDK props` | exit 1 | **passes** | | | |
| F2a | Typo file `Buton.tsx` | exit 1 `[F2]` | exit 1 | **passes** (file unused) | `[F2]` error page, cleared on fix | poison `[F2]`, cleared | silent |
| F2b | SDK renames a slot (2.0.0) | exit 1 `[F2] RENAMED` + `[F3] Footer` | exit 1 | exit 1 (RES: no `Price` shim) | | | |
| F3 | Required `Logo` missing | exit 1 `[F3]` | exit 1 | exit 1 (RES: stale shim target gone) | `[F3]` error page, cleared | poison `[F3]`, cleared | `Failed to resolve '../../src/overrides/Logo.tsx'`, cleared |
| F4 | `Button.tsx` + `Button/index.tsx` | exit 1 `[F4]` | exit 1 | **passes** (previous shim) | | | |
| F5 | Default instead of named export | exit 1 `[F5]` | exit 1 | exit 1 (native export check) | | | |
| F6a | SDK imports a default relatively | exit 1 `[F6]` | exit 1 | **passes**, SDK default inside Checkout (R2) | | | |
| F6b | Not wired: plugin missing from `.parcelrc` (T1), placeholder instead of the link (universal) | exit 1 `STUNT-DOUBLE-NOT-WIRED` | exit 1 `[F6]` wiring | exit 1 `STUNT-DOUBLE-NOT-WIRED` | | | |
| F6f | Slot package copied, not linked | n/a (no link) | exit 1 `[F6]` wiring | exit 1 (copied shims' relative paths) | | | |
| F6g | App imports `@acme/core/original/Button` | exit 1 `[F6]` | exit 1 | **passes**, default at that call site | | | |
| F6h | Override removed, shims not regenerated | regenerated, correct | regenerated | exit 1 (RES on the stale shim) | regenerated | regenerated | |
| F7 | Override imports its own slot | exit 1 `[F7]` | exit 1 | **passes; runtime** unbounded render → heap OOM | | | |
| F8 | SDK bundles its own React | exit 1 `[F8]` | exit 1 | **passes; runtime** `useContext` of null | | | |
| F9c | Async override in a client slot | exit 1 `[F9]` | exit 1 | **passes; runtime** "A component suspended while responding to synchronous input" | | | |
| CFG | `packageExports` not enabled | exit 1 `[CFG] Parcel resolves without package "exports"` | exit 1 (resolve error) | exit 1 (resolve error) | | | |

Blank cells were not run separately. No post-bundle audit (AUD) runs under Parcel: no resolver hook sees the finished bundle graph. The static F6/F8 checks above cover the same cases at install level.

## `"use client"` and duplicate React (R5)

Parcel 2.16's JS transformer moves a module with `"use client"` into a separate `react-client` environment only when `env.isServer() && !env.isLibrary`, i.e. node (or react-server) targets that are not libraries (`@parcel/transformer-js` `JSTransformer.js`). The SDK's `Checkout.js` carries `"use client"`. Observed:

| Target | Bundles | React copies (source maps) | Runs? |
|---|---|---|---|
| browser (`index.html`) | 1 | 1 | yes, headless Chromium, 0 errors |
| browser, `Checkout` code-split with `lazy()` | 2 | 1 (shared) | yes, Chromium, 0 errors |
| node, `isLibrary: true` (the SSR target above) | 1 | 1 | yes |
| node, `isLibrary: false` | 2 | **2** | **crashes**: `TypeError: Cannot read properties of null (reading 'useContext')` |
| node, `isLibrary: false`, shims with `rsc: true` | — | — | **`parcel build` crashes**, exit 1 (`Error: Does not have node …`, Parcel internal) |

So browser targets are unaffected. Node targets must set `isLibrary: true`. stunt-double cannot detect this from a resolver, and the SDK's own directive triggers it even when stunt-double emits none.

## Known gaps

- In the universal tier without the chain, F1, F2, F4, F6a, F6g, F7, F8 and F9c pass the build (R1). Use the plugin, or keep `stunt-double check &&` in every script, and run `stunt-double check` in CI.
- In dev without the plugin, use `stunt-double watch -- parcel serve`: it reports F2/F3 through poisoned shims but runs no type gate (F1 is silent).
- With the plugin, dev reruns the type gate only when a file in the overrides dir (or a mapped implementation) changes, not when a module it imports changes. The production build always runs it.
- `parcel watch --no-hmr` is treated like a build: a stunt-double error is thrown from `loadConfig`, and fixing it needs a restart.
