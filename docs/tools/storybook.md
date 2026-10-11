# Storybook 10 (builder-vite)

Storybook's Vite builder merges the project's `vite.config.ts`, so the [Vite adapter](vite.md) covers every story with no Storybook-specific line:

```ts
// vite.config.ts
export default defineConfig({ plugins: [react(), stuntDouble()] });
```

`storybook build` fails (exit 1) on every injection mistake, before bundling. Storybook's logger word-wraps errors at 80 columns, so under Storybook the adapter also writes the report to stderr verbatim, keeping each `[Fx]` line and file path intact. `storybook dev` shows mistakes in the preview's error overlay, like `vite` dev.

With a separate Vite config for Storybook (`framework.options.builder.viteConfigPath`), add `stuntDouble()` there too. A config without it resolves the registry placeholder and the build fails with `STUNT-DOUBLE-NOT-WIRED`, never silently rendering SDK defaults.

Storybook's webpack builder (`webpackFinal`) uses the [webpack adapter](webpack.md): `webpackFinal: (config) => withStuntDouble(config)`. That path is designed but not yet run in a suite.

**Verified with** storybook / @storybook/react-vite 10.6.1, vite 8.3.4, TypeScript 7.0.2: `tests/storybook.test.mjs` runs the per-tool scenarios of the shared catalogue, the applicable Vite-family scenarios and the universal tier, rendering the built App story in Chromium.
