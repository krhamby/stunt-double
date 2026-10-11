# Package managers: npm, pnpm, Yarn (Plug'n'Play), Bun

**The default setup is the same under every package manager**: install `stunt-double`, add the adapter to your
tool's config, put overrides in `src/overrides/`. The adapter points the SDK's socket imports
(`@acme/core-slots/Button`, …) at shims it generates into `.stunt-double/`, so nothing about the install layout
matters. We verified it under npm, pnpm, Yarn Plug'n'Play and Bun.

Package managers only matter for two things:

1. **The universal tier** (tools without a stunt-double adapter, see [other-bundlers.md](other-bundlers.md)).
   There your project answers the sockets with a *linked* package, `sdk-slots/`, and every package manager
   spells "link" differently. Get it wrong and the SDK sees a stale copy, another app's package, or the
   placeholder. stunt-double's wiring self-test checks which one the SDK really resolves, in every adapter
   start and every `stunt-double check`.
2. **Yarn Plug'n'Play and the type gate**: TypeScript 7 cannot resolve modules under PnP (below).

## The SDK's peer: `@acme/core-slots`

The SDK declares `@acme/core-slots` as a required peer, and your company registry serves a *placeholder* under
that name whose only content is an import that cannot resolve. We published the SDK and the placeholder to a
local registry and installed a three-step project with each package manager:

| Package manager | The placeholder peer | Three-step build | A tool you forgot to wire |
|---|---|---|---|
| npm 10, pnpm 12, Bun 1.4 | installed automatically | passes, overrides render | fails: `STUNT-DOUBLE-NOT-WIRED -- … run npx stunt-double doctor` |
| Yarn 4 | not installed; Yarn warns `YN0002 … doesn't provide @acme/core-slots (…), requested by @acme/core` | passes, overrides render | fails with a plain `Could not resolve '@acme/core-slots/Button'` |

Either way, a tool you forgot to wire never renders the SDK defaults. Under Yarn, add the placeholder as a dependency
(`yarn add @acme/core-slots`) if you want the explanatory message.

Yarn 4 also quarantines package versions published less than `npmMinimalAgeGate` ago (`YN0016 … All versions
satisfying "1.0.0" are quarantined`). On the day the SDK team publishes a release, either wait or allow the
company scope in `.yarnrc.yml`: `npmScopes: { acme: { npmMinimalAgeGate: 0 } }`.

## Universal tier: the link line

`npx stunt-double init --universal` writes the committed stub `sdk-slots/package.json` and the link line for
the package manager it detects (from `packageManager` in `package.json`, then the lockfile). Run your package
manager's install afterwards. Generated files then live in `sdk-slots/` (which ignores everything except the
stub) instead of `.stunt-double/`.

| Package manager | Dependency line in `package.json` | Extra |
|---|---|---|
| **npm** 10 | `"@acme/core-slots": "file:./sdk-slots"` (a symlink) | — |
| **pnpm** 12 | `"@acme/core-slots": "link:./sdk-slots"` | — |
| **Yarn** 4, Plug'n'Play | `"@acme/core-slots": "portal:./sdk-slots"` | type gate: see below |
| **Bun** 1.4 | `"@acme/core-slots": "workspace:*"` | `"workspaces": ["sdk-slots"]` |

The stub must have **no `dependencies` and no `peerDependencies`**:

```json
{
  "name": "@acme/core-slots", "version": "0.0.0", "private": true, "type": "module", "sideEffects": false,
  "exports": { "./package.json": "./package.json", "./*": { "types": "./gen/*.d.ts", "default": "./gen/*.jsx" } }
}
```

Add `"postinstall": "stunt-double gen --no-fail"` (or run `init --universal --editor`), so a fresh clone has the
shims before an adapter-less tool runs. It never blocks an install, and it ran under all four package managers
(pnpm needs no `allowBuilds` entry for your own project's scripts).

## Yarn Plug'n'Play and TypeScript

TypeScript 7 cannot resolve modules under Plug'n'Play, and neither can an unpatched TypeScript 5: Yarn patches
only the dependency literally named `typescript`. If your `typescript` is 5.x or 6.x (create-vite ships 6.0),
there is nothing to do. If it is 7, give the type gate Yarn's patched 5.9 under another name:

```jsonc
// package.json
"devDependencies": {
  "typescript": "7.0.2",
  "typescript5": "patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>"
}
```

```json
// stunt-double.config.json
{ "typescript": "typescript5" }
```

If you forget, the build stops up front instead of failing with confusing TS2307 / TS2688 errors:

```text
[TS-PNP] TypeScript 7.0.2 cannot resolve modules under Yarn Plug'n'Play: add "typescript5": "patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>" to devDependencies (Yarn's PnP-patched TypeScript 5.9) and set "typescript": "typescript5" in stunt-double.config.json.
[TS-PNP] "typescript5" is TypeScript 5.9.3 WITHOUT Yarn's PnP patch, so it cannot resolve modules under Plug'n'Play (a plain "npm:typescript@..." alias is not patched): add …
```

Vite prints "Using Yarn PnP with Vite is discouraged"; builds and renders were nevertheless correct in every run
below. Run scripts and Node through Yarn (`yarn build`, `yarn node …`) so the PnP runtime is loaded.

## npm workspaces with several apps

npm hoists the SDK to the workspace root, and a hoisted SDK sees **one** `@acme/core-slots`: whichever app npm
linked at the root. If several apps use the universal tier's link, the other apps resolve the first app's
package. We reproduced it: app B's bare `vite build` exits 0 and renders app A's `Button`, without app B's theme
context. Every gated build catches it:

```text
[F6] @acme/core resolves @acme/core-slots to ../a/sdk-slots (a copy, or another app's slot package), not sdk-slots/. Use npm "file:", pnpm "link:", Yarn "portal:", Bun "workspace:*", then reinstall.
```

**Fix:** use the default (adapter) setup in multi-app npm workspaces: no `@acme/core-slots` line in any app. Each
app's adapter points the sockets at its own shims; any tool you forgot to wire fails on the placeholder instead
of picking up another app's overrides (both verified). pnpm, Yarn and Bun give each app its own SDK instance.

## What was verified

Versions: Node 22.22.0, npm 10.9.4, pnpm 12.11.2, Yarn 4.18.1 (`nodeLinker: pnp`), Bun 1.4.2, Vite 8.3.4,
React 19.3.0, TypeScript 7.0.2, 6.0.3 and 5.9.3, create-vite 9.2.1, stunt-double 0.1.0, `@acme/core` 1.0.0 and
its broken variants.

The reference app (`examples/customer-vite`: a `Button` override that wraps the default, a `PriceTag` that
replaces it, the required `Logo`) was installed fresh under each package manager in two setups:

- **adapter**: `stuntDouble()` in `vite.config.ts`, no link; script `vite build && vite build --ssr …`;
- **universal**: no plugin, `ssr.noExternal: ['@acme/core']`, the `sdk-slots/` link, script
  `stunt-double check && vite build && …`, and the same build without the prefix ("bare").

In all 8 combinations the client and SSR builds pass, and the server-rendered output carries the overrides both
in app code and inside the SDK's `<Checkout>`, with the app's own theme context reaching them. On a fresh
`npm create vite@9.2.1 -- --template react-ts` app, `stunt-double init --plugin` and then `init --universal`
gave a building project under all four package managers.

The whole shared mistake catalogue (`tests/mutations/`: 30 mistakes plus the Vite-family ones, the TypeScript
5.9 type gate and the universal tier) runs against that app under every package manager: `tests/vite.test.mjs`
(npm), `tests/pnpm.test.mjs`, `tests/yarn.test.mjs` and `tests/bun.test.mjs`. Every mistake fails the build with
its `[Fx]` code under all four, with two Yarn differences: the nested-React mistake cannot occur (below), and
plain Node reports the placeholder through PnP's resolver (`Qualified path resolution failed … STUNT-DOUBLE-NOT-WIRED`)
instead of `ERR_MODULE_NOT_FOUND`. `tests/package-managers.test.mjs` pins the bare universal-tier column below,
`tests/pm-wiring.test.mjs` the wiring mistakes, `tests/pm-init.test.mjs` the `init` runs, `tests/pm-registry.test.mjs`
the registry path above (Verdaccio 6.10.5) and
`tests/typescript-matrix.test.mjs` the contract cases.

## Which mistakes fail where

Identical under npm, pnpm, Yarn PnP and Bun unless a cell says otherwise. "Adapter" = `vite build` with the
plugin; "chained" = `stunt-double check && vite build` without it; "bare" = `vite build` alone.

| Mistake | Adapter | Universal, chained | Universal, bare |
|---|---|---|---|
| F1 contract mismatch (extra required prop) | exit 1 `[F1]` (type gate in `buildStart`) | exit 1 `[F1]` | **exit 0, the wrong component ships** |
| F2 typo'd file `Buton.tsx` | exit 1 `[F2] … did you mean "Button"?` | exit 1 `[F2]` | **exit 0, the file is silently unused** |
| F3 required `Logo` missing | exit 1 `[F3]` | exit 1 `[F3]` | exit 1 `UNRESOLVED_IMPORT` |
| F4 `Button.tsx` + `Button/index.tsx` | exit 1 `[F4]` | exit 1 `[F4]` | **exit 0, previous decision** |
| F5 default instead of named export | exit 1 `[F5]` | exit 1 `[F5]` | exit 1 `MISSING_EXPORT` |
| F6g app imports `@acme/core/original/Button` | exit 1 `[F6]` | exit 1 `[F6]` | **exit 0, SDK default at that call site** |
| F7 override imports `Button` from `@acme/core` | exit 1 `[F7]` | exit 1 `[F7]` | **exit 0; rendering runs out of memory** |
| F6a SDK imports a default relatively (`1.0.0-bad-relative`) | exit 1 `[F6] … dist/Checkout.js imports the default …` | exit 1 `[F6]` | **exit 0 with shims from before; SDK default inside `Checkout`** |
| F8 SDK bundles its own React (`1.0.0-nested-react`) | exit 1 `[F8] "react" resolves to 2 copies` (npm, pnpm, Bun). **Yarn: builds correctly**: Yarn ignores `bundleDependencies`, so there is only one React | same | npm, pnpm, Bun: **exit 0, a second React in the client bundle** |
| F2b + F3 SDK upgrade 1.0 → 2.0 (renamed slot, new required slot) | exit 1 `[F2] … RENAMED to "Price"` and `[F3] … "Footer"` | exit 1, same | exit 1 (the 2.0 SDK imports sockets `Price` and `Footer` that have no shim yet) |
| Contract cases under TypeScript 7.0.2 and 5.9.3, `strict` on and off | `FC`, `memo`, `forwardRef`, class and children-returning overrides pass; extra required prop, narrowed union, fewer props, wrong `ref`, `async`, not-a-component fail with `[F1]`/`[F9]`; a default export fails with `[F5]` | same | — |
| Stale shims (override added, nothing regenerated) | regenerated at build start | regenerated by `check` | **exit 0, SDK default**; a project `tsc` that includes the check file (`init --editor`) fails with TS2578 |

Note on the bare column for broken SDKs: when the SDK itself is broken, `postinstall` refuses to write shims, so a
bare build on a fresh clone fails to resolve `@acme/core-slots/*`. The bold cells describe an existing checkout
that still has shims from before.

### Wiring mistakes (universal tier)

| Mistake | Observed |
|---|---|
| pnpm `"file:./sdk-slots"` (a **copy** in `.pnpm/`) | install OK; build exit 1: `[F6] @acme/core resolves @acme/core-slots to node_modules/.pnpm/@acme+core-slots@file+sdk-slots/… (a copy, or another app's slot package), not sdk-slots/` |
| Bun `"file:./sdk-slots"` | `bun install` exits 1 (`GET …/@acme%2fcore-slots - 404`: Bun looks the SDK's peer up in the registry); the build then fails with `[F6] … (a copy …)` |
| Yarn PnP stub with `peerDependencies` | adapter or chained: exit 1 `[F8] @acme/core-slots is a Yarn PnP __virtual__ instance because sdk-slots/package.json declares peerDependencies: remove them …`; bare: exit 1, Vite cannot resolve `@acme/core-slots/Button` from the virtual SDK |
| npm workspaces, two apps each linking `sdk-slots` | app A fine; app B gated builds exit 1 `[F6] … to ../a/sdk-slots`; **app B bare: exit 0 with app A's overrides** |
| No link and no adapter (the placeholder answers) | `stunt-double check` passes (nothing is linked, so there is nothing to self-test); the tool fails: `[UNRESOLVED_IMPORT] Could not resolve './STUNT-DOUBLE-NOT-WIRED -- …'` |

## Known gaps

- **Bare universal builds** are not gated (bold cells). Put `stunt-double check &&` in front of every adapter-less
  build and make `stunt-double check` a required CI step, or use an adapter.
- **npm multi-app workspaces with links** render another app's overrides in bare builds. Use the default adapter
  setup there.
- **Yarn PnP with TypeScript 7** needs the patched TypeScript 5.9 alias for the type gate.
- **Yarn without a placeholder**: a tool you forgot to wire fails with a plain resolve error rather than the
  `STUNT-DOUBLE-NOT-WIRED` text. Add the placeholder (`yarn add @acme/core-slots`) if you want the message.
- **`file:` under pnpm and Bun** is always wrong for `sdk-slots`; use the lines in the table.
