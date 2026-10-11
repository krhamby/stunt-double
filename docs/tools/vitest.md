# Vitest

Vitest runs on Vite, so the same plugin covers it: `stuntDouble()` from `stunt-double/vite`, in the config Vitest
loads. Under Vitest the plugin validates your overrides at startup and throws on any injection error, so
`vitest run` exits 1 before a test runs. It also inlines the SDK into Vitest's module graph, so SDK components
render your overrides in every test environment.

Verified with vitest 5.0.3, vite 8.3.4, @vitejs/plugin-react 6.1.2, jsdom 30.1.2, @vitest/browser-playwright 5.0.3
with playwright 1.64.0 (Chromium), @testing-library/react 16.3.3, React 19.3.0, TypeScript 7.0.2, Node 22.22 and npm 10.9.
The reference project is [`examples/customer-vitest`](../../examples/customer-vitest), tested by
[`tests/vitest.test.mjs`](../../tests/vitest.test.mjs).

## Setup

```ts
// vite.config.ts (or vitest.config.ts)
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { stuntDouble } from 'stunt-double/vite';

export default defineConfig({
  plugins: [react(), stuntDouble()],
  test: {
    // node and jsdom environments, as projects
    projects: [
      { extends: true, test: { name: 'node', environment: 'node', include: ['src/**/*.node.test.tsx'] } },
      { extends: true, test: { name: 'jsdom', environment: 'jsdom', include: ['src/**/*.dom.test.tsx'] } },
    ],
  },
});
```

The plugin must be in **every** config Vitest loads. If you keep a separate `vitest.config.ts`, either add
`stuntDouble()` to it or build it from your Vite config with `mergeConfig(viteConfig, { test: { … } })`.
A project that is a separate config file (`projects: ['./other.config.ts']`) needs the plugin in that file too.
Inline projects inherit the root plugins in Vitest 5, with or without `extends: true`.

In CI, run the contract type check as well, because Vitest never type-checks:

```json
{ "scripts": { "test": "vitest run", "ci": "stunt-double check && vitest run" } }
```

Or make `vitest run` itself run the check, as a `globalSetup` (about 0.2–0.3 s with TypeScript 7):

```ts
// stunt-double.typecheck.ts
import { generate, runTypeGate } from 'stunt-double/core';

export default async function stuntDoubleTypeGate() {
  const r = await runTypeGate(generate({ onError: 'throw' }));
  if (!r.ok) throw new Error(r.message);
}
```

```ts
// in the Vitest config
test: { globalSetup: ['./stunt-double.typecheck.ts'] }
```

**Browser mode** needs nothing extra. The browser config inherits the plugin from your Vite config:

```ts
// vitest.browser.config.ts
import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import viteConfig from './vite.config.ts';

export default mergeConfig({ ...viteConfig, test: {} }, defineConfig({
  test: { include: ['src/**/*.dom.test.tsx'], browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] } },
}));
```

## Which mistakes fail where

Every row was observed in `tests/vitest.test.mjs`.

| # | Mistake | `vitest run` (plugin) | `vitest run` + `globalSetup` gate | `stunt-double check && vitest run` |
|---|---|---|---|---|
| F1a | Override props incompatible with the contract | **passes**, but prints `[F1] Button (src/overrides/Button.tsx): TS2322 …` | exit 1 at startup, `[F1]` | exit 1 |
| F1b | Override ignores contract props | **passes** | exit 1, `[F1] … ignores these SDK props` | exit 1 |
| F9c | Async override in a client slot | tests fail at runtime (React: "async Client Component" / "suspended while responding to synchronous input"); `[F9]` is printed | exit 1, `[F9]` | exit 1 |
| F2a | Typo or stray file in `src/overrides` | exit 1 at startup, `[F2] … did you mean "Button"?` | same | exit 1 |
| F2b | SDK upgrade renamed a slot | exit 1, `[F2] … RENAMED` | same | exit 1 |
| F3 | Required slot missing | exit 1, `[F3]` | same | exit 1 |
| F4 | Two files claim one slot | exit 1, `[F4]` | same | exit 1 |
| F5 | Wrong export name | exit 1, `[F5]` | same | exit 1 |
| F6a | Installed SDK imports a default directly | exit 1, `[F6]` | same | exit 1 |
| F6b | Registry placeholder instead of the link | exit 1, `[F6] … the registry placeholder` | same | exit 1 |
| F6b | A Vitest config **without** the plugin (link installed) | test files fail: `Unknown file extension ".jsx" for …/sdk-slots/gen/Button.jsx` (node and jsdom) | — | — |
| F6b | A config without the plugin **and** no link | test files fail: `Cannot find module '…/@acme/core-slots/STUNT-DOUBLE-NOT-WIRED -- … run npx stunt-double doctor'` | — | — |
| F6c | `test.deps.optimizer.client` / `.ssr` includes the SDK | exit 1 at startup, `[F6] Vitest deps.optimizer.ssr pre-bundles @acme/core outside the plugin pipeline` | same | — |
| F6d | Dependency pre-bundling (browser mode) | prevented: no project module in `node_modules/.vite` after a browser run | — | — |
| F6g | App code imports `@acme/core/original/*` | exit 1, `[F6]` | same | exit 1 |
| F6h | Override added without regenerating | regenerated at startup | same | regenerated |
| F7 | Override imports its own slot | exit 1, `[F7]` | same | exit 1 |
| F8 | Duplicate React (SDK bundles its own) | exit 1, `[F8]` | same | exit 1 |

Not mistakes under Vitest (observed: the overrides still render): `test.server.deps.external: ['@acme/core']`,
`ssr.external: ['@acme/core']` (the plugin's `server.deps.inline` wins), and `test.deps.optimizer.client.enabled`
without the SDK in `include`.

**Watch mode.** The plugin watches `src/overrides` and the config file. A mistake made while `vitest` is watching
poisons the shims, so the affected tests re-run and fail with the `[Fx]` text
(`STUNT-DOUBLE-ERROR -- [F2] src overrides Buton.tsx …`). Fixing it turns them green again.

## Known gaps

- **Contract errors (F1, F9c) do not fail plain `vitest run`.** The plugin prints them, but Vitest exits 0 for
  F1. Use the `globalSetup` gate or chain `stunt-double check` in CI.
- **There is no in-test overlay.** In watch mode the signal is a failing test and the printed `[Fx]` block.
- **Vitest workspaces files** (the pre-`projects` `vitest.workspace.ts`) were not tested; Vitest 5 uses `projects`.
- **happy-dom, `@vitest/browser-webdriverio`, Firefox and WebKit** were not tested.
