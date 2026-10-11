// Scenarios that only exist for tools built on Vite (Vite, Vitest, Storybook builder-vite, React Router,
// Astro): they edit the tool's own config file (suite.toolConfig). Shared by every suite with family 'vite'.
const CONFIG_OBJECT = /(defineConfig\(\s*\{|export\s+default\s+\{)/;

/** Insert `snippet` (object members) at the top of the exported Vite config object. */
export function addToViteConfig(fx, suite, snippet) {
  fx.edit(suite.toolConfig, (s) => {
    if (!CONFIG_OBJECT.test(s)) throw new Error(`${suite.toolConfig}: no \`defineConfig({\` or \`export default {\` to extend`);
    return s.replace(CONFIG_OBJECT, (m) => `${m}\n  ${snippet},`);
  });
}

export default [
  {
    id: 'F6c-ssr',
    title: 'Vite SSR environment externalizes the SDK (ssr.external) — Node would load the defaults natively',
    family: 'vite',
    catches: 'CFG (configResolved guard)',
    tags: ['cfg'],
    apply: (fx, suite) => addToViteConfig(fx, suite, `ssr: { external: ['@acme/core'] }`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F6\][^\n]*environment "ssr" externalizes @acme\/core/] },
  },
  {
    id: 'F6c-vitest',
    title: 'Vitest deps.optimizer pre-bundles the SDK outside the plugin pipeline',
    family: 'vite',
    catches: 'CFG (configResolved guard)',
    tags: ['cfg'],
    needs: ['test'],
    apply: (fx, suite) => {
      const s = fx.read(suite.toolConfig);
      const optimizer = `deps: { optimizer: { ssr: { enabled: true, include: ['@acme/core'] }, client: { enabled: true, include: ['@acme/core'] } } }`;
      if (/\btest\s*:\s*\{/.test(s)) fx.edit(suite.toolConfig, (t) => t.replace(/\btest\s*:\s*\{/, (m) => `${m}\n    ${optimizer},`));
      else addToViteConfig(fx, suite, `test: { ${optimizer} }`);
    },
    expect: { outcome: 'fail', command: 'test', messages: [/\[F6\][^\n]*Vitest deps\.optimizer\.\w+ pre-bundles/] },
  },
  {
    // build.rollupOptions.external is invisible to the configResolved guard (it inspects resolve.external /
    // noExternal per environment); before the buildEnd check both builds exited 0 and Node then loaded the
    // registry placeholder at startup (observed with Vite 8.3.4).
    id: 'F6c-external',
    title: 'build.rollupOptions.external leaves the SDK external — the runtime would load it natively',
    family: 'vite',
    catches: 'AUD (buildEnd: external SDK module ids)',
    tags: ['aud'],
    apply: (fx, suite) => addToViteConfig(fx, suite, `build: { rollupOptions: { external: ['@acme/core'] } }`),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F6\][^\n]*leaves "@acme\/core" external/] },
  },
  {
    // Vite puts plugin aliases before user aliases, so the adapter's socket alias wins and the user alias is
    // inert (observed with Vite 8.3). Should that ever change, the post-bundle audit must fail the build.
    id: 'F6g-alias',
    title: 'a user alias aims the Button socket at the SDK default: either inert (adapter alias wins) or [F6] from the audit',
    family: 'vite',
    catches: 'prevented (alias order) / AUD',
    tags: ['aud'],
    apply: (fx, suite) => addToViteConfig(fx, suite, `resolve: { alias: [{ find: /^@acme\\/core-slots\\/Button$/, replacement: '@acme/core/original/Button' }] }`),
    expect: { outcome: 'safe', command: 'build', messages: [/\[F6\][^\n]*(imports the SDK default of slot "Button"|Button\.jsx is not in the bundle)/] },
  },
];
