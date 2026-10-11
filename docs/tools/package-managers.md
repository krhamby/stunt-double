# Package managers: npm, pnpm, Yarn (Plug'n'Play), Bun

Your project answers the SDK's socket imports (`@acme/core-slots/Button`, …) with its own small package,
`sdk-slots/`. Tools with a stunt-double adapter reach it through an alias and don't care how it is installed.
Tools **without** an adapter (the [universal tier](other-bundlers.md)), plus `tsc`'s view of the SDK, reach it
through a **link** in `node_modules`, and every package manager spells "link" differently. Get it wrong and
you install a stale *copy*, another app's package, or the SDK team's placeholder. stunt-double's wiring
self-test checks which one the SDK actually resolves, at every adapter start and every `stunt-double check`.

`npx stunt-double init` detects the package manager (from `packageManager`, then the lockfile) and writes the
right line. This page is the reference.

## Setup

| Package manager | Dependency line in `package.json` | Extra |
|---|---|---|
| **npm** 10 | `"@acme/core-slots": "file:./sdk-slots"` (a symlink) | — |
| **pnpm** 12 | `"@acme/core-slots": "link:./sdk-slots"` | — |
| **Yarn** 4, Plug'n'Play | `"@acme/core-slots": "portal:./sdk-slots"` | type gate needs Yarn's patched TypeScript 5.9, see below |
| **Bun** 1.4 | `"@acme/core-slots": "workspace:*"` | `"workspaces": ["sdk-slots"]` |

The committed stub `sdk-slots/package.json` (written by `init`) must have **no `dependencies` and no
`peerDependencies`**:

```json
{
  "name": "@acme/core-slots", "version": "0.0.0", "private": true, "type": "module", "sideEffects": false,
  "exports": { "./package.json": "./package.json", "./*": { "types": "./gen/*.d.ts", "default": "./gen/*.jsx" } }
}
```

Keep `"postinstall": "stunt-double gen --no-fail"` in your scripts. It ran under all four package managers
in our tests (pnpm needs no `allowBuilds` entry for your own project's scripts). It never blocks an install.

### Yarn Plug'n'Play and TypeScript

TypeScript 7 cannot resolve modules under Plug'n'Play, and neither can an unpatched TypeScript 5 (Yarn only
patches the dependency literally named `typescript`). Give the type gate Yarn's patched 5.9 under another
name:

```jsonc
// package.json
"devDependencies": {
  "typescript": "7.0.2",   // your editor / other tools, if you like
  "typescript5": "patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>"
}
```

```json
// stunt-double.config.json
{ "sdk": "@acme/core", "typescript": "typescript5" }
```

If you forget, the build fails up front instead of failing with confusing TS2307/TS2688 errors:

```text
[TS-PNP] TypeScript 7.0.2 cannot resolve modules under Yarn Plug'n'Play: add "typescript5": "patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>" to devDependencies (Yarn's PnP-patched TypeScript 5.9) and set "typescript": "typescript5" in stunt-double.config.json.
[TS-PNP] "typescript5" is TypeScript 5.9.3 WITHOUT Yarn's PnP patch, so it cannot resolve modules under Plug'n'Play (a plain "npm:typescript@..." alias is not patched): add …
```

Vite prints "Using Yarn PnP with Vite is discouraged"; builds and renders were nevertheless correct in every
run below. Run scripts and Node through Yarn (`yarn build`, `yarn node …`) so the PnP runtime is loaded.

### npm workspaces with several apps

npm hoists the SDK to the workspace root, and a hoisted SDK sees **one** `@acme/core-slots`: whichever app
npm linked at the root. With a link in every app, the other apps build their bundles with the first app's
overrides. We reproduced it: app B's bare `vite build` exits 0 and renders app A's `Button`, without app B's
theme context. stunt-double catches it in every gated build:

```text
[F6] @acme/core resolves @acme/core-slots to ../a/sdk-slots (a copy, or another app's slot package), not sdk-slots/. Use npm "file:", pnpm "link:", Yarn "portal:", Bun "workspace:*", then reinstall.
```

**Fix:** in multi-app npm workspaces, use **adapter-only wiring**: no `@acme/core-slots` line in any app, an
adapter in every app's tools, and the registry placeholder installed (it is auto-installed as the SDK's peer).
Each app's adapter then aliases the sockets to its own shims; any tool you forgot to wire fails on the
placeholder instead of picking up another app's overrides (both verified). pnpm, Yarn and Bun give each app
its own SDK instance, so they don't have this problem.

## What was verified

Versions: Node 22.22.0, npm 10.9.4, pnpm 12.11.2, Yarn 4.18.1 (`nodeLinker: pnp`), Bun 1.4.2, Vite 8.3.4,
React 19.3.0, TypeScript 7.0.2 and 5.9.3, stunt-double 0.1.0, `@acme/core` 1.0.0 and its broken variants.

The reference app (`examples/customer-vite`: a `Button` override that wraps the default, a `PriceTag` that
replaces it, the required `Logo`) was installed fresh under each package manager in two tiers:

- **adapter**: `stuntDouble()` in `vite.config.ts`, script `vite build && vite build --ssr …`;
- **universal**: no plugin, `ssr.noExternal: ['@acme/core']`, script `stunt-double check && vite build && …`,
  and the same build without the prefix ("bare").

In all 8 combinations the client and SSR builds pass and the server-rendered output carries the overrides
both in app code and inside the SDK's `<Checkout>`, with the app's own theme context reaching them.

## Which mistakes fail where

Identical under npm, pnpm, Yarn PnP and Bun unless a cell says otherwise. "Adapter" = `vite build` with the
plugin; "chained" = `stunt-double check && vite build` without it; "bare" = `vite build` without either.

| Mistake | Adapter | Universal, chained | Universal, bare |
|---|---|---|---|
| F1 contract mismatch (extra required prop) | exit 1 `[F1]` (type gate in `buildStart`) | exit 1 `[F1]` | **exit 0, wrong component ships** |
| F2 typo'd file `Buton.tsx` | exit 1 `[F2] … did you mean "Button"?` | exit 1 `[F2]` | **exit 0, file silently unused** |
| F3 required `Logo` missing | exit 1 `[F3]` | exit 1 `[F3]` | exit 1 `UNRESOLVED_IMPORT` |
| F4 `Button.tsx` + `Button/index.tsx` | exit 1 `[F4]` | exit 1 `[F4]` | **exit 0, previous decision** |
| F5 default instead of named export | exit 1 `[F5]` | exit 1 `[F5]` | exit 1 `MISSING_EXPORT` |
| F6g app imports `@acme/core/original/Button` | exit 1 `[F6]` | exit 1 `[F6]` | **exit 0, SDK default at that call site** |
| F7 override imports `Button` from `@acme/core` | exit 1 `[F7]` | exit 1 `[F7]` | **exit 0; rendering runs out of memory** |
| F6a SDK imports a default relatively (`1.0.0-bad-relative`) | exit 1 `[F6] … dist/Checkout.js imports the default …` | exit 1 `[F6]` | **exit 0 with existing shims; SDK default inside `Checkout`** |
| F8 SDK bundles its own React (`1.0.0-nested-react`) | exit 1 `[F8] "react" resolves to 2 copies` (npm, pnpm, Bun); **Yarn: builds correctly**, Yarn ignores `bundleDependencies`, so there is only one React | same | npm/pnpm/Bun: **exit 0, a second React in the client bundle** |
| F2b/F3 SDK upgrade 1.0 → 2.0 (renamed + new required slot) | exit 1 `[F2] … RENAMED to "Price"` + `[F3] … "Footer"` | exit 1, same | exit 1 (the 2.0 SDK imports sockets `Price` and `Footer` that have no shim yet) |
| Contract cases, TypeScript 7.0.2 and 5.9.3, `strict` on and off | `FC`, `memo`, `forwardRef`, class and children-returning overrides pass; extra required prop, narrowed union, fewer props, wrong `ref`, `async`, not-a-component fail `[F1]`/`[F9]`, default export fails `[F5]` | same | — |
| Stale shims (override added, shims not regenerated) | regenerated at build start | regenerated by `check` | **exit 0, SDK default**; a project `tsc -b` fails with TS2578 |

"Fresh clone" note for the bare column: when the SDK itself is broken, `postinstall` refuses to write shims, so
a bare build on a fresh clone fails to resolve `@acme/core-slots/*`. The bold cells describe an existing
checkout that still has shims from before.

### Wiring mistakes

| Mistake | Observed |
|---|---|
| pnpm `"file:./sdk-slots"` (a **copy** in `.pnpm/`) | install OK; build exit 1: `[F6] @acme/core resolves @acme/core-slots to node_modules/.pnpm/@acme+core-slots@file+sdk-slots/… (a copy, or another app's slot package), not sdk-slots/` |
| Bun `"file:./sdk-slots"` | `bun install` exits 1 (`GET …/@acme%2fcore-slots - 404`, Bun looks for the SDK's peer in the registry); the build then fails `[F6] … node_modules/@acme/core-slots (a copy …)` |
| Yarn PnP stub with `peerDependencies` | adapter / chained: exit 1 `[F8] @acme/core-slots is a Yarn PnP __virtual__ instance because sdk-slots/package.json declares peerDependencies: remove them …`; bare: exit 1, Vite cannot resolve `@acme/core-slots/Button` from the virtual SDK |
| npm workspaces, two apps each linking `sdk-slots` | app A fine; app B gated builds exit 1 `[F6] … to ../a/sdk-slots`; **app B bare: exit 0 with app A's overrides** |
| Placeholder installed instead of the link | chained: exit 1 `[F6] … (the registry placeholder: the link is missing or was replaced by an auto-installed peer)`; bare: exit 1 `[UNRESOLVED_IMPORT] Could not resolve './STUNT-DOUBLE-NOT-WIRED -- …'` |

## Known gaps

- **Bare universal builds** are not gated (bold cells). Put `stunt-double check &&` in front of every
  adapter-less build and make `stunt-double check` a required CI step; or use the adapter.
- **npm multi-app workspaces with links** render another app's overrides in bare builds. Use adapter-only
  wiring there (above).
- **Yarn PnP** needs the patched TypeScript 5.9 alias for the type gate; TypeScript 7 is refused.
- **Bun `file:`** and **pnpm `file:`** are always wrong for `sdk-slots`; use the lines in the setup table.
