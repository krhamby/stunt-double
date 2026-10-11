# customer-parcel

Injects the same overrides as customer-vite into `@acme/core` with **Parcel 2.16.4**: a wrapped `Button`
(via `@acme/core/original/Button`), a replaced `memo` `PriceTag` and the required `Logo`, reading the app's
`ThemeProvider` context, in app code and inside the SDK's `<Checkout>`.

```sh
npm install && npm run setup         # repo root: packs .packs/
npm install                          # here (writes the lockfile Parcel uses to find this project root)
npm run build                        # stunt-double check && parcel build  (the plugin also checks inside parcel build)
npm run probe                        # SSR render of dist-ssr/entry-server.js -> app: / sdk: / STUNT-DOUBLE-RENDER
npm run probe:browser                # the same from the live DOM in headless Chromium (needs playwright)
node probes/bundles.mjs dist dist-ssr  # React copies per bundle (R5)
```

Setup, the verified mistake matrix and the `"use client"` findings: [docs/tools/parcel.md](../../docs/tools/parcel.md).
