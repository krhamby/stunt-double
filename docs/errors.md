# stunt-double error reference

Every report starts with `stunt-double: N injection errors (<sdk>@<version>)`. Each line after it starts with a stable code, names the file and the slot, and says what to do. Every report ends with a link to the section of this page for each code it contains.

A build, a test run or `stunt-double check` that prints any of these lines exits non-zero. W7 is the only warning.

| Code | Meaning | Caught by |
|---|---|---|
| [F1](#f1--contract-mismatch) | an override does not fit its contract | type gate |
| [F2](#f2--unknown-slot) | a file in `src/overrides/` is not a slot | static validation |
| [F3](#f3--missing-implementation) | a required slot has no implementation | static validation |
| [F4](#f4--slot-claimed-twice) | two files claim one slot | static validation |
| [F5](#f5--wrong-export) | an override does not export the slot's name | static validation, type gate |
| [F6](#f6--override-not-applied) | something would make an override silently not apply | static validation, config guards, audit |
| [F7](#f7--override-renders-itself) | an override reaches its own slot | static validation |
| [W7](#w7--possible-render-cycle) | an override uses an SDK export that uses its slot | static validation (warning) |
| [F8](#f8--duplicate-react-or-sdk) | two copies of React or the SDK | static validation, audit |
| [F9](#f9--server-and-client-mismatch) | a server-shaped override in a client slot | static validation, type gate |
| [STALE](#stale--generated-files-out-of-date) | generated files are out of date | type gate |
| [TS](#ts--type-error-in-an-override) | a type error inside an override or a file it imports | type gate |
| [CFG](#cfg--invalid-config) | invalid stunt-double configuration or adapter options | config load |
| [SETUP](#setup--sdk-or-typescript-not-found) | the SDK or TypeScript is missing or unusable | config load |
| [TS-PNP](#ts-pnp--typescript-7-under-yarn-pnp) | TypeScript 7 under Yarn Plug'n'Play | type gate |
| [X1](#x1--ignorebuilderrors-in-nextjs), [X2](#x2--check-file-not-in-tsconfig), [X4](#x4--two-typescript-versions-installed) | tool configuration | config load, `doctor` |
| [L1, L2](#l1-and-l2--brand-layer-mismatch) | a brand layer does not match the SDK | static validation |
| [STUNT-DOUBLE-NOT-WIRED](#stunt-double-not-wired--resolve-error) | a tool resolved the registry placeholder | the tool's own resolver |
| [STUNT-DOUBLE-ERROR](#stunt-double-error--poisoned-shim-in-dev) | a dev server loaded a poisoned shim | the tool's own resolver |
| [DOCTOR](#doctor--setup-check) | `stunt-double doctor` findings | `doctor` |
| SDK1–SDK6 | the SDK's publish gate | [sdk-lint](sdk-authors.md#sdk-lint-reference) |

---

## F1 — contract mismatch

The override does not fit the contract the SDK publishes: `SlotProps['X']` for a component slot, `SlotTypes['X']` for a value slot.

```
[F1] Button (src/overrides/Button.tsx): TS2322 Type 'ButtonProps' is not assignable to type 'ButtonProps & { tone: "loud"; }'. Property 'tone' is missing ... (tsc 7.0.2, 162 ms)
[F1] Button (src/overrides/Button.tsx): override ignores these SDK props: "onClick" | "variant" (declare them, or list them in stunt-double.config.json map.Button.ignoresProps)
[F1] Card (src/overrides/Card.tsx): is not a React component (function, memo, forwardRef or class): TS2322 ...
[F1] analytics (src/overrides/analytics.ts): does not fit the contract @acme/core SlotTypes['analytics']: TS2741 Property 'id' is missing ...
[F1] analytics (src/overrides/analytics.ts): narrows the parameters of these members: "track" (the SDK may pass any value its contract allows: accept the contract's parameter types)
```

**Component slots.** The override must accept *every* props object the SDK may pass. Typical causes:

- a prop the SDK never passes is required (`tone`);
- a union is narrowed (`variant: 'primary'`);
- the `ref` element type is wrong;
- props are dropped. A props type that leaves out SDK props silently ignores them; declare them, or opt out explicitly with `map.<Slot>.ignoresProps`.

Typing the override as `SlotProps['X']` avoids all of these and keeps up with SDK upgrades.

**Value slots.** The value must be assignable to `SlotTypes['X']`, and it must accept every argument the contract allows. TypeScript lets a function narrow its parameters when `strict` is off, and lets a *method* narrow its parameters even when `strict` is on. stunt-double compares argument lists itself, so `track(event: 'page_view')` fails where `track(event: string)` is the contract. Fewer parameters, optional extras, rest parameters and generics are fine. See [DESIGN §6.6](DESIGN.md#66-value-slots).

**Not errors:** `React.FC<P>`, `memo()`, `forwardRef()`, class components and overrides that return `children` all pass.

## F2 — unknown slot

Every top-level file in `src/overrides/` must be a slot: `<Slot>.tsx` or `<Slot>/index.tsx`. Anything else is a typo or a stray file that would otherwise be silently unused.

```
[F2] src/overrides/Buton.tsx overrides unknown slot "Buton" (did you mean "Button"?). @acme/core@1.0.0 slots: Button, Card, Logo. Helpers belong in _-prefixed files or inside src/overrides/<Slot>/.
[F2] src/overrides/PriceTag.tsx: slot "PriceTag" was RENAMED to "Price" in @acme/core@2.0.0: rename the file to Price.tsx and export `Price`.
[F2] src/overrides/Tooltip.tsx: slot "Tooltip" was REMOVED in @acme/core@2.0.0: use the Popover slot.
```

**Fix:** rename the file, or move a helper to a `_`-prefixed file (`_tokens.ts`) or inside the slot's own folder (`src/overrides/Button/helpers.ts`). Tests, stories and `.d.ts` files are ignored. After an SDK upgrade, the message names the new slot or says what replaced it.

## F3 — missing implementation

A slot the SDK marks `required` (it ships no default) has no implementation. An SDK upgrade can add one.

```
[F3] required slot "Logo" has no implementation: create src/overrides/Logo.tsx exporting `Logo` (scaffold: npx stunt-double eject Logo).
```

**Fix:** create the file, or let `npx stunt-double eject Logo` write a typed starter. The starter fails the build until you implement it.

## F4 — slot claimed twice

```
[F4] slot "Button" is claimed by 2 files: src/overrides/Button.tsx and src/overrides/Button/index.tsx. Keep exactly one.
```

**Fix:** keep one of them. A `map` entry in `stunt-double.config.json` also claims its slot.

## F5 — wrong export

The override must export the slot's name as a named export (functions, constants and classes all count).

```
[F5] src/overrides/Logo.tsx must export a named `Logo` (it exports: default). Write `export function Logo(...)`, or set "map": {"Logo": {"export": "default"}}.
```

**Fix:** export the name, or tell stunt-double which export to use with `map.<Slot>.export`.

## F6 — override not applied

The most dangerous kind of mistake for runtime DI: nothing crashes, and the SDK default just quietly renders. stunt-double turns each case into a build error.

| Message | Cause | Fix |
|---|---|---|
| `node_modules/@acme/core/dist/Toolbar.js imports the default of slot "Button" directly` | the installed SDK bypasses its own socket | an SDK bug: ask for a fixed release (its `sdk-lint` rejects this) |
| `src/pages/Legacy.tsx imports "@acme/core/original/Button" outside src/overrides` | app code imports a default directly | import from `@acme/core`; or allow it with `allowOriginalImports` |
| `Vite environment "ssr" externalizes @acme/core` | SSR would load the SDK natively | keep the adapter's `ssr.noExternal` |
| `Vitest deps.optimizer.ssr pre-bundles @acme/core` | Vitest would bundle it outside the plugin | remove it from `include` |
| `the dependency optimizer tried to pre-bundle ...` | a custom `optimizeDeps` pulls in the slot package | remove that setting |
| `@acme/core is an external module in this build` | webpack / Rspack `externals` (e.g. webpack-node-externals) | bundle it: `allowlist: [/^@acme\/core/]` |
| `esbuild option packages: "external"` / `external: "@acme/core"` | esbuild leaves the SDK to the runtime | bundle it |
| `serverExternalPackages lists @acme/core` | Next.js would load it natively on the server | remove it |
| `@acme/core imports @acme/core-slots/Button but .stunt-double/gen/Button.jsx is not in the bundle` | an alias or plugin resolved the socket elsewhere | remove that alias |
| `@acme/core resolves @acme/core-slots to ... (a copy, ...)` | universal tier: the link is a copy or another app's | use npm `file:`, pnpm `link:`, Yarn `portal:`, Bun `workspace:*` |

## F7 — override renders itself

An override (or a file it imports) reaches its own slot: through `@acme/core-slots/X`, through `@acme/core`'s barrel, or as a namespace member (`<Acme.Button>`). For a component slot, that is an infinite render. For a value slot, it is a circular import that reads itself before it is initialized.

```
[F7] src/overrides/Button.tsx -> src/components/Fancy.tsx uses <ns>.Button from "@acme/core": that is slot "Button" itself (infinite render). Wrap the default via '@acme/core/original/Button'.
[F7] src/overrides/formatPrice.ts imports { formatPrice } from "@acme/core": that is slot "formatPrice" itself (a circular import: ...). Use the default via '@acme/core/original/formatPrice'.
```

**Fix:** to wrap or decorate the SDK default, import it from `@acme/core/original/<Slot>`, which is never redirected.

## W7 — possible render cycle

A warning: the override uses an SDK export that itself uses the slot, e.g. the Button override renders the SDK's `Dialog`, which renders a Button. That is fine unless it recurses. For a value slot, do not use that export while modules initialize (in top-level code), only inside functions.

## F8 — duplicate React or SDK

```
[F8] "react" resolves to 2 copies: app -> node_modules/react, @acme/core -> node_modules/@acme/core/node_modules/react. Contexts/hooks break at runtime. Dedupe the install.
[F8] "react" is bundled from 2 locations (...): dedupe it (resolve.dedupe / alias / single install).
```

Two copies of React (or of the SDK) mean hooks and contexts break at runtime ("must be used within a Provider"). **Fix:** dedupe the install (`npm dedupe`, matching versions, `resolve.dedupe`). Under Yarn PnP, the universal tier's `sdk-slots/package.json` must not declare peers.

## F9 — server and client mismatch

```
[F9] src/overrides/Button.tsx imports "server-only" but "Button" is a client slot (rendered inside "use client" SDK components).
[F9] Logo (src/overrides/Logo.tsx): client slot override must not be an async component (TS2322). Async components can only render in server slots.
```

**Fix:** keep server-only code out of client slots. Value slots have no client/server kind of their own.

## STALE — generated files out of date

Only seen when something bypasses the adapter, e.g. a plain `tsc` after adding an override without regenerating.

```
[STALE] .stunt-double/check.ts(31,1): error TS2578: Unused '@ts-expect-error' directive.   <- src/overrides/Logo.* now exists; run `npx stunt-double gen`
```

**Fix:** `npx stunt-double gen`. Adapters regenerate at every start, so builds never see this.

## TS — type error in an override

A TypeScript error inside an override or a file it imports. The gate compiles exactly the overrides and what they import, with the app's own tsconfig, and any error fails it.

## CFG — invalid config

A problem in `stunt-double.config.json` (or the `"stuntDouble"` key in `package.json`) or in the options of an adapter function: an unknown key, a wrong type, an `outDir` that is not a directory of its own, `ignoresProps` on a value slot. Nothing is ever silently ignored.

## SETUP — SDK or TypeScript not found

stunt-double cannot read the SDK's `slot-manifest.json`, the manifest needs a newer stunt-double (`stuntDouble` range, or a slot `kind` this version does not know), or the type gate's TypeScript is missing. The message names the package and the install command.

## TS-PNP — TypeScript 7 under Yarn PnP

TypeScript 7.0 cannot resolve modules under Yarn Plug'n'Play. Make `typescript@5.9` the project's own `typescript` dev dependency: Yarn patches that package for PnP. An npm alias such as `typescript5@npm:typescript@5.9` is not patched, so it cannot resolve modules under PnP either.

## X1 — ignoreBuildErrors in Next.js

`typescript.ignoreBuildErrors` skips Next's own type check. It does **not** skip stunt-double's: the Next adapter runs the contract gate itself when `next build` loads the config.

## X2 — check file not in tsconfig

Only with the opt-in `stunt-double init --editor`, which adds `.stunt-double/check.ts` to the app tsconfig for IDE squiggles. `doctor` reports a listed check file that does not exist or moved. **Fix:** `npx stunt-double init --editor`.

## X4 — two TypeScript versions installed

The gate resolves TypeScript by package name (config `typescript`, default `"typescript"`), never through `node_modules/.bin/tsc`, so a second TypeScript cannot be picked by accident.

## L1 and L2 — brand layer mismatch

A package in `layers` is not a stunt-double layer, is built for another SDK (L1), or supports another SDK version range (L2). **Fix:** upgrade the layer, or pin the SDK.

## STUNT-DOUBLE-NOT-WIRED — resolve error

```
[UNRESOLVED_IMPORT] Could not resolve './STUNT-DOUBLE-NOT-WIRED -- @acme core-slots is not provided by this project, ...' in node_modules/@acme/core-slots/not-wired.js
```

A tool, config or process with no stunt-double adapter resolved the SDK's socket package to the registry placeholder, whose only content is an import that cannot resolve. That is on purpose: without this, the tool would quietly render the SDK defaults. **Fix:** add the adapter to that tool's config; for a tool without one, use the universal tier (`npx stunt-double init --universal`) and run `stunt-double check &&` before it. `npx stunt-double doctor` lists unwired configs.

## STUNT-DOUBLE-ERROR — poisoned shim in dev

In a dev server, an injection mistake replaces every shim with an import whose name is the report, so the dev server's own overlay or HTTP 500 page shows it. It clears when the mistake is fixed.

## DOCTOR — setup check

Findings of `npx stunt-double doctor`: a tool config without its adapter, a script running a tool with no adapter and no `stunt-double check &&`, a wrong universal-tier link form, `preserveSymlinks`, and so on. Each names the fix.
