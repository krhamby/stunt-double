# Parcel 2

Parcel loads resolver plugins from `parcel-resolver-*` packages or local files, so the setup is a one-line file and one `.parcelrc` entry:

```js
// parcel-resolver-stunt-double.mjs
export { default } from 'stunt-double/parcel';
```

```json
// .parcelrc
{ "extends": "@parcel/config-default", "resolvers": ["./parcel-resolver-stunt-double.mjs", "..."] }
```

and, in `package.json`, `"@parcel/resolver-default": { "packageExports": true }`: Parcel resolves the SDK's `original/*` and `contracts` subpaths only through its `exports` map (an `[F6]` says so if it is missing).

| Hook | What happens |
|---|---|
| `loadConfig` | validates `src/overrides` and writes `.stunt-double/`; `[F6]` guards (package exports off, a target that leaves the SDK to the runtime); in production builds the contract type check. A problem fails `parcel build` (exit 1) and shows in `parcel serve`. Parcel re-runs it when an override, a file it imports, the config or `package.json` changes, or a file appears in the overrides directory |
| `resolve` | `@acme/core-slots/<Slot>` → `.stunt-double/gen/<Slot>.jsx`. stunt-double never uses Parcel's `alias` (a typo'd alias key is silently ignored) |

Parcel's reporter word-wraps diagnostics at the terminal width, so the resolver also writes the report to stderr verbatim. Run Parcel from the app's directory: plugins are not told it, and in a monorepo Parcel's project root is the repository root. Otherwise pass it: `export default stuntDoubleParcel({ root: '…' })`.

**Node targets.** Parcel bundles `node_modules` for browser targets but not for node targets by default, so an SSR target must bundle the SDK: `"includeNodeModules": { "react": false, "react-dom": false }` (unlisted packages are bundled). Even then, Parcel 2.16 puts an SDK's `"use client"` modules into a separate chunk with its own copy of React in node targets, which crashes at render time (residual R5). That comes from the SDK's own directives, with or without stunt-double. Browser targets are unaffected.

**Verified with** parcel 2.16.4, TypeScript 7.0.2 and 5.9.3: `tests/parcel.test.mjs` runs the shared catalogue, two Parcel-only scenarios (a node target that leaves the SDK to the runtime, package exports off) and the universal tier, rendering the built browser app in Chromium.
