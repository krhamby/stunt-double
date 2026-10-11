# customer-storybook

A Storybook 10 project (builder-vite) that injects its own components and services into the fixture SDK
`@acme/core` with stunt-double. Storybook's Vite builder merges `vite.config.ts`, so the setup is the Vite one
line; `.storybook/main.ts` needs nothing:

```ts
// vite.config.ts
export default defineConfig({ plugins: [react(), stuntDouble()] });
```

[src/App.stories.tsx](src/App.stories.tsx) renders the same app and overrides as customer-vite.

```bash
npm run setup                  # at the repository root: builds .packs/
npm install
npm run build-storybook        # storybook build; fails with an [Fx] report on any injection mistake
npm run probe                  # renders the App story in Chromium and prints the render markers
```

The probe uses `$STUNT_DOUBLE_CHROMIUM`, else `/opt/pw-browsers/chromium`, else Playwright's own Chromium
(`npx playwright-core install chromium`).
