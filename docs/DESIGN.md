# stunt-double: design

*Fail-closed, build-time component injection for React + TypeScript.*

| | |
|---|---|
| Package | `stunt-double` v0.1.0 (MIT). One npm package: the CLI plus subpath exports `stunt-double/core`, `/vite`, `/esbuild`, `/webpack`, `/next`, `/jest`, `/metro`, `/parcel`, `/bun` |
| Example SDK | `@acme/core`, the company's product SDK. Its socket package is `@acme/core-slots` |
| Companion docs | [DECISIONS.md](DECISIONS.md): why this design and not the others, and the open questions. [README](../README.md): quickstart |
| Audience | React + TypeScript engineers who know runtime DI (Swinject, a React context registry) and want the same flexibility with build-time failures |

## Contents

1. [The problem and the idea](#1-the-problem-and-the-idea)
2. [Failure catalogue: the north star](#2-failure-catalogue-the-north-star)
3. [SDK side: what `@acme/core` publishes](#3-sdk-side-what-acmecore-publishes)
4. [Project side: what a customer app writes](#4-project-side-what-a-customer-app-writes)
5. [Resolution and generation](#5-resolution-and-generation)
6. [Type safety](#6-type-safety)
7. [Per-tool integration](#7-per-tool-integration)
8. [Developer experience](#8-developer-experience)
9. [SSR, React Server Components, duplicate instances](#9-ssr-react-server-components-duplicate-instances)
10. [Defence in depth](#10-defence-in-depth)
11. [Degraded path: the SDK cannot be changed](#11-degraded-path-the-sdk-cannot-be-changed)
12. [Rollout and migration](#12-rollout-and-migration)
13. [Alternatives considered](#13-alternatives-considered)
14. [Known limitations](#14-known-limitations)

---

## 1. The problem and the idea

### 1.1 What we want

`@acme/core` ships UI components: `Button`, `Logo`, `Card`, `Dialog` and so on. Apps use them directly, and the SDK uses them too. For example, the SDK's own `Dialog` renders a `Button` for its OK action. A customer project wants to replace some of these components with its own, and the replacement has to:

- **apply everywhere**: in the app's own `<Button>` *and* inside every SDK component that renders a `Button`;
- **eliminate the default**: if the project replaces `Button` outright, the SDK's default `Button` should not be in the bundle at all;
- **allow wrapping**: an override can wrap the SDK default (add a class, read the app theme) without creating an import cycle.

At work you would do this with Swinject: register an implementation in a container, then resolve it where it is needed. The weakness of runtime DI is *when* it reports mistakes. A missing registration, a typo'd key, or an implementation of the wrong type shows up only when `resolve()` runs, which means in a running app, usually as a crash.

**The north star is "build failures rather than runtime failures".** Every injection mistake must either:

- make the production build command or CI exit non-zero, or
- show up in the dev server's error overlay.

It must never crash at runtime, and it must never silently render the SDK default where the project provided an override. That has to hold for any React + TypeScript combination: Vite, webpack, Rspack, Next.js (Turbopack and webpack), esbuild, Rollup and Rolldown, Parcel, Bun and Metro as bundlers; Vitest and Jest as test runners; npm, pnpm, Yarn PnP and Bun as package managers; TypeScript 5.9 and 7.

### 1.2 The metaphor (docs only)

The SDK component is the **lead actor**. The project's override is its **stunt double**. The double has to fit the **costume**, which is the props contract `@acme/core` publishes, or it doesn't get on set: the build fails. If no double was cast, the lead plays the part, and the SDK default renders by design. What can never happen is a double who was cast and quietly doesn't show up.

The code uses plain names throughout:

| Term | Meaning |
|---|---|
| **slot** | an overridable SDK component, such as `Button` |
| **override** | the project's implementation of a slot, such as `src/overrides/Button.tsx` |
| **socket** | the bare import specifier the SDK renders a slot through: `@acme/core-slots/Button` |
| **shim** | the generated one-line file that answers a socket: `sdk-slots/gen/Button.jsx` |
| **original** | the SDK default implementation of a slot: `@acme/core/original/Button` |
| **contract** | the props type every implementation of a slot must accept: `SlotProps['Button']` |

### 1.3 Swinject mapped to stunt-double

| Swinject (runtime) | stunt-double (build time) |
|---|---|
| `container.register(Button.self) {…}` | the file `src/overrides/Button.tsx` |
| the protocol a registration must conform to | the contract `SlotProps['Button']` from `@acme/core/contracts` |
| `resolve()` | a static `import`: the SDK imports `@acme/core-slots/Button` |
| the container's registration table | one generated shim per slot in `sdk-slots/gen/`, reached through one static alias or a package link |
| parent-container fallback | the effective order: app override, then optional brand layers, then the SDK default (§5.5) |
| a wrong registration, a missing registration, or a type mismatch crashes at runtime | a non-zero exit from `vite build` / `next build` / `webpack` / `tsc`, or an overlay in the dev server, with an `[Fx]` message that names the file and the fix |

### 1.4 How it works, in 30 seconds

```
 app code:     import { Button, Dialog } from '@acme/core'
                                  |
 @acme/core    index.js   export { Button } from '@acme/core-slots/Button'    <- socket
 (the SDK)     Dialog.js  import { Button } from '@acme/core-slots/Button'    <- socket
                          (the SDK NEVER imports its own default)
                                  |
               who answers '@acme/core-slots/Button'?
   +-----------------------------+-------------------------------+--------------------------------+
   | adapter tier (T1)           | universal tier (T0)           | nobody wired this tool         |
   | one static alias in the     | package link:                 | the registry placeholder       |
   | tool's own config:          | node_modules/@acme/core-slots | @acme/core-slots@0.0.1:        |
   | '@acme/core-slots/*' ->     |   -> ./sdk-slots              |   import './STUNT-DOUBLE-NOT-  |
   | <root>/sdk-slots/gen/*.jsx  |   exports "./*" -> gen/*.jsx  |   WIRED -- ... run npx         |
   | + validation + type gate    |                               |   stunt-double doctor'         |
   +--------------+--------------+---------------+---------------+----------------+---------------+
                  +--------------+---------------+                                v
                                 v                                 RESOLVE ERROR: the build fails
 sdk-slots/gen/Button.jsx   (generated, gitignored, plain ESM in a .jsx file)
     "use client";  export { Button } from '../../src/overrides/Button.tsx';   <- a double was cast
     "use client";  export { Button } from '@acme/core/original/Button';       <- no override: the lead plays it
 src/stunt-double.check.ts  (generated) proves every override fits its contract; the adapter runs it in the build
```

In five points:

1. The SDK never imports its own overridable components. Every internal use, including the SDK's barrel, goes through a bare **socket** import such as `@acme/core-slots/Button`, and the SDK never satisfies that import itself.
2. The project answers each socket with a generated one-line **shim**. The shim re-exports either the project's override (`src/overrides/Button.tsx`) or the SDK default (`@acme/core/original/Button`).
3. Tools reach the shims in one of two ways. In the **adapter tier (T1)**, one static alias is added by a thin adapter that also runs validation and the contract type check inside the tool's own config. In the **universal tier (T0)**, standard package resolution follows a linked package.
4. A tool or module graph that nobody wired resolves the socket to a **registry placeholder** whose only content is an import that cannot resolve. It fails with a message that says how to fix it, and never quietly falls back to the SDK default. This is what "fail-closed" means here.
5. A generated **check file**, `src/stunt-double.check.ts`, proves that each override accepts every props object the SDK may pass. The adapter runs it inside `vite build` / `webpack` / esbuild, and `next build`, CRA, `tsc` and the IDE see it natively.

**The public specifiers.**

| Specifier | Meaning | Redirected? |
|---|---|---|
| `@acme/core` | the SDK barrel. Slot re-exports are the **effective** components | no (the barrel's socket imports are) |
| `@acme/core-slots/X` | the socket: the effective X | always (alias, link, or placeholder error) |
| `@acme/core/original/X` | the SDK default of X (the wrapping escape hatch) | **never** |
| `@acme/core/contracts` | types: `SlotProps`, `SlotName`, `RequiredSlot`, `SlotAbi` | never; type-only |
| `<layer>/layer/X` | a brand layer's implementation of X (optional, §5.5) | never |

**Why fail-closed.** A substitution system in which the SDK default is the natural resolution is fail-open. Every tool and graph that does not run the interceptor silently renders the default. Examples observed in the labs: the Vite dev pre-bundler, SSR externals, Vitest, Jest without a mapper, Turbopack's silent alias fallback for missing or absolute targets, Rspack ignoring `resolve.plugins`, tsconfig `paths` that bundlers do not apply inside `node_modules`, and Bun runtime plugins that never see bare specifiers [V]. In stunt-double the SDK has *no* module path to its defaults. The only importer of `original/*` is a project shim or override, so forgetting the wiring is a resolution error [V][S].

**Why generated shims rather than committed files.** The decision lives in the *content* of one small file per slot, behind a path that never changes. As a result:

- persistent caches cannot go stale [V];
- HMR is an ordinary file edit [V];
- adding or removing an override needs no alias changes.

The overrides directory contains only real customizations. Adapters regenerate the shims at every tool start, so they cannot be stale in configured tools.

**Why `.jsx`.** Vite 8's dependency optimizer externalizes bare imports that resolve to `.jsx` / `.tsx` (its `externalTypes`; `rolldownDepPlugin`). A `.jsx` shim therefore stays a live source module and is never frozen into `.vite/deps` [V]. The content is plain ESM, so tools without a JSX transform for that path still parse it [V webpack, CRA]. Node refuses `.jsx`, so a graph that wrongly externalizes the SDK fails loudly [V].

### 1.5 Recommended setup for a standard app (npm + Vite + Vitest)

1. Run `npm i -D stunt-double`.
2. Run `npx stunt-double init`.
3. Add `plugins: [react(), stuntDouble()]` to `vite.config.ts` (`import { stuntDouble } from 'stunt-double/vite'`).
4. Put overrides in `src/overrides/`.
5. CI runs `npm ci && npx stunt-double check && npm run build && npm test`.

Next.js, webpack and Jest use the same steps with their one-line wrapper (§7).

### 1.6 Evidence tags used throughout

Every behavioural claim carries a tag:

- **[V]**: observed in earlier prototype or lab runs. Versions: node 22.22.0, npm 10.9.4, vite 8.3.4 / rolldown 1.2.13, rollup 4.64.5, webpack 5.111.1, @rspack/core 2.2.8, @rsbuild/core 2.2.12, esbuild 0.28.2, next 16.4.0 (Turbopack and `--webpack`), jest 30.5.2, vitest 5.0.3, typescript 7.0.2 and 5.9.3, react / react-dom / @types/react 19.3.0, pnpm 12.11.2, yarn 4.18.1 (PnP), bun 1.4.3 / 1.4.2, parcel 2.16.4, metro 0.87.1, react-scripts 5.0.1.
- **[S]**: verified while writing the specification, using vite 8.3.4, webpack 5.111.1, esbuild 0.28.2, node 22.22.0, oxc-parser 0.153.0, oxc-resolver 11.24.2 and semver.
- **[U]**: unverified. Each [U] is an explicit acceptance test for the reference implementation.

The labs and prototypes ran under an earlier working name, against an SDK fixture with a different package name. The mechanisms are identical; only the names differ.

---

## 2. Failure catalogue: the north star

This is the contract stunt-double makes with you: for each injection mistake, which stage catches it, and what each tool does.

### 2.1 Stages

| Code | Stage | Where it runs | Cost on the fixtures |
|---|---|---|---|
| **CFG** | Config-time guard | Adapter config hooks: Vite `configResolved`, `withStuntDouble()` for Next / Jest / webpack / Metro at config load | ~0 |
| **STA** | Static validation (the generator) | Every adapter start (config load, `buildStart`, esbuild `onStart`, webpack `watchRun`), `stunt-double gen` / `stunt-double check`, root `postinstall` | ~50 ms cold, 2–3 ms warm [V]; transitive F7 walk 2–3 ms [S] |
| **RES** | Native resolution or linking | Every tool and every graph, with no stunt-double code | 0 |
| **TYP** | Contract type check of the generated `src/stunt-double.check.ts` | Adapter build start (Vite, Rollup, Rolldown, esbuild, webpack, Rspack); natively in `next build` and CRA; `stunt-double check`; `tsc --noEmit`; the IDE | TS 7: 150–200 ms; TS 5.9: 0.8–1.0 s [V] |
| **AUD** | Post-bundle module-graph audit | Adapters in build mode (`buildEnd`, `finishModules`, esbuild `onEnd` metafile) | ~ms |
| **DEV** | Dev error channel | (a) Poisoned shims: every dev server shows its own unresolved-import overlay or HTTP 500 [V Vite, Next Turbopack, Next webpack]. (b) The Vite adapter also pushes `{type:'error'}` over HMR [V] | 0 |

"Fails" means the command exits non-zero. Exit codes are never matched exactly: TypeScript 7 exits 1, TypeScript 5.9 exits 2, and bundlers exit 1.

### 2.2 The two tiers

- **T1, adapter tier:** the tool's config uses the stunt-double adapter (`stuntDouble()`, `withStuntDouble()`, …).
- **T0, universal tier:** the shim directory is linked as a package and the tool has no adapter.
- **"T0 bare":** T0 run *without* the mandatory `stunt-double check &&` prefix in the script.

Every T1 cell below also holds under T0 *with* the chain, because the chain runs the same STA and TYP code.

### 2.3 The catalogue

In the **Production builds** column, "esbuild+" means esbuild, Rolldown and Rollup. A cell without a tag follows from the same mechanism as its tagged neighbours but was not run separately.

**Contract mistakes (F1)**

| # | Mistake | Caught by | Production builds | Dev servers | Vitest 5 / Jest 30 | tsc / IDE (5.9 and 7) | T0 bare |
|---|---|---|---|---|---|---|---|
| F1a | Props incompatible: extra required prop, narrowed union, wrong `ref` element, or not a component | TYP | Vite 8: exit 1 at `buildStart` [V]. webpack 5 / Rspack 2: exit 1 via `compilation.errors` [U]; never fork-ts-checker with TS 7, it fails *open* [V]. Next 16: `next build` exit 1 "Failed to type check" [V]. esbuild+: exit 1 (`onStart` / `buildStart`) [U] | Vite: overlay about 150 ms after save (TS 7), non-blocking [V]. `next dev`: IDE only | Not a gate (babel/swc do not type-check); CI `tsc` fails | TS2322 [V] | Silent unless `tsc` / `stunt-double check` is in the chain |
| F1b | Override ignores contract props, or an SDK upgrade widens or extends the contract | TYP (`declaresAll` + ABI pin) | Vite exit 1 [V]; webpack / Rspack exit 1 [U]; Next exit 1 [V]; esbuild+ exit 1 | Vite overlay | CI `tsc` | `TS2322 '[F1] override ignores these SDK props'` / ABI TS2322 [V] | same as F1a |
| F1c | *Must not fail:* override written as `React.FC<P>`, `memo()`, `forwardRef()`, a class, or returning `children` | TYP shape `JSXElementConstructor` | passes [V both TS versions, strict on and off] | | | | |

**Naming and presence mistakes (F2–F5)**

| # | Mistake | Caught by | Production builds | Dev servers | Vitest 5 / Jest 30 | tsc / IDE | T0 bare |
|---|---|---|---|---|---|---|---|
| F2a | Typo or stray file (`Buton.tsx`, `Button.override.tsx`) | STA | exit 1 in Vite, webpack / Rspack and esbuild+ [V]. Next: config load exits 1 for build and dev start [V] | Vite: overlay plus poison; clears on fix [V]. Next: live via `stunt-double watch` poison, HTTP 500 [V] | Vitest exit 1; Jest exits 1 at config load [V] | — | Silent: the file is unused (R1) |
| F2b | Slot renamed or removed in an SDK upgrade | STA (`renamedFrom` / `removedSlots`) + RES (the old shim no longer exists) + TYP (`__slotSet`) | Vite exit 1 with a "RENAMED to ActionButton" hint [V]; webpack / Rspack, Next, esbuild+ exit 1 | overlay | exit 1 | TS1360/TS2741 + TS2307 [V] | RES or TYP, loud |
| F3 | Required slot not provided (also: a new required slot after an upgrade) | STA; RES backstop (the generator never emits that shim) | exit 1 in Vite, webpack / Rspack, Next and esbuild+ [V] | Vite overlay; RES gives HTTP 500 + overlay [V] | exit 1 [V] | TS2305/TS2741 [V] | RES, loud [V] |
| F4 | Two claims: `Button.tsx` + `Button/index.tsx`, or a `map` entry + a convention file | STA | Vite exit 1 [V]; webpack / Rspack exit 1 [V]; Next, esbuild+ exit 1 | overlay | exit 1 | TS1117 (map duplicates) | Uses the previous shim (R1) |
| F5 | Wrong export: default vs named, or wrong name | STA (oxc) + TYP (TS2305/TS2614) + RES (native MISSING_EXPORT) | Vite exit 1 [V]. webpack / Rspack exit 1: the adapter sets `exportsPresence:'error'`, because webpack `javascript/auto` only warns [V]. Next exit 1 [V]. esbuild+ exit 1 [V] | overlay [V] | exit 1 | TS2614 [V] | Native in Vite, Rolldown, esbuild, Rspack, Turbopack and Parcel. **Runtime only** in the Bun bundler and Metro [V] (R1) |

**"Override not applied" mistakes (F6)**

| # | Mistake | Caught by | Production builds | Dev servers | Vitest 5 / Jest 30 | tsc / IDE | T0 bare |
|---|---|---|---|---|---|---|---|
| F6a | An SDK file imports a slot default directly (relative path or `original/*`) | STA: dist scan of the *installed* SDK, always run + AUD | Vite exit 1 [V]; webpack / Rspack exit 1 [V]; Next exit 1 at config load [V]; esbuild+ exit 1 [V] | overlay [U] | exit 1 | — | **Silent default inside that SDK component** (R2) |
| F6b | A tool, config or graph that was never wired: a second Vite config, Storybook, a script, an IDE test runner | RES: registry placeholder with a poisoned import | Vite: `[UNRESOLVED_IMPORT] Could not resolve './STUNT-DOUBLE-NOT-WIRED -- …'`, exit 1 [S]. webpack: `Module not found: … './STUNT-DOUBLE-NOT-WIRED -- …'` [S] (Rspack [U]). Next: `Module not found` [U]. esbuild: `Could not resolve "./STUNT-DOUBLE-NOT-WIRED …"` [S] | Vite: optimizer error, process exits [S] | Jest `Cannot find module` [U] | TS2305 in the check file | Node: `ERR_MODULE_NOT_FOUND …STUNT-DOUBLE-NOT-WIRED…` [S] |
| F6c | A server or test graph externalizes the SDK: SSR without `noExternal`, Vitest without inline, Vitest `deps.optimizer`, Next Pages Router | CFG (T1); RES (T0) | Vite: `[F6] Vite environment "ssr" externalizes @acme/core` at config [V guard pattern]. webpack: n/a. Next: the adapter adds `transpilePackages`. esbuild+: n/a | Vite: same [V] | Vitest config error [V] | — | Loud at server boot or test start: `.jsx` cannot load in Node [V], or the poison message [S] |
| F6d | The Vite dependency pre-bundler freezes the decision into `.vite/deps` | Prevented by construction: `.jsx` shims + alias + `optimizeDeps.exclude` + `rolldownOptions.external` + an optimizer tripwire | n/a | Vite: 0 project modules in `.vite/deps` [V][S]; the tripwire exits the dev server [V pattern] | n/a | — | `.jsx` alone keeps it out [V] |
| F6e | A persistent cache serves an old override (webpack / Rspack / Next `.next/cache`) | Prevented: the decision lives in shim *content*; the fingerprint is folded into `cache.version` | webpack / Rspack: correct [V]. Next: correct [V] | n/a | n/a | — | correct [V] |
| F6f | Link wired wrong: pnpm / Bun `file:` copy, npm-hoisted cross-app slot package, Yarn PnP `__virtual__` copy, placeholder instead of link | STA wiring self-test | Vite exit 1 [V]; webpack / Rspack, Next, esbuild+ exit 1 | overlay | exit 1 | — | Hoisted cross-app case: renders another app's overrides [V] (R1) |
| F6g | Bypass: app code imports `@acme/core/original/X` outside overrides, or a user alias points a socket elsewhere | STA (import scan) + AUD | Vite exit 1 [V static][U audit]; webpack / Rspack, Next, esbuild+ exit 1 | overlay | exit 1 | — | Silent at that call site (R1) |
| F6h | Stale shims: override added or removed, or SDK upgraded, without regenerating | T1 regenerates at every start; TYP staleness probe (TS2578) + ABI pin (TS2322) + `__slotSet` | Vite: regenerated [V]. webpack / Rspack: regenerated (`watchRun`). Next: regenerated at config load [V]. esbuild+: regenerated | Vite: regenerated live [V] | regenerated | TS2578 / TS2322 [V] | Previous decision (R1); `tsc` catches it |

**Cycles, duplicates and React Server Components (F7–F9)**

| # | Mistake | Caught by | Production builds | Dev servers | Vitest 5 / Jest 30 | tsc / IDE | T0 bare |
|---|---|---|---|---|---|---|---|
| F7 | Override imports its own slot: directly, through the barrel, via a namespace member, through `@acme/core-slots/X`, or transitively through project files including tsconfig `paths` aliases | STA (oxc-parser + oxc-resolver walk) | Vite exit 1 [V][S]; webpack / Rspack, Next, esbuild+ exit 1 | overlay | exit 1 | — | **Runtime infinite render / OOM** [V] (R1) |
| W7 | Consumer cycle: the Button override renders the SDK `Dialog`, which renders the Button slot | STA **warning** (manifest `consumers`) | warn [U] | | | | |
| F8 | Duplicate React, react-dom or SDK instance ("must be used within &lt;Provider&gt;") | STA multi-vantage realpath preflight + AUD bundled-root audit + Vite `resolve.dedupe` | Vite exit 1 [V]; webpack / Rspack exit 1 [V]; Next exit 1 (Next vendors React but not the SDK); esbuild+ exit 1 [V] | overlay | exit 1 | — | **Runtime `useContext` of null** [V] (R1) |
| F8b | Yarn PnP turns the slot package into a `__virtual__` copy because its `package.json` declares peers | STA | Vite exit 1 [V] | | | | silent NO_PROVIDER [V] (R1) |
| F9a | A client-slot override uses hooks without `"use client"` | Prevented: the generated shim carries `"use client"` (`rsc` auto/on) | Next: renders through the shim [V]; Next errors natively if the shim directive is removed [V] | n/a | n/a | | |
| F9b | A client-slot override (or a file it imports) imports `server-only` | STA + Next native | Vite, webpack / Rspack, esbuild+ exit 1; Next exit 1 [V native] | overlay | exit 1 | | |
| F9c | An async (server-shaped) override in a client slot | TYP `notAsync` | Vite exit 1 [V]; webpack / Rspack exit 1; Next exit 1 [V]; esbuild+ exit 1 | overlay | CI `tsc` | `TS2322 '[F9] client slot override must not be an async component'` [V] | |

**Configuration mistakes (X) and brand layers (L)**

| # | Mistake | How it is handled |
|---|---|---|
| X1 | `typescript.ignoreBuildErrors` in Next | CFG: the adapter refuses; `next build` exits 1 [V] |
| X2 | Check file not part of the tsconfig program | It is listed in tsconfig `files`, so a missing file gives TS6053 [V]; the generator warns if it is not covered [U] |
| X3 | TypeScript 7 under Yarn PnP (TS 7.0.2 cannot resolve modules under PnP) | CFG `[TS-PNP]` with instructions [U]; otherwise it fails closed with TS2307 everywhere [V] |
| X4 | Two TypeScript versions installed (`.bin/tsc` collision) | The gate resolves `typescript` by package name [V] |
| L1/L2 | Brand layer built for another SDK or SDK range | STA: exit 1 [V in a resolver prototype; U here] |

### 2.4 What can still reach runtime

Seven residual cells remain. They are listed plainly in §14 (R1–R7). Two things are **never** possible in any tier: every override disappearing at once, and an unwired tool silently rendering defaults. Both are RES failures [S].

### 2.5 Exact message formats

Every line starts with a stable code, names the file and slot, and says what to do. The header names the installed SDK. The block below is a catalogue of every line format; in a real run you see only the lines that apply.

```
stunt-double: 2 injection errors (@acme/core@1.0.0)
  [F1] Button (src/overrides/Button.tsx): TS2322 Type 'ButtonProps' is not assignable to type 'ButtonProps & { tone: "loud"; }'. Property 'tone' is missing ... (tsc 7.0.2, 162 ms)
  [F1] Button (src/overrides/Button.tsx): override ignores these SDK props: "onClick" | "variant" (declare them, or list them in stunt-double.config.json map.Button.ignoresProps)
  [F2] src/overrides/Buton.tsx overrides unknown slot "Buton" (did you mean "Button"?). @acme/core@1.0.0 slots: Button, Card, Logo. Helpers belong in _-prefixed files or inside src/overrides/<Slot>/.
  [F2] src/overrides/Button.tsx: slot "Button" was RENAMED to "ActionButton" in @acme/core@2.0.0: rename the file to ActionButton.tsx and export `ActionButton`.
  [F2] src/overrides/Tooltip.tsx: slot "Tooltip" was REMOVED in @acme/core@2.0.0: use the Popover slot.
  [F3] required slot "Logo" has no implementation: create src/overrides/Logo.tsx exporting `Logo` (scaffold: npx stunt-double eject Logo).
  [F4] slot "Button" is claimed by 2 files: src/overrides/Button.tsx and src/overrides/Button/index.tsx. Keep exactly one.
  [F5] src/overrides/Button.tsx must export a named `Button` (it exports: default). Write `export function Button(...)`, or set "map": {"Button": {"export": "default"}}.
  [F6] node_modules/@acme/core/dist/Toolbar.js imports the default of slot "Button" directly ("./original/Button.js"): overrides are NOT applied inside Toolbar. SDK bug: it must import "@acme/core-slots/Button". Workaround: stunt-double slotify (docs/DESIGN.md §11).
  [F6] Vite environment "ssr" externalizes @acme/core: Node would load it natively and slot overrides could not apply there. Keep stunt-double's ssr.noExternal.
  [F6] Vitest deps.optimizer.ssr pre-bundles @acme/core outside the plugin pipeline: overrides would be lost. Remove it from include.
  [F6] @acme/core resolves @acme/core-slots to node_modules/.pnpm/@acme+core-slots@file+sdk-slots/... (a copy, a missing link, or another app's slot package), not sdk-slots/. Use npm "file:", pnpm "link:", Yarn "portal:", Bun "workspace:*".
  [F6] src/pages/Legacy.tsx imports "@acme/core/original/Button" outside src/overrides: that call site renders the SDK default and bypasses the "Button" slot. Import from "@acme/core".
  [F6] @acme/core imports @acme/core-slots/Button but sdk-slots/gen/Button.jsx is not in the bundle: an alias or plugin resolved the socket elsewhere.
  [F7] src/overrides/Button.tsx -> src/components/Fancy.tsx uses <ns>.Button from "@acme/core": that is slot "Button" itself (infinite render). Wrap the default via '@acme/core/original/Button'.
  [W7] src/overrides/Button.tsx renders Dialog from @acme/core, and Dialog renders slot "Button": check for infinite recursion.
  [F8] "react" resolves to 2 copies: app -> node_modules/react, @acme/core -> node_modules/@acme/core/node_modules/react. Contexts/hooks break at runtime. Dedupe the install.
  [F8] "react" is bundled from 2 locations (node_modules/react, ../sdk/node_modules/react): dedupe it (resolve.dedupe / alias / single install).
  [F9] src/overrides/Button.tsx imports "server-only" but "Button" is a client slot (rendered inside "use client" SDK components).
  [STALE] src/stunt-double.check.ts(31,1): error TS2578: Unused '@ts-expect-error' directive.   <- comment above it: src/overrides/Logo.* now exists; run `npx stunt-double gen`
  [TS-PNP] TypeScript 7.0.2 cannot resolve modules under Yarn Plug'n'Play: set "typescript": "typescript5" (npm alias of typescript@5.9) in stunt-double.config.json.
  [X1] typescript.ignoreBuildErrors would skip the slot contract check (src/stunt-double.check.ts). Remove it.
```

When a tool or graph was never wired, stunt-double's own code never runs; the tool's native resolver prints the placeholder's poison text. Strings are verbatim [S] (captured under the earlier working name; absolute paths shortened):

```
vite build : [UNRESOLVED_IMPORT] Could not resolve './STUNT-DOUBLE-NOT-WIRED -- …' in node_modules/@acme/core-slots/not-wired.js
vite dev   : Error: Error during dependency optimization: … Could not resolve './STUNT-DOUBLE-NOT-WIRED -- …'   (process exits)
webpack    : Module not found: Error: Can't resolve './STUNT-DOUBLE-NOT-WIRED -- …' in '…/node_modules/@acme/core-slots'
esbuild    : Could not resolve "./STUNT-DOUBLE-NOT-WIRED -- …"
node / SSR : Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/node_modules/@acme/core-slots/STUNT-DOUBLE-NOT-WIRED -- …'
```

---

## 3. SDK side: what `@acme/core` publishes

The SDK team does a one-time restructuring (a major release) so that every overridable component is reachable only through a socket. After that, each new slot costs one manifest entry and one contract.

### 3.1 Rules for SDK authors

1. **Every internal use of an overridable component is a bare socket import**, never a relative path: `import { Button } from '@acme/core-slots/Button'`. This includes the barrel: `export { Button } from '@acme/core-slots/Button'`.
2. **One module per default implementation** at `dist/original/<Slot>.js`. Nothing in the SDK imports these files.
3. **Contracts are public API** in `contracts.d.ts`. Props are imported *relatively* from the originals, never through a socket. Otherwise a project's tsconfig `paths` makes the check compare the override to itself [V].
4. **Mark client components `"use client"`**: defaults, slot-consuming components and context modules.
5. **Publish ESM** (`"type":"module"`) with an `exports` map, plus `main` and `types` for legacy resolvers and ts-jest.
6. **Named re-exports only.** A missing provider must be a build-time link error, not a namespace stub.

### 3.2 Source (a real fixture shape)

```tsx
// src/original/Button.tsx  -> dist/original/Button.js   (reachable ONLY as '@acme/core/original/Button')
'use client';
import type { ReactNode, Ref } from 'react';
import { useDialog } from '../dialog-context.js';
export interface ButtonProps { children?: ReactNode; variant?: 'primary' | 'secondary'; onClick?: () => void; ref?: Ref<HTMLButtonElement> }
export function Button({ children, variant = 'primary', onClick, ref }: ButtonProps) {
  return <button ref={ref} data-variant={variant} data-ctx={useDialog() ? 'in-dialog' : 'none'} onClick={onClick}>{children}</button>;
}

// src/Dialog.tsx
'use client';
import { DialogContext } from './dialog-context.js';
import { Button } from '@acme/core-slots/Button';   // socket: NEVER './original/Button.js'
import { Logo } from '@acme/core-slots/Logo';       // required slot: the SDK ships no default
export function Dialog({ title, onClose }: { title: string; onClose?: () => void }) {
  return <DialogContext.Provider value={{ title }}><Logo size={16} /><h2>{title}</h2><Button onClick={onClose}>OK</Button></DialogContext.Provider>;
}

// src/index.ts
export { Button } from '@acme/core-slots/Button';   // app-level imports get the effective component too
export { Card } from '@acme/core-slots/Card';
export { Logo } from '@acme/core-slots/Logo';
export { Dialog } from './Dialog.js';
export { useDialog } from './dialog-context.js';
export type { SlotProps, SlotName } from './contracts.js';
```

```ts
// src/contracts.ts -> dist/contracts.d.ts  (published as '@acme/core/contracts', types only)
import type { ButtonProps } from './original/Button.js';      // relative, never via '@acme/core-slots'
import type { CardProps } from './original/Card.js';
export interface LogoProps { size?: number }
/** Props every implementation of a slot must accept. JSDoc here is what `stunt-double ls` and the IDE show. */
export interface SlotProps { Button: ButtonProps; Card: CardProps; Logo: LogoProps }
export type SlotName = keyof SlotProps;
export type RequiredSlot = 'Logo';
export type SlotAbi = 'acme-core-slots/1.0.0+3f2a9c';         // generated: hash(manifest + contracts)
```

### 3.3 `slot-manifest.json`

Generated from a `defineSlots()` table in the SDK source.

```json
{
  "schema": 1,
  "stuntDouble": "^0.1.0",
  "sdk": "@acme/core",
  "version": "1.0.0",
  "abi": "acme-core-slots/1.0.0+3f2a9c",
  "slotPackage": "@acme/core-slots",
  "originalSpecifier": "@acme/core/original/",
  "slots": {
    "Button": { "export": "Button", "kind": "client", "default": "dist/original/Button.js", "consumers": ["Dialog", "Toolbar"] },
    "Card":   { "export": "Card",   "kind": "client", "default": "dist/original/Card.js",   "consumers": [] },
    "Logo":   { "export": "Logo",   "kind": "client", "required": true, "consumers": ["Dialog"] }
  }
}
```

- **`stuntDouble`** is the semver range of the tool that may read this manifest. The generator refuses an unknown `schema` or a tool version outside the range (fail closed).
- **`kind`** is `client`, `shared` or `server`. Only `client` gets `"use client"` and the not-async check.
- **`consumers`** is computed by `sdk-lint` from the dist graph. It feeds the W7 warning.
- **Renames and removals** are declared by the version that makes them. A later major declares `"ActionButton": { …, "renamedFrom": ["Button"] }` and `"removedSlots": { "Tooltip": "use the Popover slot (removed in 2.0.0)" }`. That turns upgrade breakage into an F2 with exact instructions [V].

### 3.4 `package.json`

```json
{
  "name": "@acme/core", "version": "1.0.0", "type": "module", "sideEffects": false,
  "main": "./dist/index.js", "types": "./dist/index.d.ts",
  "exports": {
    ".":                          { "types": "./dist/index.d.ts",          "default": "./dist/index.js" },
    "./original/*":               { "types": "./dist/original/*.d.ts",     "default": "./dist/original/*.js" },
    "./contracts":                { "types": "./dist/contracts.d.ts" },
    "./slot-manifest.json":       "./slot-manifest.json",
    "./stunt-double.schema.json": "./stunt-double.schema.json",
    "./package.json":             "./package.json"
  },
  "peerDependencies": { "react": ">=18", "@acme/core-slots": "*" }
}
```

- **Required peer, range `*`.** It is deliberately **not** `peerDependenciesMeta.optional`. Vite turns a missing *optional* peer into a `__vite-optional-peer-dep` stub that **throws at runtime** in dev (HTTP 200, no overlay) [V]. A required peer gives a resolve error and an overlay.
- **No semver range on the peer.** A range deadlocks SDK upgrades: install checks the peer before the new generator can run [V].
- **`stunt-double.schema.json`** is a JSON Schema for `stunt-double.config.json` with the slot names as an enum. It gives IDE autocomplete and squiggles for `map` keys [U].

### 3.5 The registry placeholder, `@acme/core-slots` (published by the SDK team)

The placeholder owns the package name, which prevents dependency confusion: npm, pnpm and Bun auto-install required peers from the registry [V]. It also turns "not wired" into a self-explaining build error in every resolver [S]. In this repository it lives in `examples/acme-core-slots-placeholder`.

```json
{ "name": "@acme/core-slots", "version": "0.0.1", "type": "module", "sideEffects": false,
  "stuntDouble": { "placeholder": true },
  "exports": { "./package.json": "./package.json", "./*": { "types": "./not-wired.d.ts", "default": "./not-wired.js" } } }
```

```js
// not-wired.js — fails on purpose, at RESOLVE time, in every bundler and in Node
import './STUNT-DOUBLE-NOT-WIRED -- @acme core-slots is not provided by this project, this tool has no stunt-double adapter, or it externalizes @acme core -- run npx stunt-double doctor';
```

```ts
// not-wired.d.ts — no slot exports, so the project's check file reports TS2305 on the wiring line
export declare const __STUNT_DOUBLE_NOT_WIRED__: true;
```

- The version must **not** be a prerelease. node-semver's `*` does not match `0.0.0-placeholder` [S], so auto-install would fail with ETARGET. The placeholder is marked with the `"stuntDouble": { "placeholder": true }` field instead.
- Keep `/ : ? # " '` out of the poison text. Turbopack and other resolvers treat those as URL or path syntax [V].

### 3.6 Build and publish

The simplest correct build is `tsc` emit. It produces one file per module, keeps import specifiers byte-for-byte, keeps `'use client'` prologues, and emits `.d.ts` beside the JS.

```jsonc
// tsconfig.build.json (SDK repo)
{ "compilerOptions": { "rootDir": "src", "outDir": "dist", "declaration": true, "module": "esnext", "moduleResolution": "bundler",
    "jsx": "react-jsx", "target": "es2022", "strict": true,
    "paths": { "@acme/core-slots/*": ["./dev-slots/gen/*"] } },   // the SDK's own type-check sees contract-typed dev slots; specifiers are NOT rewritten
  "include": ["src"] }
```

- **Bundler alternative** (tsdown or Rolldown) [U]: `output.preserveModules: true`, `external: [/^@acme\/core-slots\//, /^react($|\/)/]`, and a directive-preserving setup. Rolldown warns `MODULE_LEVEL_DIRECTIVE` otherwise [V]. A single-file bundle cannot be injected at module level.
- **The SDK repo's own tests, Storybook and dev:** a workspace `dev-slots/`, generated by `stunt-double gen --defaults --fixtures dev-overrides/`, so `@acme/core-slots` resolves inside the SDK repo.
- **Publish gate, `stunt-double sdk-lint dist/`.** Its scanner is the same one projects run [V]. It fails the publish if:
  1. any dist file imports a manifest default, relatively or through `original/*`;
  2. a socket in dist is missing from the manifest, or a manifest slot has no `SlotProps` entry;
  3. `contracts.d.ts` imports from the slot package;
  4. a client default or consumer lacks `"use client"`;
  5. `required` is true and a `default` exists, or the reverse.

  It also writes `consumers` and the `abi`.

### 3.7 Versioning and what changes for SDK authors

| Change | Release type |
|---|---|
| Adopting slots (the new required peer) | **major** |
| Adding an *optional* slot | minor; adapters and postinstall regenerate a default shim automatically |
| Adding a *required* slot, removing or renaming a slot, or narrowing or extending a contract | **major**: consumers' builds fail by design with F1/F2/F3 messages |

What SDK authors change: socket imports only, one manifest entry and one contract per slot, `sdk-lint` in CI, and publishing the placeholder once. In the examples here, `@acme/core@1.0.0` is the release that adopts slots.

---

## 4. Project side: what a customer app writes

### 4.1 Layout

```
src/overrides/Button.tsx            one file per overridden slot (or Button/index.tsx); helpers: _x.tsx or Button/helpers.tsx
src/overrides/Logo.tsx              required slot implementation
src/stunt-double.check.ts           GENERATED, gitignored, listed in tsconfig "files"
sdk-slots/package.json              COMMITTED stub (the universal-tier package; NO dependencies, NO peerDependencies)
sdk-slots/gen/                      GENERATED, gitignored: <Slot>.jsx, <Slot>.d.ts, state.json, tsconfig.check.json, check.map.json, dist-scan cache
stunt-double.config.json            optional (or a "stuntDouble" key in package.json)
```

Ignored inside `src/overrides`: `_*`, `*.test.*`, `*.spec.*`, `*.stories.*`, `*.d.ts`, and assets. Every other top-level file must be a slot (`<Slot>.<ext>` or `<Slot>/index.<ext>`), otherwise you get F2. That is what makes typos and stray files loud.

### 4.2 `stunt-double.config.json`

All keys are optional. Defaults are shown, except that `map` and `allowOriginalImports` show example entries.

```json
{
  "$schema": "./node_modules/@acme/core/stunt-double.schema.json",
  "sdk": "@acme/core",
  "overridesDir": "src/overrides",
  "slotsDir": "sdk-slots",
  "checkFile": "src/stunt-double.check.ts",
  "tsconfig": "tsconfig.json",
  "typescript": "typescript",
  "rsc": "auto",
  "layers": [],
  "map": {
    "Logo": { "from": "src/brand/Logo.tsx", "export": "BrandLogo" },
    "Card": { "ignoresProps": ["dense"] }
  },
  "allowOriginalImports": ["src/styleguide/**"],
  "singletons": ["react", "react-dom"],
  "scanPackages": [],
  "relativeEdges": "error"
}
```

- **`tsconfig`:** point it at the *app* tsconfig for solution-style setups. For example, Vite templates use `tsconfig.app.json`, because `tsconfig.json` only has `references`.
- **`rsc`:** `auto` emits `"use client"` when `next`, `waku`, `@vitejs/plugin-rsc` or a `react-server-dom-*` package is a dependency.
- **`typescript`:** a package name, so `"typescript5"` (an npm alias) can be the gate compiler.
- **`map`:** claims a slot from a file outside the convention directory (`from`), or under another export name (`export`, which may be `"default"`). `ignoresProps` is the explicit, reviewable opt-out from the "declares all props" check (§6.1).
- **`relativeEdges`:** `"error"` (default) reports SDK-internal relative edges as F6; `"redirect"` is the degraded mode of §11.

### 4.3 Overrides

Wrap the default. There is no cycle, because `original/*` is never a socket:

```tsx
// src/overrides/Button.tsx
import { Button as Original } from '@acme/core/original/Button';
import type { SlotProps } from '@acme/core/contracts';
import { useAppTheme } from '../theme';
export function Button(props: SlotProps['Button']) {
  return <span className="brand" data-theme={useAppTheme()}><Original {...props} /></span>;
}
```

Or replace it entirely. The SDK default is then absent from every bundle [V in Vite, webpack, Rspack, esbuild, Rolldown, Turbopack]:

```tsx
// src/overrides/Button.tsx
import { memo } from 'react';
import type { SlotProps } from '@acme/core/contracts';
export const Button = memo(function Button({ children, variant = 'primary', onClick, ref }: SlotProps['Button']) {
  return <button ref={ref} className={`btn btn-${variant}`} onClick={onClick}>{children}</button>;
});
```

Type props as `SlotProps['X']` so SDK upgrades flow through. Overrides that declare their own props interface still work: the check proves compatibility.

### 4.4 Wiring, written by `stunt-double init`

**`package.json`**

```jsonc
{
  "dependencies": {
    "@acme/core": "^1.0.0",
    "@acme/core-slots": "file:./sdk-slots"           // per package manager, see the table below
  },
  "devDependencies": { "stunt-double": "^0.1.0" },
  "scripts": {
    "postinstall": "stunt-double gen --no-fail",     // fresh clones + IDE types; never blocks install; runs in npm/pnpm/Yarn 4/Bun [V]
    "dev": "vite",                                   // the adapter generates + watches in-process
    "build": "vite build",                           // the adapter runs STA + TYP + AUD; a bare `vite build` cannot skip them
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "check": "stunt-double check"                    // CI and T0 tools: `stunt-double check && <tool>`
  }
}
```

| Package manager | Dependency line | Notes |
|---|---|---|
| npm 10 / 12 | `"file:./sdk-slots"` (symlink), or `"workspaces": ["sdk-slots"]` | `link:` and `workspace:` are rejected [V]. In **multi-app npm workspaces** a hoisted SDK sees only one slot package: use adapter-only (no link) per app, or pnpm [V]. |
| pnpm 12 | `"link:./sdk-slots"` | `file:` makes a stale **copy**; the wiring self-test rejects it [V]. Approve build scripts via `allowBuilds` [V]. |
| Yarn 4 (PnP) | `"portal:./sdk-slots"` | The stub must declare **no peers**, or it becomes a `__virtual__` copy that duplicates project modules [V]. Keep the default `pnpFallbackMode`. The type gate needs TS 5.x (§6.4). |
| Bun 1.4 | `"workspace:*"` + `"workspaces": ["sdk-slots"]` | `link:` means Bun's global registry and `file:` is a copy [V]. |

**Committed stub, `sdk-slots/package.json`:**

```json
{ "name": "@acme/core-slots", "version": "0.0.0", "private": true, "type": "module", "sideEffects": false,
  "exports": { "./package.json": "./package.json", "./*": { "types": "./gen/*.d.ts", "default": "./gen/*.jsx" } } }
```

A stub must exist, or npm fails install with ERESOLVE [V]. Its version must not be a prerelease, so that it satisfies the peer `*` [S].

**tsconfig** (the app config). It is written without `baseUrl`, which TypeScript 7 rejects with TS5102 [V]:

```jsonc
{ "compilerOptions": { "paths": { "@acme/core-slots/*": ["./sdk-slots/gen/*"] } },
  "include": ["src"],
  "files": ["src/stunt-double.check.ts"] }          // missing generated file => TS6053, never "silently unchecked" [V]
```

`paths` keeps types identical to runtime even when there is no link. TypeScript applies `paths` inside `node_modules` `.d.ts` files [V]. The target is the same shim the bundlers use, so types and runtime cannot split. Bun's bundler and runtime also honour `paths` for `node_modules` imports [V].

**`.gitignore`:** `sdk-slots/gen/` and `src/stunt-double.check.ts`.

### 4.5 Generated artifacts (examples)

```js
// sdk-slots/gen/Button.jsx
'use client';
// GENERATED by stunt-double: slot "Button" -> src/overrides/Button.tsx#Button. Do not edit; regenerate: npx stunt-double gen
export { Button } from '../../src/overrides/Button.tsx';

// sdk-slots/gen/Card.jsx  (no override)
'use client';
// GENERATED by stunt-double: slot "Card" -> @acme/core default
export { Card } from '@acme/core/original/Card';

// sdk-slots/gen/Button.d.ts
export { Button } from '../../src/overrides/Button.js';
```

---

## 5. Resolution and generation

### 5.1 What every tool does (no stunt-double code at resolve time)

```
resolve('@acme/core-slots/S', importer anywhere, SDK internals included):
  T1 adapter alias (static, identical for every override set):  -> <root>/sdk-slots/gen/S.jsx
  else package resolution from realpath(importer): node_modules/@acme/core-slots
       -> link -> <root>/sdk-slots, exports "./*" -> ./gen/S.jsx (missing => RESOLVE ERROR)
       -> registry placeholder -> not-wired.js -> poisoned import => RESOLVE ERROR naming the fix
  there is NO path from a socket to an SDK default.
resolve('@acme/core/original/S') -> node_modules/@acme/core/dist/original/S.js     (never aliased; no socket maps here)
```

### 5.2 The generator (`stunt-double gen`, and the first step of every adapter)

```
generate(root, opts):
  p.cfg      <- stunt-double.config.json | package.json "stuntDouble" | defaults
  p.manifest <- resolve('<sdk>/slot-manifest.json') from root   (works under PnP; refuse unknown schema / stuntDouble range)
  p.layers   <- for L in cfg.layers: L.package.json "slotLayer"  (L1 wrong sdk, L2 sdkRange !satisfies, F2 unknown slot)
  claims     <- scan(overridesDir, depth 2)  + cfg.map entries
  for each claim: slot unknown -> F2 (Levenshtein<=2 hint; renamedFrom / removedSlots hints)
  for each slot S:
     app claims > 1                         -> F4
     chain = [app claim?, layer impls (last listed first)?, SDK default?]
     chain empty                            -> F3
     for impl in chain (non-SDK):
        named export missing (oxc; `export *` defers to tsc)      -> F5
        transitive walk (oxc-parser + oxc-resolver, tsconfig paths aware, stops at node_modules except scanPackages):
           imports `${slotPackage}/S`, or {export(S)} / ns.export(S) from the SDK (not original/contracts) -> F7
           imports an SDK export listed in manifest.slots[S].consumers                                  -> W7 (warning)
           S.kind == client and closure imports 'server-only'                                           -> F9
  bypass scan: project files outside overridesDir/allowOriginalImports importing '<sdk>/original/*' -> F6
  dist scan (cached per sdk@version+manifest hash): SDK/layer files importing a default (relative or original/*) -> F6;
             record socketConsumers[S] = SDK files importing `${slotPackage}/S`  (used by AUD)
  wiring (only if a link dependency is declared): realpath(resolve(slotPackage/package.json) from realpath(SDK))
             == realpath(slotsDir/package.json); '__virtual__' -> F8b; placeholder/copy/foreign -> F6
  singletons: for pkg in [react, react-dom, sdk, ...layers]: realpath(resolve(pkg/package.json)) from
             {root, SDK, slotsDir, each layer, each override dir} must be one value      -> F8
  if problems: onError == 'throw' -> throw; 'poison' -> write poisoned shims (all slots); 'return' -> return them
  else emit (write only changed bytes, so there is no spurious HMR or cache invalidation):
     gen/S.jsx   = [directive] + `export { <impl export> as <S export> } from '<relative override path with .tsx | layer spec | original spec>'`
     gen/S.d.ts  = same re-export, '.js' extension form
     src/stunt-double.check.ts (§6.1), gen/check.map.json (line ranges -> slot/file), gen/tsconfig.check.json, gen/state.json (fingerprint)
```

### 5.3 Core code (reference implementation excerpts)

These live in `stunt-double/core` and are shared by the CLI and every adapter.

**Transitive F7 walk.** Verified [S] with oxc-parser 0.153.0 and oxc-resolver 11.24.2. It catches `@/components/Fancy` (a tsconfig `paths` alias) importing `* as Sdk` and using `Sdk.Button`, and a named `{ Button as B }` from the barrel. It does not flag `original/*`. It takes 2–3 ms on the fixture.

```js
import fs from 'node:fs'; import path from 'node:path';
import { parseSync } from 'oxc-parser';
import { ResolverFactory } from 'oxc-resolver';
export function findSelfImports({ root, overrideFile, slot, exportName, sdk, slotPkg, scanPackages = [] }) {
  const r = new ResolverFactory({ tsconfig: 'auto', conditionNames: ['import', 'module', 'default'],
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs'], extensionAlias: { '.js': ['.ts', '.tsx', '.js'] } });
  const hits = [], seen = new Set();
  const walk = (file, chain) => {
    if (seen.has(file)) return; seen.add(file);
    const src = fs.readFileSync(file, 'utf8'); const { module: m, errors } = parseSync(file, src);
    if (errors.length) return void hits.push(`[F7?] cannot parse ${path.relative(root, file)}: ${errors[0].message}`);
    const edges = [...m.staticImports.map((i) => ({ spec: i.moduleRequest.value, entries: i.entries })),
      ...m.staticExports.flatMap((e) => e.entries.filter((x) => x.moduleRequest).map((x) => ({ spec: x.moduleRequest.value, entries: [x] }))),
      ...m.dynamicImports.map((d) => ({ spec: src.slice(d.moduleRequest.start + 1, d.moduleRequest.end - 1), entries: null }))];
    for (const e of edges) {
      const via = `${[...chain, file].map((f) => path.relative(root, f)).join(' -> ')}`;
      if (e.spec === `${slotPkg}/${slot}`) { hits.push(`[F7] ${via} imports "${e.spec}": that is slot "${slot}" itself (infinite render). Wrap the default via '${sdk}/original/${slot}'.`); continue; }
      const isSdk = e.spec === sdk || (e.spec.startsWith(sdk + '/') && !/\/(original|contracts)(\/|$)/.test(e.spec.slice(sdk.length)));
      if (isSdk && e.entries) {
        const names = e.entries.filter((x) => !x.isType).map((x) => (x.importName?.kind === 'Name' ? x.importName.name : x.importName?.kind));
        if (names.includes(exportName)) hits.push(`[F7] ${via} imports { ${exportName} } from "${e.spec}": that is slot "${slot}" itself (infinite render). Wrap the default via '${sdk}/original/${slot}'.`);
        else if (names.includes('NamespaceObject') && new RegExp(`\\b\\w+\\.${exportName}\\b`).test(src)) hits.push(`[F7] ${via} uses <ns>.${exportName} from "${e.spec}": that is slot "${slot}" itself (infinite render). Wrap the default via '${sdk}/original/${slot}'.`);
        continue;
      }
      const res = r.resolveFileSync(file, e.spec);
      const inNm = res.path?.includes(`${path.sep}node_modules${path.sep}`);
      if (res.path && /\.[cm]?[jt]sx?$/.test(res.path) && (!inNm || scanPackages.some((p) => res.path.includes(`${path.sep}${p}${path.sep}`)))) walk(res.path, [...chain, file]);
    }
  };
  walk(overrideFile, []);
  return hits;
}
```

**Wiring self-test and singleton preflight.** The mechanism was observed in earlier prototypes [V]: it rejected pnpm `file:` copies, PnP virtual packages and npm cross-app hoisting.

```js
export function checkWiring(p) {
  if (!p.linkDeclared) return [];                       // adapter-only project: unwired tools hit the placeholder (fail-closed)
  const fromSdk = createRequire(path.join(real(p.sdk.dir), 'package.json'));
  let seen; try { seen = real(fromSdk.resolve(`${p.sdk.slotPackage}/package.json`)); }
  catch (e) { return [`[F6] ${p.sdk.name} cannot resolve ${p.sdk.slotPackage} (${e.code}): reinstall after adding the dependency line.`]; }
  if (seen.includes(`${path.sep}__virtual__${path.sep}`)) return [`[F8] ${p.sdk.slotPackage} is a Yarn PnP __virtual__ instance because ${p.rel(p.slotsDir)}/package.json declares peerDependencies: remove them (shims would load second copies of your modules).`];
  const want = real(path.join(p.slotsDir, 'package.json'));
  if (seen !== want) return [`[F6] ${p.sdk.name} resolves ${p.sdk.slotPackage} to ${p.rel(seen)} (${readJson(seen).stuntDouble?.placeholder ? 'the registry placeholder: the link is missing' : 'a copy, or another app\'s slot package'}), not ${p.rel(want)}. Use npm "file:", pnpm "link:", Yarn "portal:", Bun "workspace:*".`];
  return [];
}
export function checkSingletons(p) {
  const vantage = { app: p.root, [p.sdk.name]: real(p.sdk.dir), slots: p.slotsDir, ...p.layerDirs, ...p.overrideDirs };
  const out = [];
  for (const name of [...p.cfg.singletons, p.sdk.name, ...p.layers.map((l) => l.name)]) {
    const seen = {};
    for (const [k, dir] of Object.entries(vantage)) { try { seen[k] = path.dirname(real(createRequire(path.join(dir, 'noop.js')).resolve(`${name}/package.json`))); } catch {} }
    if (new Set(Object.values(seen)).size > 1) out.push(`[F8] "${name}" resolves to ${new Set(Object.values(seen)).size} copies: ${Object.entries(seen).map(([k, v]) => `${k} -> ${p.rel(v)}`).join(', ')}. Contexts/hooks break at runtime. Dedupe the install.`);
  }
  return out;
}
```

**Post-bundle audit.** It is shared by every adapter. Each adapter only converts its graph into `[{ id, importers[] }]` of realpaths.

```js
export function auditGraph(p, graph) {
  const out = [], ids = new Set(graph.map((m) => m.id));
  for (const m of graph) {
    const slot = p.defaultFileToSlot.get(m.id);                       // a manifest default (or layer impl) in the bundle
    if (slot) for (const imp of m.importers) if (!p.mayImportImpl(imp, slot))
      out.push(`[F6] ${p.rel(imp)} imports the SDK default of slot "${slot}" (${p.rel(m.id)}) directly: the slot is bypassed there.`);
  }
  for (const [slot, consumers] of p.socketConsumers)                   // from the dist scan
    if (consumers.some((f) => ids.has(f)) && !ids.has(p.shimFile(slot)))
      out.push(`[F6] ${p.sdk.name} imports ${p.sdk.slotPackage}/${slot} but ${p.rel(p.shimFile(slot))} is not in the bundle: an alias or plugin resolved the socket elsewhere.`);
  for (const [name, roots] of packageRoots(graph, [...p.cfg.singletons, p.sdk.name])) if (roots.size > 1)
    out.push(`[F8] "${name}" is bundled from ${roots.size} locations (${[...roots].map(p.rel).join(', ')}): dedupe it (resolve.dedupe / alias / single install).`);
  return [...new Set(out)];
}
// p.mayImportImpl(file, slot): file is the shim of `slot`, or lies under overridesDir, a layer root, or allowOriginalImports.
```

Never use "the socket never reached resolveId" as the not-applied signal. webpack 5.111's LazyBarrel and unused slots never resolve [V]. The audit inspects the final graph instead.

### 5.4 Cycle avoidance

- Shim → override → `original/S` is acyclic by construction, because `original/*` is a different export subpath that no socket maps to.
- An implementation that reaches its own socket fails as F7: directly, through the barrel, through a namespace member, or transitively. The check is static, so no bundler needs to detect cycles. None does natively: the result is an infinite render or a prerender OOM with SIGABRT [V].

### 5.5 Layering (optional: a company brand package between the SDK and the app)

A layer is a published package with a `slotLayer` field. Its own components render slots through `@acme/core-slots/X`, and it declares the same required peer.

```json
"slotLayer": { "schema": 1, "sdk": "@acme/core", "sdkRange": "^1.0.0", "slots": { "Button": { "file": "./dist/layer/Button.js", "export": "Button" } } },
"exports": { ".": "./dist/index.js", "./layer/*": { "types": "./dist/layer/*.d.ts", "default": "./dist/layer/*.js" } }
```

- **Effective order:** the app, then layers in reverse config order, then the SDK default. The shim re-exports the top.
- **Wrapping:** an implementation wraps the level below through an explicit specifier, either `<lowerLayer>/layer/X` or `@acme/core/original/X`. If a layer stops providing X, the wrapper fails loudly with "Package subpath './layer/X' is not defined" instead of silently wrapping something else.
- **Checks:** every layer implementation gets its own contract block, so an SDK upgrade that breaks a precompiled brand layer fails the app's type check. L1, L2, layer F2 and layer F7 are STA checks. Layers are added to `noExternal`, `transpilePackages` and `transformIgnorePatterns`, and to the dist scan.
- **Evidence:** [V] in an earlier resolver-based prototype; [U] in this topology.

---

## 6. Type safety

This is "fits the costume". No bundler type-checks, and a plain project `tsc` has nothing that relates an override to the SDK's contract. stunt-double generates that relation as a small TypeScript file and makes sure something runs it in every build.

### 6.1 The generated check file (`src/stunt-double.check.ts`)

```ts
// GENERATED by stunt-double from @acme/core@1.0.0 — do not edit. Regenerate: npx stunt-double gen
import type { ComponentProps, JSXElementConstructor } from 'react';
import type { SlotProps, SlotName, SlotAbi } from '@acme/core/contracts';
type PropsOf<C> = C extends JSXElementConstructor<any> ? ComponentProps<C> : never;
type OnlyAsync<C> = C extends (...a: any[]) => infer R ? ([R] extends [PromiseLike<any>] ? true : false) : false;

/** [STALE] TS2322 here = the installed SDK differs from the one this file was generated for: run `npx stunt-double gen` */
export const __abi: SlotAbi = 'acme-core-slots/1.0.0+3f2a9c';
/** [WIRING] TS2305/TS2307 here = @acme/core-slots is not the project's generated package (tsconfig paths / link missing) */
import { Button as Button__wired } from '@acme/core-slots/Button';
import { Card as Card__wired } from '@acme/core-slots/Card';
import { Logo as Logo__wired } from '@acme/core-slots/Logo';
/** [F2]/[F3] an SDK upgrade added or removed slots: TS2741/TS1360 here until regenerated */
export const __slotSet = { Button: Button__wired, Card: Card__wired, Logo: Logo__wired } satisfies Record<SlotName, unknown>;

// ---- slot "Button" <- src/overrides/Button.tsx#Button (client)
import { Button as Button__impl } from './overrides/Button';                 // [F5] TS2305/TS2614 if the export is missing
export const Button__isComponent: JSXElementConstructor<any> = Button__impl; // [F1] must be a component (fn, memo, forwardRef, class)
/** [F1] must accept EVERY props object the SDK may pass. Plain object assignability: independent of strict mode. */
export const Button__accepts = (p: SlotProps['Button']): PropsOf<typeof Button__impl> => p;
type Button__missing = Exclude<keyof SlotProps['Button'], keyof PropsOf<typeof Button__impl> | never /* map.Button.ignoresProps */>;
export const Button__declaresAll: [Button__missing] extends [never] ? true
  : { '[F1] override ignores these SDK props (declare them, or list them in map.Button.ignoresProps)': Button__missing } = true;
export const Button__notAsync: OnlyAsync<typeof Button__impl> extends true
  ? { '[F9] client slot override must not be an async component': 'Button' } : true = true;

// ---- slot "Logo" <- src/overrides/Logo.tsx#Logo (client, required)
// ... same five assertions ...

// ---- staleness probes for slots WITHOUT an override when generated (exported, so noUnusedLocals cannot mask them)
// @ts-expect-error [STALE] no src/overrides/Card.* existed when generated; if this stops erroring, run `npx stunt-double gen`
export type Card__probe = typeof import('./overrides/Card');
```

Reading it top to bottom:

- **`__abi`** pins the SDK version and contract hash the file was generated for. Upgrading the SDK without regenerating is a TS2322 that names both ABIs.
- **The wiring imports** fail with TS2305 when `@acme/core-slots` resolves to the placeholder instead of the project's package.
- **`__slotSet`** fails when an SDK upgrade added or removed slots and the file was not regenerated.
- **Five assertions per implementation**: the import itself (F5), `isComponent`, `accepts`, `declaresAll` and `notAsync`.
- **Staleness probes**: for each slot that had no override at generation time, a `@ts-expect-error` import of the file that would be its override. If someone adds that file without regenerating, the directive becomes unused and TypeScript reports TS2578.

### 6.2 What each assertion catches

Verified in TypeScript 7.0.2 and 5.9.3, with `strict` on and off [V]:

| Override | `isComponent` | `accepts` | `declaresAll` | `notAsync` | Result |
|---|---|---|---|---|---|
| plain function typed `SlotProps['Button']` | ok | ok | ok | ok | pass |
| `React.FC<P>`, `memo()`, `forwardRef()`, returns `children`, class component | ok | ok | ok | ok | **pass** (a sync-function-shape contract falsely rejects these [V]) |
| extra **required** prop | | TS2322 "Property 'tone' is missing" | | | **fail** |
| narrowed union (`variant: 'primary'`) | | TS2322 "'"secondary"' is not assignable" | | | **fail** |
| declares fewer props (would silently drop SDK props) | | | TS2322 "override ignores these SDK props: 'onClick' \| 'variant'" | | **fail** |
| own-props interface after an SDK upgrade adds `'danger'` and `size` | | TS2322 | TS2322 | | **fail** [V, lab fixture 3.0 → 3.1] |
| wrong `ref` element type | | TS2322 "Types of property 'ref' are incompatible" | | | **fail** |
| `async function Button()` | | | | TS2322 '[F9] …' | **fail** |
| default export / wrong name | TS2614 / TS2305 at the import | | | | **fail** |
| not a component (a string) | TS2322 | | | | **fail** |
| SDK upgraded without regenerating | `__abi` TS2322 naming both ABIs | | | | **fail** [V] |
| override added without regenerating | probe TS2578 | | | | **fail** [V] |

The naive `const x: Contract = Impl` **passes** under `strict:false` (parameter bivariance), which is Next's default tsconfig. That is why `accepts` uses object assignability [V]. One known gap: a component typed `React.FC<P>` has a return type that already admits `Promise<ReactNode>`, so `notAsync` cannot flag an async body hidden behind an `FC` annotation.

### 6.3 The type gate: how each tool runs it, and what it costs

**No bundler type-checks.** `vite build`, Rolldown, Rollup, esbuild, webpack, Rspack, Parcel, Bun and Metro all exit 0 with type errors [V]. A plain project `tsc` also passes an incompatible override when nothing relates it to the contract [V]. The check file creates that relation, and the gate runs it.

```js
// stunt-double/core/typegate.mjs — TS 7 has no classic JS API: always spawn the CLI, resolved BY PACKAGE NAME (X4)
export function runTypeGate(p) {
  const req = createRequire(path.join(p.root, 'package.json'));
  const pj = req.resolve(`${p.cfg.typescript ?? 'typescript'}/package.json`), ts = readJson(pj);
  const bin = path.join(path.dirname(pj), typeof ts.bin === 'string' ? ts.bin : ts.bin.tsc);
  if (p.isPnP && Number(ts.version.split('.')[0]) >= 7)
    return Promise.resolve({ ok: false, message: `[TS-PNP] TypeScript ${ts.version} cannot resolve modules under Yarn Plug'n'Play: set "typescript": "typescript5" (npm alias of typescript@5.9) in stunt-double.config.json.` });
  writeJson(p.checkTsconfig, { extends: p.appTsconfigRel, files: [p.checkFileRel], include: [],
    compilerOptions: { noEmit: true, skipLibCheck: true, incremental: false, composite: false, noUnusedLocals: false } });
  return new Promise((done) => { const t0 = performance.now();
    execFile(process.execPath, [bin, '-p', p.checkTsconfig, '--pretty', 'false'], { cwd: p.root, maxBuffer: 1 << 26 }, (err, so, se) => {
      const ms = Math.round(performance.now() - t0);
      done(err ? { ok: false, ms, message: mapDiagnostics(p, `${so}${se}`, ts.version, ms) } : { ok: true, ms }); }); });   // ANY non-zero exit fails (TS7: 1, TS5.9: 2)
}
```

`mapDiagnostics` rewrites check-file lines to `[F1] Button (src/overrides/Button.tsx): TS2322 …` using `check.map.json`. Diagnostics inside override files are reported as `[TS]` and also fail: the gate program is exactly the overrides plus what they import.

| Tool | How F1 fails the build | Added cost (fixtures) |
|---|---|---|
| Vite 8 / Rolldown / Rollup | Adapter `buildStart` awaits the gate (memoized once per process for client + SSR environments) → `this.error` → exit 1 [V] | TS 7: +150–200 ms; TS 5.9: +0.8–1.0 s [V] |
| esbuild | Adapter `onStart` returns `errors` [U; same pattern V] | same |
| webpack 5 / Rspack 2 | Adapter starts the gate in `thisCompilation` and awaits it in `finishModules.tapPromise` (an AsyncSeriesHook in both [S]); pushes to `compilation.errors` (exit 1 + overlay; never throw [V]). **Do not** rely on fork-ts-checker 9.1.0: with TS 7 it crashes and the build passes [V]. ts-checker-rspack-plugin 1.7 with `tsgo:true` works [V] | same; fork-ts-checker was +1.4 s |
| Next 16 | `next build` type-checks the whole program, including `src/stunt-double.check.ts` (TS 5.x via the API; TS 7 via the default `experimental.useTypeScriptCli`) [V]. The adapter refuses `ignoreBuildErrors` (X1) | Next's TS phase: 1.6–1.9 s (TS 5.9) |
| CRA 5 (craco) | CRA's ForkTsChecker reports `src/**` only, so the check file lives in `src/` [V]. TS 5 only | included |
| Jest / Vitest / `next dev` / webpack-dev-server | Not gates (babel/swc, or async dev). CI `tsc` / `stunt-double check` | — |
| Parcel / Bun / Metro / unknown | `stunt-double check && <build>` | ~0.2 s (TS 7) |
| CI (every project) | `stunt-double check` (STA + TYP) and the project's own `tsc --noEmit` (includes the check file) | |

### 6.4 TypeScript 5.9 vs 7

- **Exit codes:** TS 7 exits 1 and TS 5.9 exits 2; the gate treats any non-zero exit as failure [V].
- **`baseUrl`:** removed in TS 7 (TS5102), so `paths` are written relative to the tsconfig [V].
- **Paths and conditions:** `paths` inside `node_modules` `.d.ts` and `customConditions` behave the same in both versions [V].
- **Yarn PnP:** TS 7.0.2 cannot resolve under PnP and fails closed [V]. The gate refuses up front with `[TS-PNP]` and accepts a TS 5.x alias package [U].
- **Dot-directories:** generated files are never put in a dot-directory, because `**/*` include globs skip them [V].

### 6.5 What tsc and the IDE see

- App code: `import { Button } from '@acme/core'` → the SDK's `index.d.ts` → `@acme/core-slots/Button` → `paths` → `sdk-slots/gen/Button.d.ts` → the override.
- App code is therefore typed by the **override** (a proven supertype of the contract props), and **go-to-definition lands on `src/overrides/Button.tsx`** [V TS 5.9 language service; U tsgo LSP].
- Un-overridden slots land on the SDK's `original` declaration.
- Errors appear as squiggles on the exact assertion line, with the reason in the type text.

---

## 7. Per-tool integration

Every adapter is a thin wrapper around the same pure core (`stunt-double/core`). Every adapter does four things:

1. regenerates and validates at start;
2. installs **one static alias**, `@acme/core-slots/<Slot>` → `<root>/sdk-slots/gen/<Slot>.jsx`;
3. reports through the host's error channel, never with a bare `throw`, except at config load where a throw *is* the gate;
4. runs the type gate and the audit in build mode.

| Tool family | Entry point | Section |
|---|---|---|
| Vite 8, Vitest 5, Rollup, Rolldown, Storybook (builder-vite), React Router 8 / Remix, Astro | `stuntDouble()` from `stunt-double/vite` | §7.1 |
| esbuild | `stuntDoubleEsbuild()` from `stunt-double/esbuild` | §7.2 |
| webpack 5, Rspack 2, Rsbuild 2, Next `--webpack`, CRA via craco, Gatsby, Storybook `webpackFinal` | `withStuntDouble()` from `stunt-double/webpack` | §7.3 |
| Next 16 (Turbopack default, `--webpack` opt-in) | `withStuntDouble()` from `stunt-double/next` | §7.4 |
| Jest 30 | `withStuntDouble()` from `stunt-double/jest` | §7.5 |
| Metro (React Native / Expo) | `withStuntDouble()` from `stunt-double/metro` | §7.6 |
| Parcel 2, Bun 1.4, Farm, unknown bundlers | universal tier; optional `stunt-double/parcel` resolver and `stuntDoubleBun()` from `stunt-double/bun` | §7.7 |

### 7.1 Vite 8, Vitest 5, Storybook (builder-vite), React Router 8, Remix, Astro

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { stuntDouble } from 'stunt-double/vite';
export default { plugins: [react(), stuntDouble()] };
```

```js
// stunt-double/vite (also a Rollup/Rolldown plugin: Vite-only hooks are ignored there)
import { generate, regenerate, runTypeGate, auditGraph, formatProblems, rollupGraph, esc } from 'stunt-double/core';
export function stuntDouble(opts = {}) {
  let p, command, server, gate;
  const vitest = !!process.env.VITEST;
  return {
    name: 'stunt-double', enforce: 'pre',
    config(user, env) {
      command = env.command;
      p = generate({ root: user.root ?? opts.root ?? process.cwd(), ...opts,
        onError: vitest ? 'throw' : command === 'serve' ? 'poison' : 'return' });
      const pk = p.packages;                                             // [sdk, ...layers]
      return {
        resolve: { alias: [{ find: new RegExp(`^${esc(p.sdk.slotPackage)}/([A-Za-z0-9_]+)$`), replacement: `${p.genDir}/$1.jsx` }],
                   dedupe: ['react', 'react-dom', ...pk] },
        optimizeDeps: { include: p.originals,                            // every '@acme/core/original/X' + layer impls: no late re-optimization
                        exclude: [p.sdk.slotPackage],
                        rolldownOptions: { external: [p.genDirRegex], plugins: [optimizerTripwire(p)] } },
        ssr: { noExternal: pk },
        test: { server: { deps: { inline: pk } } },
      };
    },
    configResolved(c) {                                                  // CFG: graphs the plugin could not see would silently use defaults
      const pk = p.packages, covered = (l, n) => l === true || [].concat(l ?? []).some((x) => (x instanceof RegExp ? x.test(n) : x === n));
      for (const [name, env] of Object.entries(c.environments ?? {})) {
        if (env.consumer === 'server') for (const n of pk) if (!covered(env.resolve?.noExternal, n) && !covered(c.test?.server?.deps?.inline, n))
          throw new Error(`[F6] Vite environment "${name}" externalizes ${n}: Node would load it natively and slot overrides could not apply there. Keep stunt-double's ssr.noExternal.`);
        if ((env.optimizeDeps?.include ?? []).some((i) => i.startsWith(p.sdk.slotPackage)))
          throw new Error(`[F6] optimizeDeps.include contains ${p.sdk.slotPackage} in "${name}": the override decision would be frozen into .vite/deps. Remove it.`);
      }
      for (const [k, o] of Object.entries(c.test?.deps?.optimizer ?? {})) if (o?.enabled && (o.include ?? []).some((i) => pk.some((n) => i.startsWith(n))))
        throw new Error(`[F6] Vitest deps.optimizer.${k} pre-bundles ${pk.join(', ')} outside the plugin pipeline: overrides would be lost. Remove it from include.`);
    },
    async buildStart() {
      if (command === 'serve') return;
      if (p.problems.length) this.error(formatProblems(p));             // STA -> exit 1
      if (opts.typecheck === false) return;
      gate ??= runTypeGate(p); const r = await gate;                     // TYP -> exit 1 (default ON in build)
      if (!r.ok) this.error(r.message);
    },
    buildEnd(err) { if (!err && command !== 'serve') { const a = auditGraph(p, rollupGraph(this)); if (a.length) this.error(a.join('\n')); } },   // AUD
    configureServer(s) {
      server = s;
      const push = (message) => { s.config.logger.error(message); s.environments.client.hot.send({ type: 'error', err: { message, stack: '', plugin: 'stunt-double' } }); };
      if (p.problems.length) push(formatProblems(p));
      s.watcher.add([p.overridesDir, p.configFile]);
      let t; const kick = (f) => { if (!p.watches(f)) return; clearTimeout(t); t = setTimeout(async () => {
        p = regenerate(p, { onError: 'poison' });                        // rewrites only changed shims; Vite's own watcher reloads them
        if (p.problems.length) return push(formatProblems(p));
        if (opts.typecheck !== false) { const r = await runTypeGate(p); if (!r.ok) push(r.message); }   // async F1 overlay
      }, 60); };
      for (const ev of ['add', 'unlink', 'change']) s.watcher.on(ev, kick);
    },
  };
}
const optimizerTripwire = (p) => ({ name: 'stunt-double:optimizer-tripwire',
  load(id) { if (p.isProjectSlotFile(id)) this.error(`[F6] the dependency optimizer tried to pre-bundle ${p.rel(id)}: the override decision would be frozen into .vite/deps. Remove custom optimizeDeps settings that pull in ${p.sdk.slotPackage}.`); } });
```

**Evidence.**

- Alias to a `.jsx` shim with no plugin: the pre-bundle imports `/sdk-slots/gen/Button.jsx` externally and contains no project code [S].
- The full adapter shape in real Chromium: add, edit, swap and delete applied live (155–320 ms, Fast Refresh for edits, 0–1 reloads); typo and F1 overlays appeared and then cleared; a cold restart with an old `.vite` cache was correct; client and SSR matched [V on equivalent layouts].
- Without `include` of the originals, the cold first load re-optimizes once [V].
- Vitest 5 names its environment `__vitest__`, and the guard covers it [V].
- `test.deps.optimizer` is off by default in Vitest 5 [V].

**Rolldown / Rollup.** Use the same object, `plugins: [stuntDouble()]`. Rollup has no `enforce:'pre'`, but node-resolve 16 defers via `this.resolve(…, {skipSelf:true})`, so plugin order is harmless; the audit is the backstop [V]. Use `this.error` everywhere [V].

**Storybook 10, builder-vite.** It loads the user's `vite.config`, so the plugin applies automatically [V by reading builder-vite]. With a separate config, add `viteFinal: (c) => mergeConfig(c, { plugins: [stuntDouble()] })`.

**React Router 8 framework mode / Remix.** Add the plugin next to `reactRouter()`. The router's child compiler reloads the user config; the core memoizes per fingerprint [U]. The SSR environment guard applies.

**Astro 7.** Use `vite: { plugins: [stuntDouble()] }`, or an integration's `updateConfig` in `astro:config:setup`. Islands are the client graph [U].

### 7.2 esbuild (native plugin)

unplugin's esbuild adapter drops `this.error` and bundles overrides twice [V], so this is a native plugin:

```js
// stunt-double/esbuild
export function stuntDoubleEsbuild(opts = {}) {
  return { name: 'stunt-double', setup(build) {
    const root = opts.root ?? build.initialOptions.absWorkingDir ?? process.cwd();
    let p = generate({ root, ...opts, onError: 'return' });
    build.initialOptions.metafile = true;                                     // needed for AUD
    build.onStart(async () => {
      p = regenerate(p, { onError: 'return' });
      if (p.problems.length) return { errors: p.problems.map((text) => ({ text })) };
      if (opts.typecheck !== false) { const r = await runTypeGate(p); if (!r.ok) return { errors: [{ text: r.message }] }; }
    });
    build.onResolve({ filter: new RegExp(`^${esc(p.sdk.slotPackage)}/[A-Za-z0-9_]+$`) }, (a) => ({ path: p.shimFile(a.path.split('/').pop()) }));
    build.onEnd((res) => { if (res.errors.length || !res.metafile) return;
      const a = auditGraph(p, esbuildGraph(res.metafile, root)); if (a.length) return { errors: a.map((text) => ({ text })) }; });  // OnEndResult.errors [S types]
  } };
}
```

Zero-plugin alternative: `alias: stuntDoubleAlias()` (subpath keys → absolute shims) [V], with `stunt-double check &&` in the script.

### 7.3 webpack 5, Rspack 2, Rsbuild 2, Next `--webpack`, CRA via craco, Gatsby, Storybook `webpackFinal`

```js
// webpack.config.mjs:  export default withStuntDouble({ ...yourConfig })
// rsbuild.config.ts:   tools: { rspack: (c) => withStuntDouble(c) }
// craco.config.js:     webpack: { configure: (c, { env }) => withStuntDouble(c, { mode: env }) }
// gatsby-node.js:      onCreateWebpackConfig: ({ actions, getConfig }) => actions.replaceWebpackConfig(withStuntDouble(getConfig()))
export function withStuntDouble(config, opts = {}) {
  const p = generate({ root: opts.root ?? config.context ?? process.cwd(), ...opts, onError: 'return' });
  config.resolve ??= {}; config.resolve.alias ??= {};
  for (const s of p.slots) config.resolve.alias[`${p.sdk.slotPackage}/${s}$`] = p.shimFile(s);   // exact-match, explicit file targets (F4-safe)
  config.module ??= {}; config.module.parser ??= {};
  config.module.parser.javascript = { ...config.module.parser.javascript, exportsPresence: 'error' };   // F5 is an error even for javascript/auto [V]
  if (config.cache && typeof config.cache === 'object') config.cache.version = `${config.cache.version ?? ''}|stunt-double:${p.fingerprint}`;
  (config.plugins ??= []).push(new StuntDoublePlugin(p, opts));
  return config;
}
export class StuntDoublePlugin {
  constructor(p, opts) { this.p = p; this.opts = opts; }
  apply(compiler) {
    const NAME = 'stunt-double', { WebpackError } = compiler.webpack;          // Rspack exports WebpackError too [S types]
    const prod = (this.opts.mode ?? compiler.options.mode) === 'production';
    compiler.hooks.watchRun.tap(NAME, () => {                                  // dev/watch: overrides dir is a context dependency
      this.p = regenerate(this.p, { onError: 'poison' });
      if (this.p.changedFiles.length) typeof compiler.inputFileSystem?.purge === 'function'
        ? compiler.inputFileSystem.purge(this.p.changedFiles) : compiler.purgeInputFileSystem?.();       // [U]
    });
    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      const err = (m) => compilation.errors.push(new WebpackError(m));         // never throw: a throw skips the dev overlay [V]
      this.p.problems.forEach((x) => err(x));
      compilation.contextDependencies.add(this.p.overridesDir);
      compilation.fileDependencies.add(this.p.configFile);
      const gate = prod && this.opts.typecheck !== false && !this.p.problems.length ? runTypeGate(this.p) : null;
      compilation.hooks.finishModules.tapPromise(NAME, async (modules) => {
        for (const m of auditGraph(this.p, webpackGraph(compilation, modules))) err(m);   // Rspack: m.resource only, never resourceResolveData [V]
        const r = await gate; if (r && !r.ok) err(r.message);
      });
    });
  }
}
```

- **Never use `resolve.plugins`:** Rspack silently ignores it [V].
- **Never replace modules in `afterResolve`:** loaders are then chosen for the old path and the build breaks [V].
- **Rsbuild:** `resolve.dedupe` fixes F8 [V].

### 7.4 Next 16 (Turbopack default, `--webpack` opt-in)

```js
// next.config.mjs:  export default withStuntDouble({ ...yourConfig })
import { withStuntDouble as withWebpack } from 'stunt-double/webpack';
export function withStuntDouble(nextConfig = {}, opts = {}) {
  const p = generate({ root: opts.root ?? process.cwd(), ...opts, onError: 'throw' });   // fails `next build` and `next dev` startup [V]
  if (nextConfig.typescript?.ignoreBuildErrors) throw new Error('[X1] typescript.ignoreBuildErrors would skip the slot contract check (src/stunt-double.check.ts). Remove it.');
  if (!p.tsconfigCoversCheckFile) throw new Error(`[X2] ${p.cfg.tsconfig} does not include ${p.rel(p.checkFile)}: next build would not type-check slot contracts.`);
  const rel = './' + path.relative(p.root, p.genDir).split(path.sep).join('/');           // Turbopack silently ignores absolute targets [V]
  return { ...nextConfig,
    transpilePackages: [...new Set([...(nextConfig.transpilePackages ?? []), ...p.packages])],   // Pages Router would externalize the SDK [V]
    turbopack: { ...nextConfig.turbopack, resolveAlias: { ...nextConfig.turbopack?.resolveAlias, [`${p.sdk.slotPackage}/*`]: `${rel}/*.jsx` } },
    webpack(config, ctx) { const c = nextConfig.webpack ? nextConfig.webpack(config, ctx) : config; return withWebpack(c, { ...opts, typecheck: false }); } };
}
```

- **Turbopack has no resolver API**; only `resolveAlias` and loaders exist [V]. That is why the decision must be static: a wildcard alias to file content. A wildcard alias with a `./` target works [V]. Absolute or missing targets fall back *silently*, but here a missing target cannot happen: shims exist for every slot, and a typo'd *directory* would leave the placeholder on the path.
- **Dev:** `"dev": "stunt-double watch -- next dev"` regenerates shims, and Turbopack picks up content changes. Add, swap and remove work without a restart; mistakes become an HTTP 500 carrying the poison text [V].
- **Optional, for live errors without the wrapper:** a validation loader on the SDK entry with `addContextDependency(overridesDir)` [V mechanism].
- **Only `browser` aliases are honoured by Turbopack**, and other condition keys are silently ignored [V]. stunt-double never uses conditional resolution, so the server and client graphs cannot split.

### 7.5 Jest 30

```js
// jest.config.mjs:  export default withStuntDouble({ testEnvironment: 'jsdom', ...yourConfig })
export function withStuntDouble(config = {}, opts = {}) {
  const p = generate({ root: opts.root ?? process.cwd(), ...opts, onError: 'throw' });   // STA failures exit 1 [V]
  const rootDir = path.resolve(config.rootDir ?? p.root);
  const gen = '<rootDir>/' + path.relative(rootDir, p.genDir).split(path.sep).join('/');
  return { ...config,
    moduleNameMapper: { [`^${esc(p.sdk.slotPackage)}/([A-Za-z0-9_]+)$`]: `${gen}/$1.jsx`, ...config.moduleNameMapper },   // applies to requires from node_modules [V]
    transformIgnorePatterns: config.transformIgnorePatterns ?? [`/node_modules/(?!(${p.packages.map(esc).join('|')})/)`] };   // ESM SDK on Node < 24.9 [V]
}
```

The universal tier also works in Jest with no mapper, because jest-resolve follows realpaths [V]. ts-jest is not a gate: it has no TS 7 support and forces Node10 resolution [V]. Use babel-jest or @swc/jest.

### 7.6 Metro (React Native / Expo)

```js
// metro.config.js:  module.exports = withStuntDouble(getDefaultConfig(__dirname))
function withStuntDouble(config, opts = {}) {
  const p = generate({ root: opts.root ?? config.projectRoot, ...opts, onError: 'throw' });   // a throw fails the bundle [V]
  const prev = config.resolver?.resolveRequest;
  return { ...config, resolver: { ...config.resolver,
    resolveRequest(ctx, name, platform) {
      const s = name.startsWith(p.sdk.slotPackage + '/') && name.slice(p.sdk.slotPackage.length + 1);
      if (s && p.slots.includes(s)) return { type: 'sourceFile', filePath: p.shimFile(s) };
      return (prev ?? ctx.resolveRequest)(ctx, name, platform);
    } } };
}
```

F5 is runtime-only natively in Metro [V], so release builds chain `stunt-double check`. The Expo wrapper is [U].

### 7.7 Parcel 2, Bun 1.4, Farm, and unknown or future bundlers

| Tool | Setup | Notes |
|---|---|---|
| **Parcel 2** | Universal tier plus `"@parcel/resolver-default": { "packageExports": true }` [V]. Optional resolver plugin `stunt-double/parcel` (`loadConfig` runs `generate`, and a throw fails `parcel build` [V]; `invalidateOnFileCreate` on the overrides dir). Scripts: `stunt-double check && parcel build` | A root `alias` with a typo'd key is silently ignored [V], so stunt-double never uses Parcel `alias`. `rsc:auto` keeps directives off (R5). |
| **Bun** | Bundler: `Bun.build({ plugins: [stuntDoubleBun()] })`; `onResolve` sees bare specifiers there [V]. Runtime and `bun test`: tsconfig `paths` or the `workspace:*` link [V]. Never a runtime `onResolve` plugin: it never sees bare specifiers [V]. Scripts: `stunt-double check && bun build …` | The `bun build` CLI cannot load plugins; use a script [V]. |
| **Farm** | Universal tier; the Vite plugin through Farm's Vite compatibility [U] | |
| **Unknown bundler** | Universal tier: the link, `stunt-double check && <build>`, tsconfig `paths` | Needs only standard `exports` resolution, realpath symlinks (or PnP), and a JS parser for `.jsx`. If it ignores the link, it fails on the placeholder: fail-closed. |

### 7.8 Guarantees: universal tier vs adapter tier

| Guarantee | Adapter (T1) | Universal + `stunt-double check &&` chain | Universal, bare tool |
|---|---|---|---|
| Default eliminated when not wrapped | yes [V] | yes [V] | yes [V] |
| Applied in app **and** SDK internals | yes [V] | yes [V] | yes [V] |
| Wrap without a cycle | yes | yes | yes |
| Unwired tool or graph fails (F6b) | yes | yes | **yes** (placeholder) [S] |
| F3 required slot missing | yes | yes | **yes** (RES) [V] |
| F5 wrong export | yes | yes | native except the Bun bundler and Metro [V] |
| F1 / F9c contract | build-time (or `next build`) | yes | only if the tool type-checks (Next, CRA) |
| F2, F4, F7, F6a, F6f, F6g, F8 (static) | yes | yes | **no** (R1) |
| F6c externalized graphs | config error | loud at boot or test | loud at boot or test |
| F6d pre-bundler | prevented + tripwire | prevented (`.jsx`) | prevented (`.jsx`) |
| F6h staleness | regenerated every start | regenerated | previous decision; tsc probes |
| Bundle-level F6/F8 audit | yes | no | no |
| Dev overlay for stunt-double errors | yes (Vite push + poison) | poison via `stunt-double watch -- <dev>` | no |

The practical rule that follows: **use the adapter for every tool that has one**, and prefix `stunt-double check &&` for every tool that doesn't.

---

## 8. Developer experience

### 8.1 The CLI

| Command | Purpose |
|---|---|
| `stunt-double gen [--poison] [--no-fail]` | STA + write artifacts (no type check). Exits 1 on problems unless `--no-fail` |
| `stunt-double check` | STA + TYP (the CI gate and the T0 chain). Exits 1 on any problem |
| `stunt-double watch -- <cmd>` | Generate, watch the overrides and config (60 ms debounce, only changed bytes written), spawn `<cmd>`, forward its exit code; poison shims on errors |
| `stunt-double ls` / `stunt-double why Button` | Slot table: required, kind, effective implementation, contract JSDoc. `why` prints the chain, e.g. `EFFECTIVE src/overrides/Button.tsx → wraps @acme/core/original/Button` |
| `stunt-double eject Button [--wrap \| --replace]` | Writes a typed starter (§4.3). For a *required* slot the template references `TODO_implement_Logo`, so it fails the gate instead of rendering null |
| `stunt-double doctor` | Everything above, plus: tsconfig really includes the check file (`tsc --listFilesOnly`), adapter present in each detected tool config, scripts chained for adapter-less tools, PnP + TS 7, package-manager link form, `preserveSymlinks` off, no `.vite/deps` region from the project |
| `stunt-double init` | Detects the package manager and tools; writes the dependency line, stub, `.gitignore`, tsconfig `paths` + `files`, `postinstall`, and adapter lines into vite / next / webpack / jest / vitest configs (prints the rest) |
| `stunt-double sdk-lint <dist>` / `stunt-double slotify` | SDK publish gate (§3.6) / degraded path (§11) |

### 8.2 HMR

- **Adding or removing an override** changes one shim's content. Vite reloads in 155–320 ms with 0–1 full reloads; Turbopack takes 0.5–1.4 s; Next webpack dev takes 0.6–8 s [V].
- **Edits inside an override** are ordinary Fast Refresh edits [V].
- **No resolution decision ever changes:** the alias is static, so no tool needs invalidation logic.
- **webpack-dev-server** regenerates on `watchRun` [U].

### 8.3 Errors

There are three channels, carrying the same text:

1. **Start or build:** `this.error`, `compilation.errors`, esbuild `errors`, or a config-load throw.
2. **Dev:** poisoned shims, such as `import './STUNT-DOUBLE-ERROR -- [F2] src overrides Buton.tsx …'`, show in each dev server's own overlay or 500 page [V]. The Vite adapter also pushes a proper overlay [V].
3. **Types:** IDE squiggles on the labelled assertion.

### 8.4 Discoverability

- `ls src/overrides` shows what is customized; `stunt-double ls` shows what *can* be.
- The config's `$schema` autocompletes slot names [U].
- The contracts carry JSDoc.

---

## 9. SSR, React Server Components, duplicate instances

**One file per slot, one table, every graph.** The RSC graph, SSR graph, browser graph, Vitest, Jest and Node all resolve the same shim. There are no export conditions anywhere. Turbopack honours only `browser` conditions and silently ignores others, which caused SSR/browser splits [V].

- Observed: prerendered HTML and client chunks carry the same override [V].
- Vite client and SSR strings match [V].
- Next hydration warnings are checked in the prototype [U].

**`"use client"`.**

- Client-slot shims carry the directive, so a hooks-using override needs none, even when a Server Component imports the slot through the barrel [V].
- Without the directive, Next fails natively ("importing a module that depends on `useState`/`createContext` into a React Server Component") [V].
- Async overrides fail `notAsync` (F9c) [V].
- `server-only` in a client slot fails statically (F9b) and natively in Next [V].
- `kind:"server"` slots get no directive and no `notAsync`; their contract may return `Promise<ReactNode>` [U].

**Externalized graphs.**

- Adapters force `ssr.noExternal`, Vitest `server.deps.inline` and Next `transpilePackages` for the SDK and layers, and refuse configurations that undo them (F6c).
- Without an adapter, an externalized SDK fails loudly. Node either loads the placeholder poison [S] or refuses `.jsx` [V]. It never renders defaults.

**Duplicates (F8).**

- Install-level realpath equality from every vantage point: app, SDK, slots dir, layers, override dirs [V].
- Bundle-level root audit [V].
- `resolve.dedupe` (Vite) and Rsbuild `resolve.dedupe` [V].
- The slot package has **no** dependencies or peers, so it can never pull its own React or SDK, and PnP never virtualizes it [V].
- Next's App Router vendors React (which hides duplicate React) but not the SDK, so the SDK is always in the singleton set [V].

**Project-module duplication** (an override sees `NO_PROVIDER`) is prevented in Vite dev, because `.jsx` shims are never inlined into the pre-bundle [V]. It is caught under PnP (F8b) [V].

---

## 10. Defence in depth

Each layer below catches what the one before it cannot.

1. **Construction** (cannot happen):
   - no SDK path to defaults (fail-closed);
   - `.jsx` shims (no pre-bundle freezing);
   - decision in file content (no stale caches);
   - generated `"use client"`;
   - no conditional resolution (no SSR/client split);
   - `original/*` is never a socket (no wrapper cycles);
   - the slot package has no deps (no virtual copies or extra React).
2. **RES** (no stunt-double code): placeholder poison for unwired tools and graphs; a missing shim for F3 and new required slots; native MISSING_EXPORT for F5.
3. **STA at every adapter start**, plus postinstall and CLI: F2, F3, F4, F5, F6a, F6f, F6g, F7, W7, F8, F9b, L1, L2.
4. **CFG:** SSR / Vitest / optimizer guards, X1, X2, X3.
5. **TYP:** contracts for every implementation in every chain, plus the ABI pin, slot set and staleness probes.
6. **AUD:** the final graph is checked against the table. It catches user aliases, resolver order, copies and bundle-level duplicates.
7. **CI recipe** (every project):

   ```
   npm ci                      # postinstall: stunt-double gen --no-fail
   npx stunt-double check      # STA + TYP (fails on anything)
   npm run typecheck           # the project's own tsc: includes src/stunt-double.check.ts
   npm run build               # adapter re-runs STA + TYP + AUD inside the tool
   npm test
   ```

---

## 11. Degraded path: the SDK cannot be changed

**Case:** a precompiled package whose siblings import each other relatively (`import { Button } from './Button.js'`), with no sockets and no manifest.

**1. Preferred: `stunt-double slotify` through the package manager's own patch flow.** This keeps the fail-closed, zero-bundler-code topology [V on pnpm 12 and Yarn 4 PnP].

```bash
pnpm patch @vendor/ui --edit-dir .slotify --ignore-existing
npx stunt-double slotify .slotify --config slotify.json   # rewrites relative slot edges -> '@vendor/ui-slots/<Slot>', adds exports './original/*',
                                                          # derives contracts from the ORIGINAL .d.ts (relative import), writes slot-manifest.json
                                                          # { slotified: true, version }, refuses namespace/default imports of slot files
pnpm patch-commit .slotify
```

```yaml
# pnpm-workspace.yaml (Yarn: same key in .yarnrc.yml). pnpm AND Yarn ignore peer changes inside a patch [V]
packageExtensions:
  '@vendor/ui': { peerDependencies: { '@vendor/ui-slots': '*' } }
```

- **Project config:** `slotify.json` maps each slot to its file, types and export. The project links `@vendor/ui-slots` as in §4.4.
- **Drift:** a name-keyed patch applied cleanly to vendor 1.1.0 but missed a new relative edge [V]. The generator checks `installed version == slotified version` and re-runs the F6 dist scan on every start, which caught it [V].
- **Other package managers:** npm uses `patch-package`, Bun uses `bun patch` [U].

**2. Fallback: adapter redirect mode (`"relativeEdges": "redirect"`). This tier is fail-open but audited.** Adapters redirect SDK-internal edges whose resolved file is a manifest default to that slot's shim:

- Vite / Rolldown / Rollup: `resolveId` with `this.resolve(…, {skipSelf:true})`, plus an optimizer externalizer in dev [V];
- webpack / Rspack: `nmf.hooks.beforeResolve` [V];
- esbuild: `onResolve` for relative paths from the SDK root [V];
- Turbopack: a `turbopack.rules` loader that rewrites the SDK dist's relative imports [V];
- Jest: an issuer-aware resolver [V];
- Metro: `resolveRequest` [U];
- Bun: `onLoad` [V].

The audit is mandatory here. Tools without an adapter would render defaults, so redirect mode is documented as "not universal".

**3. Types.** TypeScript cannot remap relative `.d.ts` imports [V]. The project writes `SlotProps = { Button: ComponentProps<typeof import('@vendor/ui').Button> }`, and the same check file applies.

**4. A single-file bundled SDK cannot be injected at module level.** stunt-double says so, and the fallback is a runtime provider, which is out of scope.

---

## 12. Rollout and migration

1. **SDK major release** (one time):
   - sockets for internal imports (a codemod);
   - `original/*` exports, `contracts`, the manifest, the schema, the required peer;
   - `sdk-lint` in publish CI;
   - publish the `@acme/core-slots` placeholder (non-prerelease version).

   The changelog says: run `npx stunt-double init`.
2. **Adopt in each app, with no behaviour change:** `npm i @acme/core@1 && npm i -D stunt-double && npx stunt-double init`, then commit. With zero overrides every shim re-exports `original/*`, so output is identical. Run `stunt-double doctor` once and fix any F8 or wiring findings.
3. **Move existing customizations.** For each app-level wrapper or monkey patch, run `stunt-double eject X --wrap`, move the code in, and delete the old wrapper and any `resolve.alias` hacks. The F6g bypass rule and the audit flag stragglers. SDK-internal positions now get the customization too.
4. **CI:** use the §10 recipe. Make `stunt-double check` a required status check.
5. **SDK upgrades:** bump the SDK, then run `stunt-double check`.
   - Renames and removals produce F2 with exact instructions.
   - New required slots produce F3.
   - Contract changes produce F1 in the check file, naming the property.
   - The ABI pin catches a forgotten regeneration.
6. **Monorepos:**
   - pnpm and Yarn give each app its own SDK instance keyed by peers [V].
   - In npm workspaces with several apps, use adapter-only wiring per app (no link). Unwired tools then fail on the placeholder instead of picking up another app's overrides [V for the hazard].
7. **Governance:** CODEOWNERS on `src/overrides/` and `stunt-double.config.json`. `ignoresProps` opt-outs are explicit and reviewable.

---

## 13. Alternatives considered

Four complete designs were built and run against the same fixtures by independent agents, then re-tested by two judges: one for robustness, one for developer experience. Both ranked the "typed manifest + generated shims + one static alias" design first, and stunt-double is that design with the best parts of the others grafted on. Two further families were ruled out on the north star alone. Every candidate was measured against the same question: **can an injection mistake reach runtime, or can an override silently not apply?**

The full record, including every graft and every evidence conflict, is in [DECISIONS.md](DECISIONS.md).

### 13.1 Runtime context / provider DI (MUI-style `slots` props, a React context registry)

**How it injects.** SDK components look up the implementation at render time: from a `slots` / `components` prop, or from a context provider the app mounts near the root.

**Why it lost.** This is Swinject moved into React, so it fails the north star by design. The following points are design reasoning; this family was not lab-tested.

- The decision is made while rendering, so a missing, misspelled or wrong registration surfaces only when the component renders.
- A component rendered outside the provider, such as in a test or a second React root, silently gets the SDK default.
- The default must stay reachable as the runtime fallback, so a replaced component cannot be eliminated from the bundle.
- The type system sees what each call site passes. It does not see whether the project's registry is complete, or whether every SDK-internal position receives the override.

**What survived.** Nothing as a primary mechanism. It remains the only option for a single-file bundled SDK, which cannot be injected at module level (§11, out of scope).

### 13.2 Resolver-level shadowing, in the style of Docusaurus swizzle and Gatsby shadowing (design A, "slot-shadow")

**How it injects.** The SDK imports `@acme/core/slots/X`. Per-bundler resolver adapters redirect that import to the project's file when one exists, using a pure core. An optional generated universal package covers tools without an adapter.

**What the prior art taught.** Design A read the Docusaurus 3.10.2 and Gatsby 5.16.1 sources.

- Docusaurus has no declared slot list. Every file becomes an alias, so a typo'd swizzle silently creates an alias that nothing imports (a silent F2).
- Docusaurus declares `@theme-original/*` as untyped `any`, and nothing asserts that a swizzled file implements `Props`, so there is no F1.
- Gatsby's shadow paths mirror the theme's private file layout, so a theme refactor silently orphans shadows (a silent F2 on upgrade).
- Both work through webpack only and do no validation.

Design A fixed the validation and typing gaps with a declared manifest. It kept the stable public specifiers with an original escape hatch and the eject / wrap CLI.

**Why it lost.** It is **fail-open**: a tool without an adapter falls through to the default.

- In the judge's re-test, the Vite optimizer inlined the override and `theme.tsx` into `.vite/deps` with no warning.
- A transitive F7 built with exit 0 and then ran out of memory.
- F1 was opt-in in Vite and absent from webpack.
- A stale universal package got past the staleness probe.
- The two tiers could disagree.
- Its sync-function-shape contract falsely rejected `memo`, `FC` and `forwardRef`.
- Resolver hooks are missing exactly where they are needed: Turbopack has no resolver API, Rspack ignores `resolve.plugins`, and Bun runtime plugins never see bare specifiers [V].
- About 900 lines across 8 adapter families, mostly unbuilt.

**What survived.** The post-bundle graph audit, the config-time SSR / Vitest / optimizer guards, `renamedFrom` / `removedSlots`, brand layers, `cache.version` fingerprinting, resolving `tsc` by package name, `stunt-double why`, and resolver redirect as the audited degraded fallback (§11).

### 13.3 Generated peer package with an optional plugin (design D, "Slot Packages")

**How it injects.** The SDK imports `@acme/core-slots/X`. A generator writes `.jsx` entries into a project-owned package, and an optional Vite plugin adds dev conveniences.

**Its key finding.** Vite's optimizer externalizes `.jsx`/`.tsx`. The `.jsx` layout passed 10 of 10 browser phases, while a `.js` control failed 7 of 10.

**Why it lost.** The gate lived outside the tools.

- If the generator was bypassed, a bare `vite build` after adding an override exited 0 and shipped the SDK default.
- Transitive F7 was missed.
- Its *optional* peer becomes a runtime throw in Vite dev (`__vite-optional-peer-dep`, HTTP 200, no overlay) [V].
- Its `ClientSlot` contract still rejected `React.FC` and children-returning components.

**What survived.** Most of its topology: `.jsx` entries, the committed stub with `./*` exports, the wiring self-test, the ABI pin, `postinstall … --no-fail`, `optimizeDeps.include` of originals, the per-package-manager link table, and `watch -- <cmd>`. stunt-double is essentially D's package with the gate moved into each tool's config and C's required peer and placeholder added.

### 13.4 AST / import rewriting (a Babel or SWC transform, or a loader, that rewrites specifiers)

**How it injects.** A transform rewrites `import { Button } from './Button.js'` (inside the SDK) or `from '@acme/core'` (inside the app) to point at the override.

**Why it lost.** It has the same fail-open shape as resolver shadowing.

- A rewrite only applies in graphs where the transform runs, and must run over the SDK's compiled code in `node_modules`. Each graph that skips it silently renders the default.
- Vite 8's dependency optimizer pre-bundles SDK internals into `.vite/deps`, outside the normal plugin pipeline, so a `resolveId` plugin never sees the slot import in the client graph unless it is re-registered inside the optimizer [V].
- Issuer-blind rewriting over-reaches: a Jest regex mapper for `./Button.js` would rewrite every `./Button.js` in the whole project [V].
- Turbopack offers only `turbopack.rules` loaders [V].
- Rewriting only the app's own imports never reaches SDK-internal positions such as the `Button` inside `Dialog` (design reasoning).

**What survived.** Rewriting *once*, ahead of time, through the package manager's patch flow (`stunt-double slotify`, §11). That turns a legacy SDK into a socket SDK and keeps the fail-closed topology [V on pnpm 12 and Yarn 4 PnP]. Per-tool redirect also survives as the fail-open-but-audited `"relativeEdges": "redirect"` fallback.

### 13.5 Committed per-slot plugs (design C, "risk-first")

**How it injects.** The SDK imports a required-peer socket package. The project commits one `.tsx` plug per slot in `src/sdk-slots/`, and a single gate script checks them.

**Why it lost.**

- Its gate missed an SDK file that imported a default relatively: "impossible by construction" was not enforced on the consumer side (judge re-test).
- F1, F2, F4, F7 and F8 were caught only by the gate script, so a raw build skipped them.
- False F1 on `memo` / `FC`.
- One committed file per slot is churn, and every SDK minor that adds a slot breaks builds until `sync`.

**What survived.** The required peer plus registry placeholder, the F6 bypass rule, PnP `__virtual__` and npm-hoisted cross-app detection, slotify through package-manager patches plus `packageExtensions`, and the `satisfies` slot set.

### 13.6 The spine: typed manifest + generated shims + one static alias (design B)

**Why it won.** It was the only design that put the gate **inside the tool's own configuration**, so a raw production command cannot skip it, while also making the SDK specifier **fail-closed**. The robustness judge reproduced a bare `vite build` failing on F1 (`contract type check failed (tsc 7.0.2, 154 ms)`), on an orphan file (F2), on an unwired config, on an SDK relative edge (F6), and on a transitive F7.

**What stunt-double changed.**

- A socket package replaced the types-only `@acme/core/slots/*` subpath, which gives a self-explaining unwired error.
- The peer is required rather than optional.
- A convention directory plus a JSON `map` replaced the TypeScript manifest. That removed the two-edits-per-override friction and the dependency on Node 22.18+ type stripping.
- The contract shape was replaced with one that has no false positives on `FC`, `memo` or `forwardRef`.
- The Vite helper became a real plugin.
- Yarn PnP + TS 7 is now refused explicitly.
- The shims moved to the root `sdk-slots/gen`.
- The static scans now always run.
- A real-parser F7 walk was added.

### 13.7 Also rejected

- **tsconfig `paths` as the runtime mechanism.** Next, Rspack, esbuild and Vite apply `paths` only to project files, so runtime and types split. `paths` is used only for types, pointing at the same shims. Bun is the exception, and benefits.
- **Export conditions / `#imports` tiers.** A missing condition silently falls back, and Metro rejects non-relative targets.
- **Virtual modules** for Vite dev. Real `.jsx` files achieve the same and work in every other tool.
- **Optional peer.** Runtime throw in Vite dev.
- **fork-ts-checker** (fails open with TS 7), **ts-jest as a gate** (no TS 7, forces Node10 resolution), **unplugin's esbuild adapter** (drops errors, duplicates overrides), **webpack `afterResolve` replacement** (wrong loaders), **Turbopack absolute or conditional aliases** (silently ignored).
- **SDK-side postinstall codegen.** Blocked by pnpm 12, Yarn 4 and Bun.

---

## 14. Known limitations

These are the cells where a mistake can still end in a runtime crash or a silent wrong result, followed by how each is closed or contained. None of them is "every override disappears at once" or "an unwired tool silently renders defaults". Both of those are resolution failures in every tier [S].

| | Limitation | Why it remains | How it is closed or contained |
|---|---|---|---|
| **R1** | **Universal tier, bare tool, no `stunt-double check &&` prefix.** F1, F2, F4, F5 (Bun/Metro), F6a, F6f, F6g, F7 and F8 go undetected, and stale shims render the previous decision. | Without an adapter or the chained CLI, no stunt-double code runs. | (1) Use the adapter for every tool that has one: the Vite family, the webpack family, Next, Jest, esbuild, Rolldown/Rollup, Metro. A bare `vite build` / `webpack` / `jest` / `next build` then **cannot** skip the gate, because the gate lives in the config [V]. (2) The root `postinstall` regenerates [V]. (3) CI runs `stunt-double check` [V]. (4) `tsc` catches staleness (TS2578, ABI) and F1, F5 [V]. |
| **R2** | A third-party or unlinted SDK that imports a default relatively, consumed through a bare T0 tool. | Package resolution never sees `./original/Button.js`. | The SDK publish gate `stunt-double sdk-lint` [V]. Every adapter or CLI run scans the installed dist [V]. |
| **R3** | Dev servers do not block on F1: `next dev`, Vitest, Jest and webpack-dev-server. The Vite overlay is asynchronous. | Blocking dev on types would make the dev loop unusable. | The production build command and CI fail [V]. The IDE shows the error on the exact line in `src/stunt-double.check.ts`. |
| **R4** | F7 through a third-party package, or through a computed `import(expr)`. | The walk stops at `node_modules` and at non-literal specifiers. | Add the package to `scanPackages`. A third-party UI kit importing the company SDK's slot is rare and will show up in code review. |
| **R5** | Parcel 2.16.4 with `"use client"` modules (target `context:"node"`) splits them into bundles with a second React copy, which crashes at runtime [V]. | Parcel behaviour; the SDK's own directives cause it too. | `rsc:"auto"` emits no directives unless Next or an RSC runtime is installed. AUD warns. Open question for browser targets. |
| **R6** | An override that is type-correct but behaves wrongly, or an explicit `ignoresProps` opt-out. | Semantics are not checkable. | Opt-outs live in `stunt-double.config.json` under CODEOWNERS. |
| **R7** | Vite dev, universal tier only, cold cache: the first load re-optimizes once. A transient `useContext` null appears, then Vite reloads itself [V]. | Late discovery of `@acme/core/original/*`. | The adapter puts every original into `optimizeDeps.include`: 0 reloads [V]. |

Smaller gaps stated elsewhere in this document:

- `notAsync` cannot flag an async body hidden behind a `React.FC` annotation (§6.2).
- W7 (consumer cycle) is a warning, not an error.
- A single-file bundled SDK cannot be injected at module level (§11).
- Every claim tagged [U] is unverified until the reference implementation's acceptance tests cover it. The untested areas (Windows, multiple SDKs with slots in one app, `kind:"server"` contracts, the Turbopack alias into a root-level `sdk-slots/` directory, and more) are listed as open questions in [DECISIONS.md](DECISIONS.md#open-questions).
