# stunt-double: decision record

This record explains why stunt-double looks the way it does: which designs competed, which one became the spine, what was grafted onto it from the others, what was rejected outright, and which questions are still open. The design itself is in [DESIGN.md](DESIGN.md).

**How the decision was made.** Four complete designs (A–D) were written and prototyped independently against the same fixtures: an SDK with `Button`, `Logo`, `Card`, `Dialog` and `Toolbar`, an app with its own theme context, and a negative fixture for each mistake. Two judges then re-ran the prototypes. The robustness judge tried to make each design reach runtime or silently skip an override. The DX judge evaluated the day-to-day workflow and re-tested the type contracts. Lab IDs in parentheses (V2g, U8, …) refer to the design round's lab notebooks, which are not part of this repository. Evidence tags [V] / [S] / [U] mean the same as in [DESIGN.md §1.6](DESIGN.md#16-evidence-tags-used-throughout).

The yardstick for every decision was the north star: **build failures rather than runtime failures.** An injection mistake must fail the production build command or CI, or show in the dev overlay. It must never crash at runtime, and it must never silently render the SDK default.

---

## 1. Approaches considered

| | Approach | Core idea | Main strengths | Fatal or major weaknesses found |
|---|---|---|---|---|
| A | Resolver-level shadowing ("slot-shadow", in the style of Docusaurus swizzle / Gatsby shadowing) | The SDK imports `@acme/core/slots/X`. Per-bundler resolver adapters redirect using a pure core. Optional generated universal package. Brand layers. | Deepest per-tool machinery: graph audit, SSR/Vitest/optimizer config guards, `renamedFrom` hints, layers, redirect mode for relative SDKs. Vite dev proven in Chromium. | **Fail-open.** A tool without an adapter falls through to a `.js` universal package. The Vite optimizer then inlined the override and `theme.tsx` into `.vite/deps` with no warning (judge re-test). Transitive F7 builds with exit 0 and OOMs. F1 is opt-in in Vite and absent from webpack. The two tiers can disagree. ~900 LOC across 8 adapter families, mostly unbuilt. Its sync-function-shape contract falsely rejects `memo`/`FC`/`forwardRef`. |
| B | Typed manifest + generated shims + one static alias + fail-closed SDK slot exports | The SDK's `./slots/*` export is types-only. The project's `acme.overrides.ts` (`satisfies Overrides`) is turned into `.jsx` shims. One static wildcard alias per tool. Helpers run the generator and the type gate **at config load**. | A bare `vite build` / webpack / jest / next fails on F1, F2, F6a, F7 and unwired tools (judge re-test). Decision in file content: caches and HMR are free. The only contract shape with no false positives on `FC`/`memo`/`forwardRef`. Poisoned-shim dev channel. `verify` via source maps. | Two edits per override and a strict orphan rule. Depends on Node ≥22.18 type stripping and child-process re-evaluation for the TS manifest. The unwired error was generic ("not exported under the conditions…"). The Yarn PnP + TS 7 evidence was vacuous: the gate fails on a clean tree. "Minor version" rollout claim is wrong: unadopted consumers break. |
| C | Fail-closed sockets + committed `.tsx` plugs ("risk-first") | The SDK imports a **required-peer** socket package. The project commits one `.tsx` plug per slot in `src/sdk-slots/`. One gate script. | Simplest mental model. No generator staleness. A required peer avoids Vite's optional-peer runtime throw. Placeholder idea. `satisfies Record<SlotName>`. PnP `__virtual__` and npm-hoisted cross-app detection. slotify via PM patches. | Its gate missed an SDK file importing a default relatively ("impossible by construction" is not enforced consumer-side; judge re-test). Gate-only for F1/F2/F4/F7/F8; presets unbuilt. False F1 on `memo`/`FC`. One committed file per slot, and every SDK minor that adds a slot breaks builds until `sync`. |
| D | Generated peer package (`.sdk-slots`) with `.jsx` entries + optional plugin ("Slot Packages") | Package-level injection: the SDK imports `@acme/core-slots/X`. The generator writes `gen/*.jsx`. Optional Vite plugin. | The key `.jsx` finding: Vite's optimizer externalizes `.jsx`/`.tsx` (10/10 browser phases vs 7/10 failures with `.js`). Wiring self-test. ABI pin. `.d.ts.map` go-to-definition. Multi-vantage F8 preflight. Poison channel. | A bare `vite build` after adding an override exits 0 with the SDK default (generator bypassed). Transitive F7 missed. The optional peer gives a runtime throw in Vite dev. Its `ClientSlot` contract still rejects `React.FC` and children-returning components. |

Two further families were ruled out without a full prototype, because they fail the north star by construction: **runtime context / provider DI** (MUI-style `slots` props, a React context registry) and **AST / import rewriting** as the primary mechanism. The reasoning, and what survived of each, is in [DESIGN.md §13](DESIGN.md#13-alternatives-considered).

Both judges ranked **B first**:

- robustness judge: B > C > A > D;
- DX judge: B > C > D > A.

---

## 2. Decision: B is the spine

The north star is "build failures, not runtime failures". Only B combined two properties:

1. It put the gate **inside the tool's own configuration**, so a raw production command cannot skip it.
2. It made the SDK specifier **fail-closed**, so a tool nobody wired cannot silently render defaults.

The robustness judge reproduced B's bare `vite build` failing on:

- F1 (`contract type check failed (tsc 7.0.2, 154 ms)`);
- an orphan file (F2);
- an unwired config;
- an SDK relative edge (F6);
- a transitive F7.

B's other structural choices are also kept:

- generated `.jsx` shims behind one static alias, so the decision lives in file content and caches and HMR need no invalidation;
- the poisoned relative-specifier dev channel;
- the strict-independent `accepts` assertion.

---

## 3. What changed relative to B, and why

1. **Socket package instead of the types-only `@acme/core/slots/*` subpath** (from C, D, and the DX judge).
   - The SDK imports `@acme/core-slots/X` (a required peer, range `*`). The adapter alias and the universal-tier link both target `@acme/core-slots/*`.
   - Reasons: one specifier family instead of two (B needed a forwarder for its tier 0 anyway), and a **self-explaining** unwired error.
   - Verified during synthesis: a registry placeholder whose `exports ./*` lead to a module with a poisoned relative import fails with the fix text in:
     - `vite build`: `[UNRESOLVED_IMPORT]`, exit 1;
     - Vite dev: optimizer error, process exits;
     - webpack 5.111.1: Module not found;
     - esbuild 0.28.2: Could not resolve;
     - Node SSR: `ERR_MODULE_NOT_FOUND` naming the file.
   - With the alias, all three bundlers rendered the override app-level and inside the SDK.
   - Vite dev with the alias and **no plugin** kept `/sdk-slots/gen/Button.jsx` external, with 0 project modules in `.vite/deps`.
   - The SSR graph that externalized the SDK failed with the placeholder message, not a default render.
2. **Required peer, not optional.** Evidence (C): Vite converts a missing optional peer into a `__vite-optional-peer-dep` stub that throws at runtime in dev (HTTP 200, no overlay). Discovered while synthesizing: the placeholder must be a **non-prerelease** version, because node-semver's `*` does not match `0.0.0-placeholder` (verified), so npm's auto-install would fail with ETARGET. The placeholder is marked by a `"stuntDouble": { "placeholder": true }` field instead.
3. **Convention directory plus an optional JSON `map` instead of the TS manifest.**
   - This removes the two-edit friction and the Node ≥22.18 type-stripping / child-process re-evaluation dependency.
   - The did-you-mean F2 and stray-file F2 are kept (`_`-prefixed helpers and `<Slot>/` subfolders allowed, per A and the robustness judge).
   - B's IDE autocomplete is kept cheaply: the SDK ships a JSON Schema (`stunt-double.schema.json`) whose `map` keys are the slot names [U].
4. **Contract shape:** the DX judge's verified combination. It passes `FC`, `memo`, `forwardRef`, classes and children-returning overrides, and fails extra-required, narrowed, fewer-props, async and wrong-ref overrides in TS 7.0.2 and 5.9.3 with strict on and off:
   - `JSXElementConstructor` component check;
   - `accepts` (object assignability over `ComponentProps`);
   - `declaresAll` (exhaustive keys, with `ignoresProps`);
   - non-distributive `notAsync`.

   Added from other designs:
   - D's ABI pin;
   - C's `satisfies Record<SlotName, unknown>`;
   - D's exported-type `@ts-expect-error` staleness probe (an exported type, so `noUnusedLocals` cannot mask it);
   - a named-import wiring line (TS2305 when the placeholder is resolved).
5. **Vite integration** is a real plugin (A's hooks), not B's config fragment, so it can:
   - push overlays, watch in-process and run the audit;
   - be default-on in build (fixing A's opt-in flaw);
   - run the gate in `buildStart`, memoized across client and SSR environments.

   Belt and braces against pre-bundling: `.jsx` (D), `optimizeDeps.exclude` of the socket package (C), `rolldownOptions.external` (B), and an optimizer tripwire (A, lab V2g). `include` of every original removes the cold re-optimization reload (lab V2d / D).
6. **Yarn PnP:** detect it and require TS 5.x for the gate with an explicit `[TS-PNP]` message. TS 7.0.2 fails every clean PnP build (judge re-test). The stub carries **no peers**, per C: peers cause `__virtual__` copies that duplicate project modules, which D's probe missed.
7. **Shim directory moved from B's `src/__acme__/slots` to the root `sdk-slots/gen`.** One directory serves as both the alias target and the linkable package (stub `package.json` committed, `gen/` gitignored, per D), and it stays out of dot-directories. Only the check file lives under `src/` (`src/stunt-double.check.ts`), for CRA. This location is [U] for Turbopack aliases; the acceptance tests cover it.
8. **Always-on static scans** (robustness judge):
   - the installed-SDK dist scan for relative or `original/*` edges into defaults (A/B/D; C ran it only for slotified SDKs);
   - the wiring self-test (D, extended with C's placeholder, copy, cross-app and `__virtual__` cases);
   - the multi-vantage F8 preflight (D/C).
9. **Transitive F7 walk with real parsing** (oxc-parser 0.153.0) and tsconfig-paths-aware resolution (oxc-resolver 11.24.2). This replaces B's regex scanner and D's file-local check. Verified: it catches the namespace and named barrel routes through an `@/components` alias in 2–3 ms. New W7 warning for consumer cycles, using a manifest `consumers` list computed by `sdk-lint`. No design covered this.

---

## 4. Grafted from the other designs

- **From A:**
  - config-time guards: SSR/Vitest externalization and the Vitest optimizer (Vitest env `__vitest__`);
  - the post-bundle graph audit, rewritten to work without resolveId bookkeeping: default-file importers, a socket-consumers-in-graph-without-shim check, and singleton roots;
  - `renamedFrom` / `removedSlots`;
  - brand layers with explicit next-layer specifiers and contract checks for layer implementations;
  - redirect mode as the fail-open, audited degraded fallback;
  - `cache.version` fingerprinting;
  - resolving tsc by package name;
  - `stunt-double why`.
- **From C:**
  - required peer plus placeholder;
  - the F6 bypass rule (`original/*` imported outside overrides);
  - PnP `__virtual__` and npm-hoisted cross-app detection;
  - slotify through `pnpm patch` / `yarn patch` + `packageExtensions`, with drift detection;
  - `satisfies` slot set.
- **From D:**
  - `.jsx` entries;
  - the committed stub with `./*` wildcard exports;
  - the wiring self-test;
  - the ABI pin;
  - `postinstall … --no-fail`;
  - `optimizeDeps.include` of originals;
  - per-package-manager link table;
  - `stunt-double watch -- <cmd>` for non-Vite dev servers.

---

## 5. Rejected

- **Resolver-level substitution as the primary mechanism (A).** Fail-open in every graph the adapter cannot see. Turbopack has no resolver API, Rspack ignores `resolve.plugins`, and Bun runtime plugins never see bare specifiers (lab). It is kept only as the degraded fallback.
- **Runtime context / provider DI.** The decision is made at render time, which is the failure mode the project exists to remove. Kept only as the out-of-scope answer for single-file bundled SDKs.
- **AST / import rewriting in every tool.** Fail-open in every graph the transform does not run in, starting with the Vite dev pre-bundle. Kept as one-time rewriting through package-manager patches (`slotify`) and as redirect mode.
- **tsconfig `paths` as the runtime mechanism.** Next, Rspack, esbuild and Vite apply paths only to project files, giving split-brain (lab W3-g/U8). `paths` is used only for **types**, pointing at the same shims. Bun is the exception and benefits.
- **Export conditions / `#imports` tiers.** A missing condition silently falls back, and Metro rejects non-relative targets (lab U8).
- **Virtual modules for the Vite dev indirection (A).** Real `.jsx` files achieve the same no-cache and externalization behaviour and also work for every other tool.
- **Committed per-slot plugs (C).** One file per slot is churn, and every SDK minor that adds a slot breaks builds until `sync`. Generated shims are regenerated at every adapter start, so in configured tools they cannot be stale.
- **Optional peer (A, B, D).** Runtime throw in Vite dev.
- **fork-ts-checker** (fails open with TS 7), **ts-jest as a gate** (no TS 7, forces Node10 resolution), **unplugin's esbuild adapter** (drops errors, duplicates overrides), **webpack `afterResolve` replacement** (wrong loaders), **Turbopack absolute or conditional aliases** (silently ignored).
- **SDK-side postinstall codegen.** Blocked by pnpm 12, Yarn 4 and Bun (lab U3).
- **B's source-map `verify` step.** Superseded by the in-adapter audit plus config-time externalization guards. It is still a possible add-on for adapter-less tools (see the open questions).

---

## 6. Evidence conflicts resolved

- B's claim "Yarn PnP: F1 gate failed via TS7" is vacuous. The clean tree fails the same way (TS2307). The design states TS 7 is unsupported under PnP and refuses it explicitly (`[TS-PNP]`).
- A's text says "Vite typecheck defaults on in build"; its prototype defaulted off. The final adapter is default-on.
- C's "no default path by construction" is only true if the SDK obeys. The consumer-side dist scan is mandatory, and `sdk-lint` is the publish gate.
- D's `ClientSlot` claimed to fix lab W6's false positive, but it still rejects `React.FC` and children-returning components (DX judge). Replaced.
- C's comparison table misstated B and D (restarts, silent fallbacks, `.js` control attributed to D). It was disregarded; the judges' re-runs are authoritative.
- A's, B's and C's "minor release" or "backward compatible" rollouts are wrong once a required socket exists: adopting slots is an SDK **major**.

---

## 7. Naming

- **Product name: stunt-double.** The metaphor is for the docs only: the SDK component is the lead actor, the project's override is its stunt double, and it must fit the costume (the props contract) or it doesn't get on set (the build fails). Code identifiers stay plain: slot, override, socket, shim, original, contract.
- **One npm package**, `stunt-double`, with the CLI bin of the same name and subpath exports per host: `stunt-double/core`, `/vite` (also the Rollup and Rolldown plugin), `/esbuild`, `/webpack` (webpack 5, Rspack 2, Rsbuild, Next `--webpack`, craco, Gatsby, Storybook `webpackFinal`), `/next`, `/jest`, `/metro`, `/parcel`, `/bun`.
- **Adapter functions:** `stuntDouble()` (Vite / Rollup / Rolldown), `stuntDoubleEsbuild()`, `withStuntDouble()` (webpack, Next, Jest and Metro, each in its own subpath), `stuntDoubleBun()`. Core API names stay generic (`generate`, `regenerate`, `runTypeGate`, `auditGraph`, …).
- **Project files:** `stunt-double.config.json` (or a `"stuntDouble"` key in `package.json`), the generated check file `src/stunt-double.check.ts`, overrides in `src/overrides/`, and the slot package in `sdk-slots/` (stub committed, `gen/` gitignored).
- **SDK-side names:** the manifest field `"stuntDouble"` holds the semver range of the tool; the placeholder is marked `"stuntDouble": { "placeholder": true }`; the socket package is named after the SDK (`@acme/core` → `@acme/core-slots`).
- **Messages** keep stable codes ([F1]–[F9], [W7], [STALE], [TS-PNP], [X1]…) under the header `stunt-double: N injection errors (<sdk>@<version>)`. The poison text is `STUNT-DOUBLE-NOT-WIRED -- … run npx stunt-double doctor`, with `/ : ? # " '` kept out of it, because Turbopack and other resolvers treat those as URL or path syntax [V].

---

## 8. Value slots (after the first milestone)

The north star is about *injection* mistakes, and an SDK injects more than components: analytics, API clients, formatters, feature configuration. Runtime DI containers such as InversifyJS or tsyringe register any type. The first milestone only checked components, so everything else still needed a runtime registry, which is exactly the failure mode this project removes.

**Decision: a fourth slot kind, `value`, on the same mechanism.** Sockets, shims, the alias, the placeholder, the dist scan, the audit and every adapter are kind-agnostic: a shim re-exports a binding, whatever it is. Only the contract changes: `SlotTypes['X']` (the whole type) instead of `SlotProps['X']` (props). Kinds a tool version does not know fail generation (`[SETUP]`), so an older stunt-double can never check a new kind against the wrong contract.

**Alternatives rejected:**
- *A separate "services" mechanism* (a generated registry object, or a provider). It would put the decision back at runtime, or add a second resolution path to verify in every tool.
- *Plain assignability as the contract.* It accepts a narrowed method parameter even under `strict`, and a narrowed function parameter with strict off (DESIGN §6.6). The check file adds `argsFit`, which compares argument tuples. That comparison is strict-independent, it was verified in TS 7.0.2 and 5.9.3 with strict on and off [S], and it has no false positives on fewer, optional, rest or generic parameters, class instances or constructors.
- *Forcing `strictFunctionTypes` in the gate's tsconfig.* It would still miss methods (they are bivariant by design), and it would type-check the override files under different rules than the app.

**Evidence:** the core unit tests (`value-slots.test.mjs`, real tsc, strict on and off) and the Vite suite's V1a–V7 scenarios. Those run on the fixture SDK's `formatPrice` (a function its checkout total calls) and `analytics` (a service object its ProductCard calls), under TypeScript 7 and 5.9, plus two scenarios in the universal tier.

---

## 9. The adapter build-out: what the real tools decided

Each adapter below was built against a real app and run through the whole shared mistake catalogue (`tests/<tool>.test.mjs`). Where the tool contradicted the original sketch, the tool won; these are the resulting decisions.

| Tool | Decision | Why (observed) |
|---|---|---|
| Next 16 | Run the contract gate in the adapter's config function at `phase-production-build`; X1 is no longer an error | The check file moved out of `src/`, so Next's own type check never sees it. Gating at config load also fails the build before anything compiles, for Turbopack and `--webpack` alike |
| Next 16 | One exact `./`-relative `turbopack.resolveAlias` per slot, into the root-level dot-directory `.stunt-double/gen` | Works in `next build` and `next dev` (live add / fix / remove / restore) [V]; an unknown socket falls through to the placeholder |
| webpack / Rspack | `watchRun` purges the overrides and shim *directories* from the input file system | Purging only changed shims left a stale "file missing" stat: a fixed mistake kept failing until restart [V] |
| webpack / Rspack / Rsbuild | `[F6]` when the SDK becomes an `ExternalModule` | SSR `externals` (webpack-node-externals, Rsbuild `output.externals`) would load the SDK natively at runtime |
| esbuild | A native plugin; sockets resolve as external once a build already failed | esbuild's CLI cannot load plugins; esbuild otherwise piles stale-shim resolve errors onto the report |
| Bun | A `Bun.build()` plugin with an `onEnd` audit of the metafile | Bun 1.4 writes esbuild's metafile format and a plugin can turn it on; runtime plugins still never see bare specifiers, so the runtime stays universal tier |
| Jest | An async config; the gate is opt-in | babel-jest / @swc/jest never type-check; the build or `stunt-double check` is the gate (R3) |
| Storybook | The Vite plugin, picked up from `vite.config.ts`; the report also goes to stderr verbatim | Storybook's logger word-wraps errors at 80 columns, splitting `[Fx]` lines |
| Parcel | A resolver from a one-line local `parcel-resolver-*.mjs`; the plugin object is built without `@parcel/plugin`; the app root is the working directory | Parcel rejects plugin packages with other names; strict package managers would not let stunt-double reach `@parcel/plugin`; Parcel tells plugins only the monorepo root |
| Yarn PnP | The gate's `tsc` child keeps `--require .pnp.cjs`; TypeScript 5.9 must be the project's own `typescript` | Without the hook `tsc` cannot be read from the zip cache. Yarn patches only the package named `typescript`, so the previously documented `typescript5` alias could never resolve under PnP |
| pnpm | A `file:` dependency on a slot-package *tarball* is an install, not a universal-tier link | Generation tried to write into the `.tgz` (found by the pnpm suite) |

---

## Open questions

These are to be settled by the reference implementation's acceptance tests.

- What does the type gate cost on a large real app, where overrides import much of the app graph (TS 7 vs TS 5.9)? Should the gate's program stop at override boundaries (for example, isolate overrides behind declaration-only imports) if it exceeds ~2 s?
- ~~Turbopack with the alias target in a root-level directory and Next dev picking up shim content changes.~~ **Answered:** exact `./`-relative aliases into the root-level dot-directory `.stunt-double/gen/` work in `next build` and `next dev` (next 16.4.0; `tests/next.test.mjs`, and add / fix / remove / restore an override live in `next dev` by hand).
- webpack-dev-server / Rspack dev server: regenerating shims in `watchRun` and purging the input file system. **Partly answered:** with `webpack --watch` (webpack 5.111.1), the new shim content is picked up, and a fixed mistake recovers once `watchRun` purges the overrides and shim directories (not only the changed shims). The shim rewrite triggers one extra compilation. Not yet run under webpack-dev-server or the Rspack dev server.
- Parcel 2.16.4 duplicated React across `'use client'` bundle splits for a node target. Does the same happen for browser targets with an RSC-annotated SDK, and should the Parcel adapter refuse SDK directives?
- Should the SDK ship a CJS `require` condition so Jest below Node 24.9 needs no `transformIgnorePatterns`, and is ts-jest (Node10 resolution) worth supporting via top-level `types`?
- Multiple SDKs with slots in one app (two socket packages, two slot dirs): is a single config with an `sdks` array enough, and how do cross-SDK slots interact?
- `kind:'server'` and `'shared'` slots: what exact contract allows async server components while keeping props serializable when an override is `'use client'`? This is designed but not prototyped.
- Should adapter-less tools get a post-build `stunt-double verify <outdir>` (source-map based: shipped default for a non-wrapping override, SDK left external in server output), or does the placeholder plus link make it redundant?
- Can TypeScript 7 (tsgo) Yarn PnP support, and the tsgo LSP's go-to-definition through tsconfig `paths` into generated `.d.ts`, be relied on in later 7.x releases?
- Windows: realpath/junction behaviour of npm `file:` links, recursive `fs.watch`, alias regex path separators, and case-insensitive F2/F4 scanning are all untested.
- npm workspaces with several apps: is adapter-only wiring (no link) acceptable everywhere, or should `init` use `install-strategy=nested` / per-app installs to keep the universal tier?
- Value slots: should `argsFit` recurse into nested objects (`client.users.get(id)`) and check every overload of an overloaded function? Today it checks top-level members, and `Parameters<>` sees only the last overload. A `kind: "value"` server-only service (an override importing `server-only`) is allowed; does any RSC setup need a dedicated server-value kind?
- W7 consumer-cycle detection: should it be an error when the consumer always renders the slot (the manifest could mark `alwaysRenders`), or stay a warning?
- Metro/Expo, Storybook webpack builder, Gatsby, Farm, Astro and React Router 8 adapters are designed from host APIs and lab evidence only. **Partly answered:** esbuild, webpack 5, Rspack 2, Next 16 (Turbopack and `--webpack`) and Jest 30 now have adapters and toolchain suites; the rest remain designed.
