# customer-parcel

A Parcel 2 browser app that injects its own components and services into the fixture SDK `@acme/core` with
stunt-double. The overrides in [src/overrides/](src/overrides) are the same as customer-vite's.

Parcel loads resolvers from `parcel-resolver-*` packages or local files, so the setup is a one-line file and one
`.parcelrc` entry, plus package exports for the SDK's subpaths:

```js
// parcel-resolver-stunt-double.mjs
export { default } from 'stunt-double/parcel';
```

```json
// .parcelrc
{ "extends": "@parcel/config-default", "resolvers": ["./parcel-resolver-stunt-double.mjs", "..."] }

// package.json
"@parcel/resolver-default": { "packageExports": true }
```

```bash
npm run setup                  # at the repository root: builds .packs/
npm install
npm run build                  # parcel build; fails with an [Fx] report on any injection mistake
npm run probe                  # renders dist/ in Chromium and prints the render markers
```

Run Parcel from this directory: plugins are not told the app's directory, and in a monorepo Parcel's project root
is the repository root. (For the same reason, run it from a copy outside this repository, as the test harness
does, or Parcel reads `@parcel/resolver-default` from the repository's root package.json.)
