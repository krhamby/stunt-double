# customer-bun

A Bun 1.4 app (Bun.build, the Bun dev server, `bun test`) that injects its own components into the fixture SDK
`@acme/core` with stunt-double. It uses the three-step setup:

1. `bun add -d stunt-double` (here: the tarball from `npm run setup` at the repository root);
2. one line in [build.ts](build.ts): `plugins: [stuntDoubleBun()]` (the `bun build` CLI cannot load plugins);
3. overrides in [src/overrides/](src/overrides): `Button` wraps the SDK default, `PriceTag` replaces it (a `memo()`
   component), and `Logo` implements the slot the SDK requires.

[bunfig.toml](bunfig.toml) adds the same plugin to the dev server and the `stunt-double/bun-test` preload to
`bun test`. There is no stunt-double config, no tsconfig edit, no link and no postinstall; generated files go to
`.stunt-double/`, which ignores itself.

The only fixture-specific line is `"overrides"` in [package.json](package.json): `@acme/core` declares the peer
`@acme/core-slots`, which Bun installs from the company registry in a real project. This repository has no registry,
so the override points that peer at the placeholder tarball in `../../.packs`. `bun.lock` is git-ignored: it would pin
the old contents of rebuilt tarballs.

```bash
npm run setup                  # at the repository root: builds .packs/
bun install
bun run build                  # browser + SSR bundles; fails with an [Fx] report on any injection mistake
bun run probe                  # renders the SSR bundle and prints the render markers
bun test                       # validates first (exit 1 with [Fx] on a mistake), then runs the tests
bun run dev                    # bun ./index.html
```
