# customer-esbuild

An esbuild 0.28 app that injects its own components into the fixture SDK `@acme/core` with stunt-double. It uses exactly
the three-step setup:

1. `npm i -D stunt-double` (here: the tarball from `npm run setup` at the repository root);
2. one line in [build.mjs](build.mjs): `plugins: [stuntDoubleEsbuild()]` (the esbuild CLI cannot load plugins, so the build is a
   script);
3. overrides in [src/overrides/](src/overrides): `Button` wraps the SDK default, `PriceTag` replaces it (a `memo()`
   component), and `Logo` implements the slot the SDK requires.

There is no stunt-double config, no tsconfig edit, no `.gitignore` edit and no extra dependency line. Generated
files go to `.stunt-double/`, which ignores itself.

The only fixture-specific line is `"overrides"` in [package.json](package.json): `@acme/core` declares the
required peer `@acme/core-slots`, which npm auto-installs from the company registry in a real project. This
repository has no registry, so the override points that peer at the placeholder tarball in `../../.packs`.

```bash
npm run setup                  # at the repository root: builds .packs/
npm install
npm run build                  # client + SSR bundles; fails with an [Fx] report on any injection mistake
npm run probe                  # renders the SSR bundle and prints the render markers
npm run build:alias            # the zero-plugin variant: `stunt-double check && esbuild` with alias: stuntDoubleAlias()
```

Docs: [docs/tools/esbuild.md](../../docs/tools/esbuild.md). Tests: `npm test -- esbuild` at the repository root.
