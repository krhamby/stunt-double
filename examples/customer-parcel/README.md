# customer-parcel

A Parcel 2.16.4 app that injects its own components into the fixture SDK `@acme/core` with stunt-double: a
wrapped `Button` (via `@acme/core/original/Button`), a replaced `memo()` `PriceTag` and the required `Logo`,
reading the app's `ThemeProvider` context, both in app code and inside the SDK's `<Checkout>`.

The default Parcel setup:

1. `npm i -D stunt-double` (here: the tarball from `npm run setup` at the repository root);
2. [parcel-resolver-stunt-double.cjs](parcel-resolver-stunt-double.cjs) (two lines) listed in [.parcelrc](.parcelrc);
3. `"@parcel/resolver-default": { "packageExports": true }` in [package.json](package.json);
4. overrides in [src/overrides/](src/overrides).

The only fixture-specific line is `"overrides"` in package.json: it stands in for the registry copy of the peer
`@acme/core-slots`.

```bash
npm run setup                    # at the repository root: builds .packs/
npm install
npm run build                    # parcel build: fails with an [Fx] report on any injection mistake
npm run probe                    # SSR render of dist-ssr/entry-server.js -> app: / sdk: / STUNT-DOUBLE-RENDER
npm run probe:browser            # the same from the live DOM in headless Chromium (needs playwright)
node probes/bundles.mjs dist dist-ssr   # React copies per bundle (R5)
```

Inside this repository Parcel takes the repository root as its project root (the nearest lockfile), so the build
stops with a [CFG] message naming the root package.json. `tests/parcel.test.mjs` builds a copy outside the
repository. The universal tier (`init --universal` + `stunt-double check && parcel build`) is tested there too.
See [docs/tools/parcel.md](../../docs/tools/parcel.md).
