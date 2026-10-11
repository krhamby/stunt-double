# Making an SDK slot-ready

This page is for the team that publishes the SDK (here `@acme/core`). It covers what to change once so that projects can replace parts of the SDK with stunt-double, and the publish gate that keeps it that way. The full rationale is in [DESIGN.md §3](DESIGN.md#3-sdk-side-what-acmecore-publishes). In this repository, [`examples/acme-core`](../examples/acme-core) is a complete slot-ready SDK, built by [`scripts/build.mjs`](../examples/acme-core/scripts/build.mjs).

Adopting slots adds a required peer, so it is a **major** release. After that, each new slot costs one manifest entry and one contract.

## 1. What to change in the source

1. **Every internal use of an overridable part is a socket import.** Use `import { Button } from '@acme/core-slots/Button'`, never `./original/Button.js`. This includes the barrel: `export { Button } from '@acme/core-slots/Button'`. The SDK never satisfies the socket itself; the project does.
2. **One module per default implementation**, at `src/original/<Slot>.(ts|tsx)` → `dist/original/<Slot>.js`. Nothing in the SDK imports these files. Projects reach them as `@acme/core/original/<Slot>` to wrap them.
3. **Contracts are public API**, in `src/contracts.ts`:

   ```ts
   import type { ButtonProps } from './original/Button.js';   // relative, never through the socket package

   /** Component slots: the props every implementation must accept. */
   export interface SlotProps { Button: ButtonProps; Logo: LogoProps }
   /** Value slots: the whole type of every implementation (services, functions, config). */
   export interface SlotTypes { analytics: Analytics; formatPrice: (amount: number, currency?: string) => string }
   export type SlotName = keyof SlotProps | keyof SlotTypes;
   export type RequiredSlot = 'Logo';
   export type SlotAbi = 'unset';                              // written by sdk-lint --write
   ```

   JSDoc on each entry is what `stunt-double ls` and the IDE show.
4. **Mark client components `"use client"`**: defaults of client slots, and every file that renders a client slot.
5. **Publish ESM** (`"type": "module"`) with an `exports` map, plus `main` and `types`. Use named re-exports only.
6. **Publish one file per module.** `tsc` emit is the simplest correct build. A single-file bundle cannot be injected at module level.

## 2. The manifest, `slot-manifest.json`

```json
{
  "schema": 1,
  "stuntDouble": ">=0.1.0 <1.0.0",
  "sdk": "@acme/core",
  "version": "1.0.0",
  "abi": "acme-core-slots/1.0.0+3f2a9c",
  "slotPackage": "@acme/core-slots",
  "originalSpecifier": "@acme/core/original/",
  "slots": {
    "Button":      { "export": "Button", "kind": "client", "default": "dist/original/Button.js", "consumers": ["Checkout", "ProductCard"] },
    "Logo":        { "export": "Logo", "kind": "client", "required": true, "consumers": ["Checkout"] },
    "formatPrice": { "export": "formatPrice", "kind": "value", "default": "dist/original/formatPrice.js", "consumers": ["Checkout"] }
  },
  "removedSlots": {}
}
```

- **`kind`**: `client`, `shared` or `server` for a component, `value` for anything else. A value slot's contract lives in `SlotTypes`, a component's in `SlotProps`.
- **`required`** (the SDK ships no default) and **`default`** are mutually exclusive.
- **`stuntDouble`** is the range of tool versions that may read the manifest. Raise it when you use a feature a newer stunt-double introduced, e.g. `>=0.2.0` for value slots: an older version then refuses with a `[SETUP]` message, never mis-checks.
- **Renames and removals:** the release that makes them declares `"renamedFrom": ["OldName"]` on the new slot, or `"removedSlots": { "Tooltip": "use the Popover slot" }`. Projects then get an `[F2]` with exact instructions instead of a bare error.
- **`consumers`** and **`abi`** are written by `sdk-lint --write`.

## 3. `package.json`

```json
{
  "exports": {
    ".":                          { "types": "./dist/index.d.ts",      "default": "./dist/index.js" },
    "./original/*":               { "types": "./dist/original/*.d.ts", "default": "./dist/original/*.js" },
    "./contracts":                { "types": "./dist/contracts.d.ts" },
    "./slot-manifest.json":       "./slot-manifest.json",
    "./stunt-double.schema.json": "./stunt-double.schema.json",
    "./package.json":             "./package.json"
  },
  "peerDependencies": { "react": ">=18", "@acme/core-slots": "*" }
}
```

- The socket package is a **required** peer with range `*`. An optional peer becomes a runtime throw in Vite dev, and a range deadlocks upgrades.

## 4. The registry placeholder, `@acme/core-slots`

Publish it once, with a non-prerelease version (`0.0.1`; npm's `*` does not match prereleases). It owns the name, which prevents dependency confusion. Its only content is an import that cannot resolve, so a tool nobody wired fails with instructions instead of rendering defaults. [`examples/acme-core-slots-placeholder`](../examples/acme-core-slots-placeholder) is the complete package.

## 5. Build and publish

```bash
tsc -p tsconfig.build.json          # one file per module; specifiers kept byte-for-byte
npx stunt-double sdk-lint --fix --write
npm publish
```

- **`--fix`** points the published `.d.ts` files at the originals instead of the socket package, so app types need no tsconfig `paths`. A required slot (which has no original) is declared from its contract.
- **`--write`** computes `consumers`, the `abi` pin and `stunt-double.schema.json`.
- The SDK's own type-check sees the sockets through `paths` to a local `dev-slots/` directory of declarations (see the fixture's build script).

## sdk-lint reference

`stunt-double sdk-lint [dir]` exits non-zero on any of these. It uses the same scanner that every project runs on the installed SDK.

| Code | Rule | Fix |
|---|---|---|
| SDK1 | a dist file imports a slot default directly (relative or `original/*`) | import the socket `@acme/core-slots/<Slot>`: otherwise overrides never reach that position |
| SDK2 | a socket in dist is not a manifest slot; a slot has no contract entry; a contract is filed under the wrong interface (`SlotProps` for components, `SlotTypes` for values) | keep the manifest and the contracts in sync |
| SDK3 | `contracts.d.ts` imports from the socket package | import props relatively from the originals: through the socket, a project would compare an override with itself |
| SDK4 | a client default, or a file rendering a client slot, has no `"use client"` | add the directive |
| SDK5 | a slot is required *and* has a default, has neither, or its default file is missing | pick one; build first |
| SDK6 | a published `.d.ts` mentions the socket package | run `sdk-lint --fix` after `tsc` |
| SDK | package shape: `exports` entries, the required unranged peer, manifest `schema` / `sdk` / `version` / `kind`, a stale `abi` | as the message says |

Warnings (non-fatal): no `export type SlotAbi` in the contracts (projects cannot pin the ABI), no entry file found (consumers not computed).
