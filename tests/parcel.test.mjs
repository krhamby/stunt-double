// Parcel 2 (the stunt-double/parcel resolver, loaded from a local parcel-resolver-*.mjs file). Fixture:
// examples/customer-parcel, a browser app with the same overrides as customer-vite; the probe renders dist/ in
// Chromium (playwright-core). Runs the positive scenario, the shared catalogue, two Parcel-only scenarios, the type
// gate under TypeScript 5.9 and the universal tier. No SSR target: Parcel 2.16 bundles a second React into the
// chunk of an SDK's "use client" modules in node targets (docs/limitations.md R5), with or without stunt-double.
import { defineToolSuite } from './harness/index.mjs';

/** A .parcelrc without the stunt-double resolver (a config nobody wired, or the universal tier). */
const PLAIN_PARCELRC = `{ "extends": "@parcel/config-default" }\n`;

const PARCEL_ONLY = [
  {
    id: 'F6c-parcel-node-target',
    title: 'a node target leaves the SDK to the runtime (Parcel does not bundle node_modules for node targets by default)',
    catches: 'CFG (resolver loadConfig)',
    tags: ['cfg'],
    apply: (fx) => fx.json('package.json', (pkg) => {
      pkg.targets = { ...pkg.targets, server: { source: 'src/main.tsx', context: 'node', distDir: 'dist-server' } };
      return pkg;
    }),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F6\] Parcel target "server" leaves @acme\/core to the runtime/] },
  },
  {
    id: 'F6-parcel-exports',
    title: 'package exports resolution is off: the SDK\'s original/* and contracts subpaths could not resolve',
    catches: 'CFG (resolver loadConfig)',
    tags: ['cfg'],
    apply: (fx) => fx.json('package.json', (pkg) => { delete pkg['@parcel/resolver-default']; return pkg; }),
    expect: { outcome: 'fail', command: 'build', messages: [/\[F6\] Parcel resolves @acme\/core's subpaths[^\n]*"packageExports": true/] },
  },
];

defineToolSuite({
  name: 'parcel',
  fixtureDir: 'examples/customer-parcel',
  toolConfig: '.parcelrc',
  commands: {
    build: 'parcel build',
    render: 'node probes/render.mjs',
  },
  outputs: ['dist', '.parcel-cache'],
  positive: {
    bundle: { files: 'dist/*.js' },
    alsoPass: ['check'],
  },
  unwired: {
    files: { '.parcelrc-unwired': PLAIN_PARCELRC },
    command: 'parcel build --config ./.parcelrc-unwired --dist-dir dist-unwired',
  },
  mutations: (list) => [...list, ...PARCEL_ONLY],
  typescript5: true,
  universal: {
    files: { '.parcelrc-universal': PLAIN_PARCELRC },
    build: 'stunt-double check && parcel build --config ./.parcelrc-universal',
    bare: 'parcel build --config ./.parcelrc-universal',
    mutations: ['F1a', 'F2a', 'F3a', 'F5a', 'F7b', 'V1c'],
  },
});
