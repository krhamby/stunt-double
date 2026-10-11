# customer-react-router

A React Router 8 app (framework mode) that injects its own components and services into the fixture SDK
`@acme/core` with stunt-double. React Router's framework mode is a Vite plugin, so the setup is the Vite one:

```ts
// vite.config.ts
export default defineConfig({ plugins: [reactRouter(), stuntDouble()] });
```

The plugin covers both builds React Router runs (client and SSR). The home route renders the same app and
overrides as customer-vite; `react-router.config.ts` prerenders it to `build/client/index.html`.

```bash
npm run setup                  # at the repository root: builds .packs/
npm install
npm run build                  # react-router build; fails with an [Fx] report on any injection mistake
npm run probe                  # reads the prerendered page and prints the render markers
```
