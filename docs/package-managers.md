# Package managers

The adapter tier works the same with every package manager: the adapter line is the whole wiring, and nothing is linked. The differences are in how the SDK's peer `@acme/core-slots` gets installed, which decides the error a *forgotten* tool gives, and in the link form of the universal tier.

| | npm 10 | pnpm 10 | Yarn 4 (Plug'n'Play) |
|---|---|---|---|
| Verified by | every toolchain suite | `tests/vite-pnpm.test.mjs` | `tests/vite-yarn-pnp.test.mjs` |
| The SDK's peer `@acme/core-slots` | auto-installed from the registry: the placeholder | auto-installed: the placeholder | **not installed** (Yarn installs no peers; a missing-peer warning at install) |
| A tool nobody wired fails with | `STUNT-DOUBLE-NOT-WIRED -- …` | `STUNT-DOUBLE-NOT-WIRED -- …` | Yarn's `@acme/core tried to access @acme/core-slots (a peer dependency) but it isn't provided` |
| Universal-tier link (`init --universal`) | `"file:./sdk-slots"` | `"link:./sdk-slots"` (`file:` is a stale copy: `[F6]`) | `"portal:./sdk-slots"` |
| Type gate | any TypeScript | any TypeScript | TypeScript **5.9 as the project's `typescript`** |

Either failure is a resolve error that stops the build. Neither tier ever renders SDK defaults silently.

## Yarn Plug'n'Play

- **TypeScript.** TypeScript 7.0 cannot resolve modules under PnP, so the gate refuses it up front with [`[TS-PNP]`](errors.md#ts-pnp--typescript-7-under-yarn-pnp). Make `typescript@5.9` the project's own `typescript` dev dependency: Yarn's built-in compat patch applies to the package named `typescript` only, so an npm alias such as `typescript5@npm:typescript@5.9` stays unpatched and cannot resolve under PnP either.
- **Running tools.** There is no `node_modules/.bin`: run everything through Yarn (`yarn vite build`, `yarn stunt-double check`, `yarn node …`). The gate's `tsc` child keeps Yarn's PnP runtime (`--require .pnp.cjs`); without it, it could not even read `tsc` from the zip cache.
- **Vite.** Vite 8 works under PnP, but it warns that PnP is discouraged and that PnP-specific Vite bugs are no longer actively fixed.
- **The universal tier.** The `sdk-slots/package.json` stub must declare no peers, or PnP turns it into a `__virtual__` copy that duplicates project modules (`[F8]`).
- **CI.** Yarn installs immutably when `CI` is set; commit `yarn.lock`.

## Bun

`bun install` with a `"workspace:*"` link plus `"workspaces": ["sdk-slots"]` is the designed universal-tier form (`link:` means Bun's global registry, and `file:` is a copy). It is not yet run in a suite; the Bun *bundler* is verified with npm-installed packages ([tools/bun.md](tools/bun.md)).
